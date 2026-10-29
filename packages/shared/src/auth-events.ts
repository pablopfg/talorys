import { z } from "zod";

/**
 * Sign-in activity (Settings → Security → Sign-in activity): every sign-in, failure and session
 * change, with the network details Cloudflare's edge provides. Never a password, code, token or
 * the e-mail address typed in a failed attempt.
 */
export const AUTH_EVENT_KINDS = [
  "login_success",
  "login_failure",
  "login_rate_limited",
  "logout",
  "session_ended",
  "session_revoked",
  "password_changed",
  "confirm_success",
  "confirm_failure",
  "remote_token_rejected",
  "mfa_challenge",
  "mfa_failure",
  "mfa_enabled",
  "mfa_disabled",
  "mfa_codes_regenerated",
  "login_human_check",
  "recovery_requested",
  "recovery_failure",
  "password_reset",
] as const;
export type AuthEventKind = (typeof AUTH_EVENT_KINDS)[number];

/** Kinds that mean someone was refused; these are the ones counted as failures. */
export const AUTH_FAILURE_KINDS: readonly AuthEventKind[] = ["login_failure", "login_rate_limited", "confirm_failure", "remote_token_rejected", "mfa_failure", "login_human_check", "recovery_failure"];

/** Detailed rows (with IP and user agent) are kept this many days by default, then only daily counts. */
export const AUTH_LOG_DEFAULT_RETENTION_DAYS = 90;
export const AUTH_LOG_RETENTION_RANGE = [30, 180] as const;
/** Daily counts (no IP, no user agent) are kept this long. */
export const AUTH_LOG_DAILY_RETENTION_DAYS = 365;

export interface AuthEvent {
  id: number;
  /** First occurrence; `last_at` and `count` grow when repeated failures from one network are folded together. */
  at: string;
  last_at: string;
  count: number;
  kind: AuthEventKind;
  reason: string | null;
  ip: string | null;
  network: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  asn: number | null;
  as_org: string | null;
  colo: string | null;
  host: string | null;
  user_agent: string | null;
  /** Whether the browser carried a device cookie from an earlier sign-in. */
  known_device: boolean | null;
  /** The shortened public id of the session, as Settings → Security lists sessions. */
  session: string | null;
}

export interface AuthEventsPage {
  events: AuthEvent[];
  /** Pass as `before` for the next page; null on the last one. */
  next_before: number | null;
}

export interface AuthEventsSummary {
  /** The last 24 hours. */
  successes: number;
  failures: number;
  blocked: number;
  networks: number;
  retention_days: number;
}

export const authEventsQuerySchema = z.object({
  kind: z.enum(AUTH_EVENT_KINDS).optional(),
  /** Only failures (every kind in AUTH_FAILURE_KINDS). */
  failures: z.enum(["1"]).optional(),
  country: z
    .string()
    .regex(/^[A-Za-z]{2}$/)
    .transform((s) => s.toUpperCase())
    .optional(),
  ip: z.string().max(64).optional(),
  days: z.coerce.number().int().min(1).max(AUTH_LOG_RETENTION_RANGE[1]).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuthEventsQuery = z.infer<typeof authEventsQuerySchema>;

export const authLogSettingsSchema = z.object({
  retention_days: z.number().int().min(AUTH_LOG_RETENTION_RANGE[0]).max(AUTH_LOG_RETENTION_RANGE[1]),
});

/** "Forgot password": the e-mailed link works once, for this long. */
export const RECOVERY_LINK_TTL_MS = 30 * 60_000;
/** Tries per link (a wrong two-step code counts): past them the link stops working. */
export const RECOVERY_MAX_ATTEMPTS = 5;
/** Recovery e-mails sent in 24 hours, whoever asks. */
export const RECOVERY_EMAILS_PER_DAY = 3;
/** Requests one network may make in 15 minutes, sent or not. */
export const RECOVERY_REQUESTS_PER_CLIENT = 3;
