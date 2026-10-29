import { TRANSCRIPTION_LIMITS } from "@talorys/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { base64Bytes, estimatedSeconds, WorkersAiTranscriber } from "../src/ai/transcription";
import { isRemoteAllowed } from "../src/remote/allowlist";
import { client, fakeAi, inAgent, loggedIn } from "./helpers";

/** A few KB of arbitrary bytes as base64: the mock transcriber never decodes it. */
const clip = (bytes = 8000) => btoa("x".repeat(bytes));

beforeEach(async () => {
  await inAgent((a) => {
    a.services.db.run("DELETE FROM tal_usage_daily");
    a.services.db.run("DELETE FROM tal_model_usage_daily");
  });
});

describe("POST /api/transcribe", () => {
  it("needs a session", async () => {
    const res = await client().call("/api/transcribe", { method: "POST", body: { audio: clip() } });
    expect(res.status).toBe(401);
  });

  it.runIf(fakeAi())("returns the text, records the audio seconds and leaves the chat budget alone", async () => {
    const c = await loggedIn();
    const res = await c.call("/api/transcribe", { method: "POST", body: { audio: clip(), context: "Lembrar de" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string; seconds: number };
    expect(body.text).toContain("Demo transcription");
    expect(body.seconds).toBe(2);
    const today = await inAgent((a) => a.services.usage.today());
    expect(today).toMatchObject({ transcription_seconds: 2, ai_requests: 0, mock_calls: 1 });
  });

  it("is not open to remote access tokens", () => {
    expect(isRemoteAllowed("POST", "/api/transcribe")).toBe(false);
  });

  it.runIf(fakeAi())("transcribes one clip at a time", async () => {
    await inAgent((a) => {
      a.transcribing = true;
    });
    try {
      const c = await loggedIn();
      const res = await c.call("/api/transcribe", { method: "POST", body: { audio: clip() } });
      expect(res.status).toBe(409);
    } finally {
      await inAgent((a) => {
        a.transcribing = false;
      });
    }
  });

  it("rejects audio that is not base64", async () => {
    const c = await loggedIn();
    const res = await c.call("/api/transcribe", { method: "POST", body: { audio: "not base64!" } });
    expect(res.status).toBe(400);
  });

  it("rejects a clip over the size cap", async () => {
    const c = await loggedIn();
    const res = await c.call("/api/transcribe", { method: "POST", body: { audio: clip(TRANSCRIPTION_LIMITS.maxClipBytes + 3) } });
    expect(res.status).toBe(400);
  });

  it.runIf(fakeAi())("stops at the daily cap of audio", async () => {
    await inAgent((a) => a.services.usage.increment({ transcription_seconds: TRANSCRIPTION_LIMITS.maxSecondsPerDay }));
    const c = await loggedIn();
    const res = await c.call("/api/transcribe", { method: "POST", body: { audio: clip() } });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("AI_LIMIT_REACHED");
    expect(body.error.message).toContain("60 minutes of voice input");
  });
});

describe("Whisper transcriber", () => {
  it("sends the owner's language and context, and uses the reported duration", async () => {
    const calls: unknown[][] = [];
    const run = async (...args: unknown[]) => {
      calls.push(args);
      return { text: "  olá mundo ", transcription_info: { duration: 3.2 } };
    };
    const ai = { run } as unknown as Ai;
    const result = await new WorkersAiTranscriber(ai).transcribe(clip(), { language: "pt-BR", context: "Oi" });
    expect(result).toEqual({ text: "olá mundo", seconds: 3.2 });
    expect(calls[0]![0]).toBe("@cf/openai/whisper-large-v3-turbo");
    expect(calls[0]![1]).toMatchObject({ language: "pt", vad_filter: true, initial_prompt: "Oi" });
  });

  it("charges an estimate when no duration is reported", async () => {
    const ai = { run: async () => ({ text: "hi" }) } as unknown as Ai;
    const audio = clip(40_000);
    const result = await new WorkersAiTranscriber(ai).transcribe(audio, { language: "en" });
    expect(result.seconds).toBe(estimatedSeconds(base64Bytes(audio)));
    expect(result.seconds).toBe(10);
  });

  it("records priced neurons per audio minute", async () => {
    await inAgent((a) => {
      a.services.usage.recordTranscription("@cf/openai/whisper-large-v3-turbo", true, 60);
      const today = a.services.usage.today();
      expect(today.transcription_seconds).toBe(60);
      expect(today.neurons_estimate).toBeCloseTo(46.63, 6);
      expect(today.priced_calls).toBe(1);
    });
  });
});
