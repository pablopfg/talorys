import { z } from "zod";

/**
 * What a remote access token may do: `read` calls GET routes only, `write` also changes data, and
 * `events` only sends alerts to POST /api/remote/events (and nothing else can).
 */
export const REMOTE_SCOPES = ["read", "write", "events"] as const;
export type RemoteScope = (typeof REMOTE_SCOPES)[number];

/** Most remote access tokens one owner can hold at once. */
export const MAX_REMOTE_TOKENS = 20;

/** Every remote access token starts with this, so a leaked one is easy to recognise. */
export const REMOTE_TOKEN_PREFIX = "tal_";

/** A remote access token stops working this many days after it is created. */
export const REMOTE_TOKEN_TTL_DAYS = 90;

export const remoteTokenCreateSchema = z.object({
  name: z.string().trim().min(1).max(64),
  scope: z.enum(REMOTE_SCOPES).optional().default("read"),
});

export const remoteStatusSchema = z.object({ enabled: z.boolean() });

/** A remote access token as the owner sees it. The token itself is shown once, at creation. */
export interface RemoteTokenInfo {
  id: string;
  name: string;
  scope: RemoteScope;
  /** Last 4 characters of the token, shown as `tal_…abcd`. */
  hint: string;
  created_at: string;
  last_used_at: string | null;
  /** When the token stops working. */
  expires_at: string;
}

/**
 * Limits of POST /api/remote/events: events per hour and per 24 hours (all tokens together), body
 * size, how long an id blocks a repeat, and how many source + kind pairs learn their own priority.
 */
export const REMOTE_EVENTS = { perHour: 60, perDay: 100, maxBodyBytes: 2048, dedupeHours: 24, maxProfiles: 50 } as const;

/** A name such as "n8n" or "backup-failed": letters, digits, dot, dash and underscore. */
const eventSlug = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, "Use letters, digits, dot, dash or underscore");

/**
 * An event from an outside system (n8n, a script, a monitor) that becomes an alert in the
 * "event" category. Critical is not accepted: only the owner's own alerts can be critical.
 */
export const remoteEventSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(1000).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  /** The system that sent it, e.g. "n8n". */
  source: eventSlug.optional(),
  /** What kind of event, e.g. "backup-failed": the alert's priority is learned per source and kind. */
  kind: eventSlug.optional(),
  /** The sender's id for the event: the same id within 24 hours is dropped as a repeat. */
  id: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/, "Use letters, digits, dot, colon, dash or underscore").optional(),
});
export type RemoteEventInput = z.infer<typeof remoteEventSchema>;

/** The answer to POST /api/remote/events. */
export interface RemoteEventResult {
  /** The alert raised, or null when the event repeated one sent within REMOTE_EVENTS.dedupeHours. */
  event: { id: string; priority: string } | null;
  duplicate: boolean;
}
