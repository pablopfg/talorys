export const TALORYS_VERSION = "0.1.7";

/** Stable identity of the single owner's agent inside the private DO namespace. */
export const AGENT_INSTANCE_NAME = "personal-agent";

/**
 * Default Workers AI model. Verified on developers.cloudflare.com/workers-ai/models:
 * Cloudflare-hosted, supports function calling and streaming, 131k context.
 */
export const DEFAULT_MODEL = "@cf/zai-org/glm-4.7-flash";

export const BACKUP_FORMAT = "talorys-backup";
export const BACKUP_VERSION = 1;

export const SESSION_COOKIE = "__Host-talorys_session";
export const DEV_SESSION_COOKIE = "talorys_session";

/** Header sent by the SPA on every API call. Simple-request CSRF can't set custom headers. */
export const CSRF_HEADER = "x-talorys-request";

export const GITHUB_URL = "https://github.com/rociiu/talorys";

/** Languages the web UI ships messages for. English is the source text and the fallback for missing keys. */
export const LANGUAGES = ["en", "ko", "pt-BR"] as const;
export type Language = (typeof LANGUAGES)[number];

/** The language of a new installation, and the one used when the browser's language isn't available. */
export const DEFAULT_LANGUAGE: Language = "pt-BR";

export const DEFAULT_LIMITS = {
  maxOutputTokens: 1024,
  maxToolCalls: 6,
  maxAgentIterations: 4,
  maxContextTokens: 6000,
  maxScheduledAiRunsPerDay: 6,
  maxAiRequestsPerDay: 200,
} as const;

/**
 * Voice input in chat. Each clip is one Workers AI call billed by audio minute, so the clip size
 * and the day's audio are capped apart from `maxAiRequestsPerDay`: dictating in short clips must
 * not spend the chat budget, and an hour of audio stays well inside the free allocation.
 */
export const TRANSCRIPTION_LIMITS = {
  /** Longest clip the browser sends, in seconds. */
  maxClipSeconds: 60,
  /** Largest clip accepted, in bytes before base64 (about a minute of Safari's AAC). */
  maxClipBytes: 2 * 1024 * 1024,
  /** Audio transcribed per day, in seconds. */
  maxSecondsPerDay: 60 * 60,
} as const;

/** Memory history defaults: rule-based conflict detection on, AI conflict check off. */
export const DEFAULT_MEMORY_HISTORY = {
  conflictReview: true,
  aiConflictCheck: false,
} as const;

/**
 * How long a browser session lasts (D9): ended after this much time without the owner using it,
 * without any open tab answering, or after this long in total, whichever comes first.
 */
export const DEFAULT_SESSION_TIMEOUTS = {
  idleMinutes: 15,
  presenceMinutes: 5,
  maxHours: 12,
} as const;

/** The range the server enforces for each session timeout. */
export const SESSION_TIMEOUT_RANGES = {
  idleMinutes: [5, 60],
  presenceMinutes: [3, 15],
  maxHours: [1, 24],
} as const;

/** Header the app sends only on requests the owner's own input started; only those count as use. */
export const ACTIVITY_HEADER = "x-talorys-activity";

/** Hard ceilings the owner cannot exceed through settings. */
export const LIMIT_CEILINGS = {
  maxOutputTokens: 4096,
  maxToolCalls: 20,
  maxAgentIterations: 10,
  maxContextTokens: 32000,
  maxScheduledAiRunsPerDay: 48,
  maxAiRequestsPerDay: 2000,
} as const;

/** Defined here rather than in schemas.ts so plans.ts can use it without an import cycle. */
export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
