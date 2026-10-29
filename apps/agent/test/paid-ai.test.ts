import { DEFAULT_LIMITS, paidModel } from "@talorys/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/api/errors";
import { FallbackProvider } from "../src/ai/fallback";
import { classifyPaidError, PaidAIProvider } from "../src/ai/paid";
import { estimateConsumption } from "../src/ai/pricing";
import { type AgentEvent, type AIProvider, type GenerateRequest, modelUsage, type ToolRequest, tokens, type Usage, withUsage } from "../src/ai/provider";
import { inAgent, loggedIn } from "./helpers";

const request: GenerateRequest = { system: "Keep answers short.", messages: [{ role: "user", content: "hello" }], maxOutputTokens: 100 };
const toolRequest = (extra: Partial<ToolRequest> = {}): ToolRequest => ({ ...request, tools: [], maxIterations: 3, toolBudgetExhausted: () => false, ...extra });
const KEY = "sk-test-not-a-real-key";

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const result: AgentEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

function anthropicReply(text: string) {
  return Response.json({
    id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5",
    content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 200 },
  });
}

function errorReply(status: number, message: string) {
  return Response.json({ type: "error", error: { type: "api_error", message } }, { status });
}

/** A fake provider: answers, or fails with `error` (after `before` events). */
function fake(model: string, opts: { error?: unknown; before?: AgentEvent[]; text?: string } = {}): AIProvider & { calls: number } {
  return {
    id: "fake",
    model,
    billable: true,
    calls: 0,
    async generate() {
      this.calls++;
      if (opts.error) throw opts.error;
      return { text: opts.text ?? model, usage: modelUsage(model, true, tokens(10, 0), tokens(5, 0)) };
    },
    async *stream() {},
    async *generateWithTools() {
      this.calls++;
      for (const event of opts.before ?? []) yield event;
      if (opts.error) throw opts.error;
      yield { type: "text", delta: opts.text ?? model };
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("paid model pricing", () => {
  it("prices Anthropic and OpenAI calls in US$ per token, with cached input at its own rate", () => {
    const usage = (model: string, input: number, output: number, cached = 0): Usage => modelUsage(model, true, tokens(input, 0), tokens(output, 0), cached);
    expect(estimateConsumption(usage("anthropic/claude-opus-5-5", 1_000_000, 0))).toEqual({ neurons: 0, costUsd: 4 });
    expect(estimateConsumption(usage("anthropic/claude-opus-5-5", 0, 1_000_000))).toEqual({ neurons: 0, costUsd: 20 });
    expect(estimateConsumption(usage("openai/gpt-6.1-sol", 1_000_000, 0, 1_000_000))?.costUsd).toBeCloseTo(0.1);
    // A model no longer listed, or a name that only looks like one, is not priced as paid.
    expect(paidModel("anthropic/claude-old")).toBeNull();
    expect(paidModel("other/claude-opus-5-5")).toBeNull();
    expect(paidModel("/claude-opus-5-5")).toBeNull();
  });

  it("adds paid spend to today's total and stops paid calls at the cap", async () => {
    await inAgent((agent) => {
      const s = agent.services;
      const before = s.usage.paidCostToday();
      s.usage.record(modelUsage("anthropic/claude-opus-5-5", true, tokens(100_000, 0), tokens(0, 0)));
      expect(s.usage.paidCostToday()).toBeCloseTo(before + 0.4);
      // Workers AI spend is not counted against the paid cap.
      s.usage.record(modelUsage("@cf/meta/llama-3.1-8b-instruct", true, tokens(100_000, 0), tokens(0, 0)));
      expect(s.usage.paidCostToday()).toBeCloseTo(before + 0.4);
      expect(s.usage.canUsePaidAi({ ...DEFAULT_LIMITS, maxPaidAiUsdPerDay: before + 0.5 })).toBe(true);
      expect(s.usage.canUsePaidAi({ ...DEFAULT_LIMITS, maxPaidAiUsdPerDay: before + 0.4 })).toBe(false);
      expect(s.usage.canUsePaidAi({ ...DEFAULT_LIMITS, maxPaidAiUsdPerDay: 0 })).toBe(false);
    });
  });
});

describe("paid provider", () => {
  it("answers through Anthropic with the owner's key and reports the provider's token counts", async () => {
    const seen: { url: string; key: string | null; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({ url: String(input), key: headers.get("x-api-key"), body: JSON.parse(String(init?.body)) });
      return anthropicReply("Olá!");
    });
    const provider = new PaidAIProvider("anthropic", KEY, "claude-opus-5-5", () => true);
    const result = await provider.generate({ ...request, temperature: 0.7 });
    expect(result.text).toBe("Olá!");
    expect(result.usage).toMatchObject({ model: "anthropic/claude-opus-5-5", billable: true, inputTokens: { reported: 1000 }, outputTokens: { reported: 200 } });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen[0]!.key).toBe(KEY);
    expect(seen[0]!.body.model).toBe("claude-opus-5-5");
    // The newest models reject sampling parameters: it is never sent.
    expect(seen[0]!.body).not.toHaveProperty("temperature");
  });

  it("refuses before calling the provider once today's US$ cap is reached", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const provider = new PaidAIProvider("openai", KEY, "gpt-6.1-sol", () => false);
    await expect(provider.generate(request)).rejects.toMatchObject({ code: "AI_LIMIT_REACHED" });
    await expect(collect(provider.generateWithTools(toolRequest()))).rejects.toMatchObject({ code: "AI_LIMIT_REACHED" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never accepts a model outside the priced list", () => {
    expect(() => new PaidAIProvider("anthropic", KEY, "claude-unpriced", () => true)).toThrow(AppError);
  });

  it("turns provider failures into stable messages without the provider's text, and counts a failed call's prompt", async () => {
    vi.stubGlobal("fetch", async () => errorReply(401, `invalid x-api-key ${KEY}`));
    const provider = new PaidAIProvider("anthropic", KEY, "claude-sonnet-5-5", () => true);
    const error = await provider.generate(request).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "AI_UNAVAILABLE", message: "Anthropic refused the API key. Check the key set on the Worker." });
    expect(JSON.stringify(error)).not.toContain(KEY);

    vi.stubGlobal("fetch", async () => errorReply(529, "Overloaded"));
    const busy = await collect(provider.generateWithTools(toolRequest())).catch((e: unknown) => e);
    expect(busy).toMatchObject({ code: "AI_UNAVAILABLE", message: "Anthropic is busy right now. Please try again in a moment." });
  });

  it("classifies statuses by provider", () => {
    const status = (statusCode: number, message = "x") => Object.assign(new Error(message), { statusCode });
    expect(classifyPaidError("openai", status(429, "You exceeded your current quota"))).toMatchObject({ code: "AI_QUOTA_EXHAUSTED", message: "The OpenAI account has no credit left. Add credit there or choose another model in Settings." });
    expect(classifyPaidError("anthropic", status(400, "Your credit balance is too low"))).toMatchObject({ code: "AI_QUOTA_EXHAUSTED" });
    expect(classifyPaidError("openai", status(429))).toMatchObject({ message: "OpenAI is busy right now. Please try again in a moment." });
    expect(classifyPaidError("openai", status(404))).toMatchObject({ message: "The configured AI model is not available. Choose another model in Settings." });
    expect(classifyPaidError("openai", { cause: status(503) })).toMatchObject({ message: "OpenAI is busy right now. Please try again in a moment." });
    expect(classifyPaidError("openai", Object.assign(new Error("aborted"), { name: "AbortError" }))).toMatchObject({ message: "The response was cancelled." });
  });
});

describe("main model with fallback", () => {
  const down = () => withUsage(new AppError("AI_UNAVAILABLE", "Anthropic is busy right now. Please try again in a moment."), modelUsage("anthropic/claude-opus-5-5", true, tokens(0, 50)));

  it("sends the request to the fallback when the main model fails, recording what the failed call used", async () => {
    const recorded: Usage[] = [];
    const fallen: string[] = [];
    const primary = fake("anthropic/claude-opus-5-5", { error: down() });
    const fallback = fake("@cf/meta/llama-3.1-8b-instruct");
    const provider = new FallbackProvider(primary, fallback, (u) => recorded.push(u), (from, to) => fallen.push(`${from.model}>${to.model}`));
    expect((await provider.generate(request)).text).toBe("@cf/meta/llama-3.1-8b-instruct");
    expect(recorded.map((u) => u.model)).toEqual(["anthropic/claude-opus-5-5"]);
    expect(fallen).toEqual(["anthropic/claude-opus-5-5>@cf/meta/llama-3.1-8b-instruct"]);

    const events = await collect(provider.generateWithTools(toolRequest()));
    expect(events).toEqual([{ type: "text", delta: "@cf/meta/llama-3.1-8b-instruct" }]);
  });

  it("falls back when the cap or credit runs out, but not on a cancel or an unrelated error", async () => {
    for (const code of ["AI_LIMIT_REACHED", "AI_QUOTA_EXHAUSTED"] as const) {
      const fallback = fake("b");
      await new FallbackProvider(fake("a", { error: new AppError(code, "x") }), fallback, () => {}).generate(request);
      expect(fallback.calls).toBe(1);
    }
    for (const error of [new AppError("AI_UNAVAILABLE", "The response was cancelled."), new AppError("VALIDATION_ERROR", "x"), new Error("bug")]) {
      const fallback = fake("b");
      await expect(new FallbackProvider(fake("a", { error }), fallback, () => {}).generate(request)).rejects.toBe(error);
      expect(fallback.calls).toBe(0);
    }
    const aborted = new AbortController();
    aborted.abort();
    const fallback = fake("b");
    await expect(new FallbackProvider(fake("a", { error: down() }), fallback, () => {}).generate({ ...request, signal: aborted.signal })).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    expect(fallback.calls).toBe(0);
  });

  it("never answers twice: once text or a tool call came out, the error stands", async () => {
    for (const before of [[{ type: "text", delta: "Half an" }], [{ type: "tool-start", id: "1", name: "lookup", input: {} }]] as AgentEvent[][]) {
      const fallback = fake("b");
      const provider = new FallbackProvider(fake("a", { error: down(), before }), fallback, () => {});
      await expect(collect(provider.generateWithTools(toolRequest()))).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
      expect(fallback.calls).toBe(0);
    }
    // Usage alone is not an answer: the fallback still runs.
    const fallback = fake("b");
    const usage: AgentEvent = { type: "usage", usage: modelUsage("a", true, tokens(1, 0)) };
    const events = await collect(new FallbackProvider(fake("a", { error: down(), before: [usage] }), fallback, () => {}).generateWithTools(toolRequest()));
    expect(events).toEqual([usage, { type: "text", delta: "b" }]);
  });

  it("needs room in the day's request budget for the fallback call", async () => {
    const fallback = fake("b");
    const provider = new FallbackProvider(fake("a", { error: down() }), fallback, () => {});
    await expect(collect(provider.generateWithTools(toolRequest({ reserveNextStep: () => false })))).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    expect(fallback.calls).toBe(0);
  });
});

describe("paid model settings", () => {
  it("chooses the main and fallback models and keeps Workers AI when a key is missing", async () => {
    const c = await loggedIn();
    try {
      const { settings } = await c.json("/api/settings", { method: "PATCH", body: { aiProvider: "anthropic", aiFallback: "workers-ai", anthropicModel: "claude-haiku-5-5" } });
      expect(settings).toMatchObject({ aiProvider: "anthropic", aiFallback: "workers-ai", anthropicModel: "claude-haiku-5-5" });
      const system = await c.json("/api/system");
      expect(system.paid_ai_keys).toEqual({ anthropic: false, openai: false });
      expect(JSON.stringify(system)).not.toMatch(/sk-/);
      // No Anthropic key on the Worker: the chat runs on the fallback.
      await inAgent((agent) => {
        const provider = agent.aiProvider();
        expect(provider?.model ?? null).not.toMatch(/^anthropic\//);
      });
      expect((await c.call("/api/settings", { method: "PATCH", body: { anthropicModel: "claude-unpriced" } })).status).toBe(400);
      expect((await c.call("/api/settings", { method: "PATCH", body: { limits: { maxPaidAiUsdPerDay: 51 } } })).status).toBe(400);
    } finally {
      await c.json("/api/settings", { method: "PATCH", body: { aiProvider: "workers-ai", aiFallback: "none" } });
    }
  });

  it("needs the password typed recently to turn on a paid model or raise its cap, not to go back to Workers AI", async () => {
    const c = await loggedIn();
    const confirmedAt = (at: string) => inAgent((a) => a.services.db.run(`UPDATE tal_sessions SET confirmed_at = ?`, at));
    await confirmedAt(new Date(Date.now() - 60 * 60_000).toISOString());
    try {
      for (const body of [{ aiProvider: "openai" }, { aiFallback: "anthropic" }, { openaiModel: "gpt-6-astra" }, { limits: { maxPaidAiUsdPerDay: 10 } }]) {
        const res = await c.call("/api/settings", { method: "PATCH", body });
        expect(res.status).toBe(403);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe("REAUTH_REQUIRED");
      }
      const settings = (await c.json("/api/settings")).settings;
      expect(settings).toMatchObject({ aiProvider: "workers-ai", aiFallback: "none" });
      expect(settings.limits.maxPaidAiUsdPerDay).toBe(DEFAULT_LIMITS.maxPaidAiUsdPerDay);
      expect((await c.call("/api/settings", { method: "PATCH", body: { aiProvider: "workers-ai", limits: { maxPaidAiUsdPerDay: 1 } } })).status).toBe(200);
    } finally {
      await confirmedAt(new Date().toISOString());
      await c.json("/api/settings", { method: "PATCH", body: { limits: { maxPaidAiUsdPerDay: DEFAULT_LIMITS.maxPaidAiUsdPerDay } } });
    }
  });
});
