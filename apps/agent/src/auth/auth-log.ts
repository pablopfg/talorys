import {
  AUTH_FAILURE_KINDS,
  AUTH_LOG_DAILY_RETENTION_DAYS,
  AUTH_LOG_DEFAULT_RETENTION_DAYS,
  AUTH_LOG_RETENTION_RANGE,
  type AuthEvent,
  type AuthEventKind,
  type AuthEventsPage,
  type AuthEventsQuery,
  type AuthEventsSummary,
  hmacSha256Hex,
} from "@talorys/shared";
import type { Database } from "../db/database";
import type { SettingsService } from "../services/settings";

/** Where a request came from, as Cloudflare's edge saw it. Every field may be missing. */
export interface ClientGeo {
  country: string | null;
  region: string | null;
  city: string | null;
  asn: number | null;
  asOrg: string | null;
  colo: string | null;
}

/** What the sign-in activity records about the browser behind a request. */
export interface ClientInfo {
  ip: string | null;
  network: string | null;
  userAgent: string;
  host: string;
  geo: ClientGeo;
  /** HMAC of the device cookie; null without one. */
  device: string | null;
}

export const NO_GEO: ClientGeo = { country: null, region: null, city: null, asn: null, asOrg: null, colo: null };

/** Past this many failure rows from one network in FOLD_WINDOW_MS, more failures only bump the last row's count. */
export const FOLD_AFTER = 20;
export const FOLD_WINDOW_MS = 15 * 60_000;
/** The table never holds more rows than this; the oldest go first. */
export const MAX_EVENT_ROWS = 50_000;
/** Of those, refusals get all but this many: a flood of refusals can't push the owner's own sign-ins out. */
export const MAX_OWNER_ROWS = 5_000;
/** A blocked network's repeated refusals reach storage at most this often; the ones between are counted in memory. */
export const BLOCKED_FLUSH_MS = 60_000;
/** At most this many devices are remembered; the least recently seen go first. */
export const MAX_KNOWN_DEVICES = 50;
/** The device cookie lasts this long without a sign-in. */
export const DEVICE_COOKIE_MAX_AGE_S = 180 * 24 * 3600;
/** Expired rows are folded into daily counts at most this often. */
const PURGE_INTERVAL_MS = 3600_000;

const RETENTION_KEY = "auth_log.retention_days";
const PURGED_KEY = "auth_log.purged_at";
const DAY_MS = 24 * 3600_000;

interface EventRow {
  id: number;
  at: number;
  last_at: number;
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
  known_device: number | null;
  session: string | null;
}

/** Text from the client is stored plain, without control characters, and short. */
export function cleanText(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point.
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

/**
 * Sign-in activity: who tried to get in, from where, and what happened. Kept for the retention
 * the owner chose (90 days by default), then reduced to daily counts without IP or user agent.
 * Flooding cannot grow it without bound: repeated failures from one network fold into one row,
 * and the table has a hard row cap.
 */
export class AuthLog {
  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly secret: () => string | undefined,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** Refusals from blocked networks not yet written, per network. Lost if the object restarts, which only undercounts. */
  private readonly blockedPending = new Map<string, number>();
  private inserts = 0;

  retentionDays(): number {
    const stored = this.settings.getJson<number>(RETENTION_KEY);
    const [min, max] = AUTH_LOG_RETENTION_RANGE;
    return typeof stored === "number" && Number.isInteger(stored) && stored >= min && stored <= max ? stored : AUTH_LOG_DEFAULT_RETENTION_DAYS;
  }

  setRetentionDays(days: number): void {
    this.settings.setJson(RETENTION_KEY, days);
    this.purge(true);
  }

  /** Records one event. Never throws: losing a log line must not fail a sign-in. */
  record(kind: AuthEventKind, client: ClientInfo | null, extra: { reason?: string; session?: string | null; knownDevice?: boolean | null } = {}): void {
    try {
      this.insert(kind, client, extra);
      this.purge(false);
    } catch (error) {
      console.warn("Sign-in activity not recorded", error instanceof Error ? error.name : "error");
    }
  }

  private insert(kind: AuthEventKind, client: ClientInfo | null, extra: { reason?: string; session?: string | null; knownDevice?: boolean | null }): void {
    const nowMs = this.clock();
    const network = client?.network ?? null;
    // A blocked network may keep sending requests (as may one refused by the robot check): one row
    // per window, its count written at most once a minute.
    if (network && (kind === "login_rate_limited" || kind === "login_human_check")) {
      const pendingKey = `${kind} ${network}`;
      const row = this.db.one<{ id: number; last_at: number }>(
        `SELECT id, last_at FROM tal_auth_events WHERE network = ? AND kind = ? AND at > ? ORDER BY id DESC LIMIT 1`,
        network,
        kind,
        nowMs - FOLD_WINDOW_MS,
      );
      if (row) {
        const pending = (this.blockedPending.get(pendingKey) ?? 0) + 1;
        if (nowMs - row.last_at < BLOCKED_FLUSH_MS) {
          this.blockedPending.set(pendingKey, pending);
          return;
        }
        this.blockedPending.delete(pendingKey);
        this.db.run(`UPDATE tal_auth_events SET count = count + ?, last_at = ? WHERE id = ?`, pending, nowMs, row.id);
        return;
      }
      this.blockedPending.delete(pendingKey);
    }
    if (network && AUTH_FAILURE_KINDS.includes(kind)) {
      const recent = this.db.one<{ n: number }>(
        `SELECT count(*) AS n FROM tal_auth_events WHERE network = ? AND last_at > ? AND kind IN (${AUTH_FAILURE_KINDS.map(() => "?").join(", ")})`,
        network,
        nowMs - FOLD_WINDOW_MS,
        ...AUTH_FAILURE_KINDS,
      )?.n ?? 0;
      if (recent >= FOLD_AFTER) {
        const folded = this.db.run(
          `UPDATE tal_auth_events SET count = count + 1, last_at = ? WHERE id = (SELECT max(id) FROM tal_auth_events WHERE network = ? AND kind = ? AND last_at > ?)`,
          nowMs,
          network,
          kind,
          nowMs - FOLD_WINDOW_MS,
        );
        if (folded.changes > 0) return;
      }
    }
    const geo = client?.geo ?? NO_GEO;
    this.db.run(
      `INSERT INTO tal_auth_events (at, last_at, count, kind, reason, ip, network, country, region, city, asn, as_org, colo, host, user_agent, known_device, session)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      nowMs,
      nowMs,
      kind,
      cleanText(extra.reason, 40),
      cleanText(client?.ip, 64),
      cleanText(network, 64),
      cleanText(geo.country, 2),
      cleanText(geo.region, 100),
      cleanText(geo.city, 100),
      geo.asn,
      cleanText(geo.asOrg, 120),
      cleanText(geo.colo, 8),
      cleanText(client?.host, 253),
      cleanText(client?.userAgent, 300),
      extra.knownDevice === undefined || extra.knownDevice === null ? null : extra.knownDevice ? 1 : 0,
      cleanText(extra.session, 16),
    );
    if (++this.inserts % 100 === 0) this.cap();
  }

  /** Keeps the newest rows of each class: refusals first go, never the owner's own sign-ins to make room for them. */
  private cap(): void {
    const failures = AUTH_FAILURE_KINDS.map(() => "?").join(", ");
    this.db.run(
      `DELETE FROM tal_auth_events WHERE id IN (SELECT id FROM tal_auth_events WHERE kind IN (${failures}) ORDER BY id DESC LIMIT -1 OFFSET ?)`,
      ...AUTH_FAILURE_KINDS,
      MAX_EVENT_ROWS - MAX_OWNER_ROWS,
    );
    this.db.run(
      `DELETE FROM tal_auth_events WHERE id IN (SELECT id FROM tal_auth_events WHERE kind NOT IN (${failures}) ORDER BY id DESC LIMIT -1 OFFSET ?)`,
      ...AUTH_FAILURE_KINDS,
      MAX_OWNER_ROWS,
    );
  }

  /** Folds rows past the retention into daily counts (no IP, no user agent) and drops old counts. */
  purge(force: boolean): void {
    const nowMs = this.clock();
    const last = this.settings.getJson<number>(PURGED_KEY);
    if (!force && typeof last === "number" && nowMs - last < PURGE_INTERVAL_MS) return;
    const cutoff = nowMs - this.retentionDays() * DAY_MS;
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO tal_auth_daily (day, country, kind, n)
         SELECT strftime('%Y-%m-%d', at / 1000, 'unixepoch'), coalesce(country, '--'), kind, sum(count) FROM tal_auth_events WHERE at < ?
         GROUP BY 1, 2, 3
         ON CONFLICT(day, country, kind) DO UPDATE SET n = n + excluded.n`,
        cutoff,
      );
      this.db.run(`DELETE FROM tal_auth_events WHERE at < ?`, cutoff);
      const oldest = new Date(nowMs - AUTH_LOG_DAILY_RETENTION_DAYS * DAY_MS).toISOString().slice(0, 10);
      this.db.run(`DELETE FROM tal_auth_daily WHERE day < ?`, oldest);
      this.settings.setJson(PURGED_KEY, nowMs);
    });
    this.cap();
  }

  /** Expired rows go even when nothing new is recorded: reading the activity also runs the hourly purge. */
  private purgeQuietly(): void {
    try {
      this.purge(false);
    } catch (error) {
      console.warn("Sign-in activity not purged", error instanceof Error ? error.name : "error");
    }
  }

  list(query: AuthEventsQuery): AuthEventsPage {
    this.purgeQuietly();
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.kind) {
      where.push("kind = ?");
      params.push(query.kind);
    }
    if (query.failures) {
      where.push(`kind IN (${AUTH_FAILURE_KINDS.map(() => "?").join(", ")})`);
      params.push(...AUTH_FAILURE_KINDS);
    }
    if (query.country) {
      where.push("country = ?");
      params.push(query.country);
    }
    if (query.ip) {
      where.push("(ip = ? OR network = ?)");
      params.push(query.ip, query.ip);
    }
    if (query.days) {
      where.push("last_at > ?");
      params.push(this.clock() - query.days * DAY_MS);
    }
    if (query.before) {
      where.push("id < ?");
      params.push(query.before);
    }
    const rows = this.db.all<EventRow>(
      `SELECT * FROM tal_auth_events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`,
      ...params,
      query.limit + 1,
    );
    const more = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    return { events: page.map(toEvent), next_before: more ? page.at(-1)!.id : null };
  }

  summary(): AuthEventsSummary {
    this.purgeQuietly();
    const since = this.clock() - DAY_MS;
    const sum = (kinds: readonly AuthEventKind[]) =>
      this.db.one<{ n: number | null }>(
        `SELECT sum(count) AS n FROM tal_auth_events WHERE last_at > ? AND kind IN (${kinds.map(() => "?").join(", ")})`,
        since,
        ...kinds,
      )?.n ?? 0;
    const networks = this.db.one<{ n: number }>(`SELECT count(DISTINCT network) AS n FROM tal_auth_events WHERE last_at > ? AND network IS NOT NULL`, since)?.n ?? 0;
    return {
      successes: sum(["login_success"]),
      failures: sum(["login_failure", "confirm_failure", "remote_token_rejected", "mfa_failure"]),
      blocked: sum(["login_rate_limited"]),
      networks,
      retention_days: this.retentionDays(),
    };
  }

  /** Every detailed row, oldest first, as CSV. Cells a spreadsheet would run as a formula are escaped. */
  csv(): string {
    const header = ["at", "last_at", "count", "kind", "reason", "ip", "network", "country", "region", "city", "asn", "as_org", "colo", "host", "user_agent", "known_device", "session"];
    const rows = this.db.all<EventRow>(`SELECT * FROM tal_auth_events ORDER BY id`).map(toEvent);
    const lines = rows.map((e) => header.map((k) => csvCell((e as unknown as Record<string, unknown>)[k])).join(","));
    return [header.join(","), ...lines].join("\r\n");
  }

  /** Deletes every detailed row and daily count. Returns how many detailed rows went. */
  clear(): number {
    return this.db.transaction(() => {
      const n = this.db.run(`DELETE FROM tal_auth_events`).changes;
      this.db.run(`DELETE FROM tal_auth_daily`);
      return n;
    });
  }

  // ---------- Devices ----------

  /** The stored id for a device cookie value; null when the cookie is missing or the secret isn't set. */
  async deviceId(cookie: string | null): Promise<string | null> {
    const secret = this.secret();
    if (!cookie || cookie.length > 100 || !secret) return null;
    return (await hmacSha256Hex(secret, `device:${cookie}`)).slice(0, 48);
  }

  isKnownDevice(id: string | null): boolean {
    return !!id && !!this.db.one(`SELECT 1 AS x FROM tal_known_devices WHERE id = ?`, id);
  }

  /** Remembers a device after a successful sign-in; keeps the most recently seen MAX_KNOWN_DEVICES. */
  rememberDevice(id: string): void {
    const nowMs = this.clock();
    this.db.run(
      `INSERT INTO tal_known_devices (id, created_at, last_seen_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      id,
      nowMs,
      nowMs,
    );
    this.db.run(`DELETE FROM tal_known_devices WHERE id NOT IN (SELECT id FROM tal_known_devices ORDER BY last_seen_at DESC LIMIT ?)`, MAX_KNOWN_DEVICES);
  }

  forgetDevices(): number {
    return this.db.run(`DELETE FROM tal_known_devices`).changes;
  }

  /** True when there was a sign-in before this one (the very first is never "new"). */
  hadEarlierSignIn(): boolean {
    return !!this.db.one(`SELECT 1 AS x FROM tal_auth_events WHERE kind = 'login_success' LIMIT 1`) || !!this.db.one(`SELECT 1 AS x FROM tal_known_devices LIMIT 1`);
  }

  /** True when no sign-in in the retained activity came from this country. */
  isNewCountry(country: string | null): boolean {
    if (!country) return false;
    return !this.db.one(`SELECT 1 AS x FROM tal_auth_events WHERE kind = 'login_success' AND country = ? LIMIT 1`, country);
  }
}

function toEvent(r: EventRow): AuthEvent {
  return {
    ...r,
    at: new Date(r.at).toISOString(),
    last_at: new Date(r.last_at).toISOString(),
    known_device: r.known_device === null ? null : r.known_device === 1,
  };
}

/** A CSV cell. Text starting with = + - @ (or a tab or carriage return) is prefixed with ' so a spreadsheet shows it as text. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n']/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
