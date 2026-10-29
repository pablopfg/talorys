import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { type PaidAiProviderId, type PaidModel, paidModel, paidModelKey } from "@talorys/shared";
import { generateText, type LanguageModel, type LanguageModelUsage, streamText, type ToolSet } from "ai";
import { AppError, errorSummary } from "../api/errors";
import type { AgentEvent, AIProvider, GenerateRequest, ToolRequest, Usage } from "./provider";
import { estimateTokens, modelUsage, tokenCount, tokens, withUsage } from "./provider";

/** Longest a paid call may take before it is abandoned (the turn then fails or falls back). */
const TIMEOUT_MS = 90_000;

/**
 * Anthropic and OpenAI through the AI SDK's official providers, with the owner's own API key.
 * `allowed()` is asked before every model call: it says whether today's spend is still under the
 * owner's cap in US$, so a long turn stops as soon as the cap is reached.
 */
export class PaidAIProvider implements AIProvider {
  readonly billable = true;
  readonly model: string;
  private readonly info: PaidModel;

  constructor(
    readonly id: PaidAiProviderId,
    private readonly apiKey: string,
    modelId: string,
    private readonly allowed: () => boolean,
  ) {
    this.model = paidModelKey(id, modelId);
    const info = paidModel(this.model);
    // Settings only accept listed models, so this would be a programming error.
    if (!info) throw new AppError("AI_UNAVAILABLE", "The configured AI model is not available. Choose another model in Settings.");
    this.info = info;
  }

  private languageModel(): LanguageModel {
    // fetch is passed explicitly so the Worker's own (never a polyfill) is used; no other base URL is accepted.
    if (this.id === "anthropic") return createAnthropic({ apiKey: this.apiKey, fetch: (i, init) => fetch(i, init) })(this.info.id);
    return createOpenAI({ apiKey: this.apiKey, fetch: (i, init) => fetch(i, init) })(this.info.id);
  }

  private signal(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }

  private usage(u: LanguageModelUsage | undefined, inputChars: number, outputChars: number): Usage {
    const input = tokenCount(u?.inputTokens);
    const output = tokenCount(u?.outputTokens);
    return modelUsage(
      this.model,
      true,
      tokens(input, estimateTokens(inputChars)),
      tokens(output, estimateTokens(outputChars)),
      tokenCount(u?.inputTokenDetails?.cacheReadTokens) ?? 0,
    );
  }

  private ensureAllowed(): void {
    if (!this.allowed()) throw new AppError("AI_LIMIT_REACHED", "Talorys reached today's spending cap for paid AI models. Raise it in Settings → AI or wait until tomorrow.");
  }

  async generate(req: GenerateRequest) {
    this.ensureAllowed();
    const inputChars = promptChars(req);
    try {
      const result = await generateText({
        model: this.languageModel(),
        instructions: req.system,
        messages: req.messages,
        maxOutputTokens: req.maxOutputTokens,
        ...(this.info.temperature ? { temperature: req.temperature } : {}),
        abortSignal: this.signal(req.signal),
        // Retries would be paid calls the daily budget cannot see; the UI offers Retry instead.
        maxRetries: 0,
      });
      return { text: result.text, usage: this.usage(result.usage, inputChars, result.text.length) };
    } catch (error) {
      // A call that reached the provider may be billed even when it fails: count the prompt.
      throw withUsage(classifyPaidError(this.id, error), this.usage(undefined, inputChars, 0));
    }
  }

  async *stream(req: GenerateRequest): AsyncIterable<AgentEvent> {
    yield* this.generateWithTools({ ...req, tools: [], maxIterations: 1, toolBudgetExhausted: () => true });
  }

  async *generateWithTools(req: ToolRequest): AsyncIterable<AgentEvent> {
    this.ensureAllowed();
    const tools: ToolSet = {};
    for (const t of req.tools) {
      tools[t.name] = {
        description: t.description,
        inputSchema: t.inputSchema,
        execute: async (input: unknown, options: { toolCallId: string }) => t.execute(input, options.toolCallId),
      } as ToolSet[string];
    }
    const hasTools = req.tools.length > 0;
    let inputChars = promptChars(req);
    let outputChars = 0;
    let stepOpen = false;
    let streamError: unknown = null;
    const result = streamText({
      model: this.languageModel(),
      instructions: req.system,
      messages: req.messages,
      maxOutputTokens: req.maxOutputTokens,
      ...(this.info.temperature ? { temperature: req.temperature } : {}),
      abortSignal: this.signal(req.signal),
      maxRetries: 0,
      ...(hasTools
        ? {
            tools,
            // Every further step is another paid call: stop at the step cap, the daily request budget or the US$ cap.
            stopWhen: ({ steps }: { steps: unknown[] }) =>
              steps.length >= req.maxIterations || !this.allowed() || (req.reserveNextStep ? !req.reserveNextStep() : false),
            prepareStep: ({ stepNumber }: { stepNumber: number }) =>
              stepNumber >= req.maxIterations - 1 || req.toolBudgetExhausted() ? { toolChoice: "none" as const } : {},
          }
        : {}),
      onError: ({ error }: { error: unknown }) => {
        streamError = error;
      },
    });

    let failure: unknown = null;
    try {
      for await (const part of result.fullStream) {
        switch (part.type) {
          case "start-step":
            stepOpen = true;
            break;
          case "reasoning-delta":
            outputChars += part.text.length;
            break;
          case "text-delta":
            outputChars += part.text.length;
            if (part.text) yield { type: "text", delta: part.text };
            break;
          case "tool-call":
            outputChars += JSON.stringify({ name: part.toolName, input: part.input }).length;
            yield { type: "tool-start", id: part.toolCallId, name: part.toolName, input: part.input };
            break;
          case "tool-result": {
            const output = JSON.stringify(part.output ?? null);
            // The result is sent back as input on the next step.
            inputChars += output?.length ?? 0;
            yield { type: "tool-end", id: part.toolCallId, name: part.toolName, output: part.output };
            break;
          }
          case "tool-error":
            yield {
              type: "tool-end",
              id: part.toolCallId,
              name: part.toolName,
              output: null,
              error: part.error instanceof Error ? part.error.message : String(part.error),
            };
            break;
          case "finish-step":
            yield { type: "usage", usage: this.usage(part.usage, inputChars, outputChars) };
            stepOpen = false;
            outputChars = 0;
            break;
          case "error":
            throw part.error;
          default:
            break;
        }
      }
    } catch (error) {
      failure = error;
    }
    failure ??= streamError;
    // A step that started but never finished (abort, error) may still be billed: count it by estimate.
    if (stepOpen) yield { type: "usage", usage: this.usage(undefined, inputChars, outputChars) };
    if (failure) throw classifyPaidError(this.id, failure);
  }
}

function promptChars(req: GenerateRequest): number {
  return req.system.length + req.messages.reduce((n, m) => n + m.content.length, 0);
}

const MESSAGES: Record<PaidAiProviderId, { key: string; credit: string; busy: string; log: string }> = {
  anthropic: {
    key: "Anthropic refused the API key. Check the key set on the Worker.",
    credit: "The Anthropic account has no credit left. Add credit there or choose another model in Settings.",
    busy: "Anthropic is busy right now. Please try again in a moment.",
    log: "Anthropic error",
  },
  openai: {
    key: "OpenAI refused the API key. Check the key set on the Worker.",
    credit: "The OpenAI account has no credit left. Add credit there or choose another model in Settings.",
    busy: "OpenAI is busy right now. Please try again in a moment.",
    log: "OpenAI error",
  },
};

/** Maps a paid provider's failure onto a stable application error, without its raw text (which can echo the request). */
export function classifyPaidError(provider: PaidAiProviderId, error: unknown): AppError {
  if (error instanceof AppError) return error;
  const text = MESSAGES[provider];
  const status = statusOf(error);
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || name === "TimeoutError" || (status === undefined && /abort/i.test(message))) {
    return new AppError("AI_UNAVAILABLE", "The response was cancelled.");
  }
  if (status === 401 || status === 403) return new AppError("AI_UNAVAILABLE", text.key);
  if (status === 402 || ((status === 400 || status === 429) && /credit|balance|billing|quota/i.test(message))) {
    return new AppError("AI_QUOTA_EXHAUSTED", text.credit);
  }
  if (status === 404) return new AppError("AI_UNAVAILABLE", "The configured AI model is not available. Choose another model in Settings.");
  if (status === 429 || status === 529 || (status !== undefined && status >= 500)) return new AppError("AI_UNAVAILABLE", text.busy);
  console.error(text.log, errorSummary(error));
  return new AppError("AI_UNAVAILABLE", "The AI model could not respond. Please try again.");
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  if (typeof status === "number") return status;
  const cause = (error as { cause?: unknown } | null)?.cause;
  return cause && cause !== error ? statusOf(cause) : undefined;
}
