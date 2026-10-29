/**
 * The owner's real use of the app, shared between tabs. Only the time of the last use is kept,
 * never what was done. The server counts a request as use only when it carries the activity
 * header, which this module adds for a few seconds after a click, key, touch, wheel or scroll.
 */

/** A request this soon after a real input counts as one the owner started. */
const ACTIVE_WINDOW_MS = 10_000;
/** Other tabs hear about new use at most this often. */
const SHARE_INTERVAL_MS = 5_000;

export type SessionMessage =
  | { type: "activity"; at: number }
  | { type: "reported"; at: number }
  | { type: "logout"; reason: "idle" | "manual" | "ended" }
  | { type: "deadlines"; deadlines: LocalDeadlines };

export interface SessionDeadlines {
  now: string;
  idle_at: string;
  presence_at: string;
  max_at: string;
  timeouts?: { idleMinutes: number; presenceMinutes: number; maxHours: number };
}

/** The deadlines on this browser's clock: each one is "how long from the server's now", from when it arrived. */
export interface LocalDeadlines {
  idleAt: number;
  maxAt: number;
  /** The inactivity timeout itself, to count from the last use this browser reported. */
  idleMs: number;
}

export function toLocal(d: SessionDeadlines, receivedAt = Date.now()): LocalDeadlines {
  const server = Date.parse(d.now);
  return {
    idleAt: receivedAt + (Date.parse(d.idle_at) - server),
    maxAt: receivedAt + (Date.parse(d.max_at) - server),
    idleMs: (d.timeouts?.idleMinutes ?? 15) * 60_000,
  };
}

let lastUse = 0;
let lastShared = 0;
/** When this browser last told the server about use (a request with the activity header, or a heartbeat). */
let lastReported = Date.now();
let lastReportShared = 0;
let channel: BroadcastChannel | null | undefined;
const listeners = new Set<(m: SessionMessage) => void>();

function bus(): BroadcastChannel | null {
  if (channel === undefined) {
    channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("talorys-session");
    channel?.addEventListener("message", (e: MessageEvent<SessionMessage>) => {
      if (e.data?.type === "activity" && typeof e.data.at === "number") lastUse = Math.max(lastUse, Math.min(e.data.at, Date.now()));
      if (e.data?.type === "reported" && typeof e.data.at === "number") lastReported = Math.max(lastReported, Math.min(e.data.at, Date.now()));
      for (const fn of listeners) fn(e.data);
    });
  }
  return channel;
}

/** Sends to the other tabs of this app (not to this one). */
export function broadcast(message: SessionMessage): void {
  bus()?.postMessage(message);
}

/** Messages from the other tabs. */
export function onSessionMessage(fn: (m: SessionMessage) => void): () => void {
  bus();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Records a real input in this tab and tells the others, at most every few seconds. */
export function markUse(now = Date.now()): void {
  lastUse = now;
  if (now - lastShared >= SHARE_INTERVAL_MS) {
    lastShared = now;
    broadcast({ type: "activity", at: now });
  }
}

/** When the owner last used any tab (0 when never, in this page's life). */
export function lastUseAt(): number {
  return lastUse;
}

/** Records that the server was told about use now, and tells the other tabs (at most every few seconds). */
export function noteReported(now = Date.now()): void {
  lastReported = now;
  if (now - lastReportShared >= SHARE_INTERVAL_MS) {
    lastReportShared = now;
    broadcast({ type: "reported", at: now });
  }
}

export function lastReportedAt(): number {
  return lastReported;
}

/** Whether a request sent now was started by the owner, for the activity header. */
export function recentlyUsed(now = Date.now()): boolean {
  return now - lastUse <= ACTIVE_WINDOW_MS;
}
