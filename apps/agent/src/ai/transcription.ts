import { TRANSCRIPTION_LIMITS, type Language } from "@talorys/shared";
import type { Env } from "../env";
import type { SettingsService } from "../services/settings";

export const TRANSCRIPTION_MODEL = "@cf/openai/whisper-large-v3-turbo";

/** Whisper's language codes for the UI languages; the owner's language steers recognition. */
const WHISPER_LANGUAGE: Record<Language, string> = { en: "en", ko: "ko", "pt-BR": "pt" };

export interface Transcription {
  text: string;
  /** Audio length, for the daily cap and the cost estimate. */
  seconds: number;
}

export interface Transcriber {
  readonly model: string;
  readonly billable: boolean;
  transcribe(audio: string, opts: { language: Language; context?: string; signal?: AbortSignal }): Promise<Transcription>;
}

/** Bytes a base64 string decodes to. */
export function base64Bytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Length to charge when the model does not report one: about 32 kbit/s, the bitrate browsers record
 * Opus at, so a typical clip is not undercounted. Never above the clip cap the browser keeps to.
 */
export function estimatedSeconds(bytes: number): number {
  return Math.min(TRANSCRIPTION_LIMITS.maxClipSeconds, Math.max(1, bytes / 4000));
}

interface WhisperOutput {
  text?: unknown;
  transcription_info?: { duration?: unknown };
}

/** Whisper on Workers AI. The audio goes to the model only; nothing about it is stored. */
export class WorkersAiTranscriber implements Transcriber {
  readonly model = TRANSCRIPTION_MODEL;
  readonly billable = true;

  constructor(private readonly ai: Ai) {}

  async transcribe(audio: string, opts: { language: Language; context?: string; signal?: AbortSignal }): Promise<Transcription> {
    const result = (await this.ai.run(
      this.model,
      {
        audio,
        language: WHISPER_LANGUAGE[opts.language],
        // Silence between words would otherwise come back as invented text.
        vad_filter: true,
        ...(opts.context ? { initial_prompt: opts.context } : {}),
      },
      { signal: opts.signal },
    )) as WhisperOutput;
    const duration = result?.transcription_info?.duration;
    return {
      text: typeof result?.text === "string" ? result.text.trim() : "",
      seconds: typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : estimatedSeconds(base64Bytes(audio)),
    };
  }
}

/** Deterministic stand-in for local development, tests and demo mode. It never calls a model. */
export class MockTranscriber implements Transcriber {
  readonly model = "mock-whisper";
  readonly billable = false;

  async transcribe(audio: string): Promise<Transcription> {
    const seconds = estimatedSeconds(base64Bytes(audio));
    return { text: `Demo transcription of ${Math.round(seconds)} s of audio.`, seconds };
  }
}

/** Chooses the transcriber the way `TalorysAgent.aiProvider()` chooses the chat provider. */
export function createTranscriber(env: Env, settings: SettingsService): Transcriber | null {
  if (settings.get().demoMode) return new MockTranscriber();
  if (env.TALORYS_ENV === "development" && env.TALORYS_MOCK_AI === "1") return new MockTranscriber();
  if (!env.AI) return null;
  return new WorkersAiTranscriber(env.AI);
}
