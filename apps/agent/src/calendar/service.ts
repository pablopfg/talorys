import {
  type CalendarMode,
  GOOGLE_CALENDAR_CALLBACK_PATH,
  type GoogleCalendarInfo,
  type GoogleCalendarStatus,
  randomToken,
  sha256Hex,
  toBase64Url,
} from "@talorys/shared";
import { AppError, NotFoundError, ValidationError } from "../api/errors";
import type { Database } from "../db/database";
import type { Env } from "../env";
import { McpCredentials } from "../mcp/credentials";
import { sameSecret } from "../mcp/oauth";
import type { ActivityLog } from "../services/usage";
import type { SettingsService } from "../services/settings";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

/**
 * The narrowest scopes that do the job: the list of calendars (read only) and events on them.
 * Nothing else in the account (Gmail, Drive, contacts, settings, sharing) is asked for.
 */
export const GOOGLE_CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar.calendarlist.readonly", "https://www.googleapis.com/auth/calendar.events"];

const PENDING_KEY = "calendar.oauth_pending";
/** Associated data for the sealed tokens: a ciphertext copied elsewhere doesn't open. */
const SEAL_AD = "google-calendar";
const PENDING_TTL_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
/** Google answers are read up to this size; a calendar page of 50 events is far smaller. */
const MAX_RESPONSE_BYTES = 1024 * 1024;
const WRITABLE_ROLES = new Set(["owner", "writer"]);

export interface CalendarNetwork {
  fetch: typeof fetch;
}

interface PendingConnect {
  state_hash: string;
  verifier: string;
  redirect_uri: string;
  expires_at: number;
}

interface AccountRow {
  email: string;
  refresh_token: string;
  access_token: string | null;
  access_expires_at: number | null;
  scopes: string;
  status: "connected" | "error";
  error: string | null;
  connected_at: string;
}

interface CalendarRow {
  id: string;
  name: string;
  access_role: string;
  time_zone: string | null;
  is_primary: number;
  mode: CalendarMode;
}

/** A Google error turned into words for the owner or the model; never the raw response. */
export class CalendarError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = "CalendarError";
  }
}

/** Text from Google (calendar names): no control characters, bounded. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point.
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩\u200b-\u200d\u2060\ufeff]/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * The Google Calendar connection: OAuth with PKCE, tokens sealed with AES-256-GCM (key from
 * MCP_CREDENTIAL_KEY) and never in backups or exports, and what the agent may do per calendar.
 */
export class CalendarService {
  network: CalendarNetwork = { fetch: (input, init) => fetch(input, init) };
  private readonly credentials: McpCredentials;

  constructor(
    private readonly db: Database,
    private readonly env: Env,
    private readonly settings: SettingsService,
    private readonly activity: ActivityLog,
  ) {
    this.credentials = new McpCredentials(env.MCP_CREDENTIAL_KEY);
  }

  get configured(): boolean {
    return !!this.env.GOOGLE_CLIENT_ID?.trim() && !!this.env.GOOGLE_CLIENT_SECRET?.trim() && this.credentials.available;
  }

  private account(): AccountRow | null {
    return this.db.one<AccountRow>(`SELECT * FROM tal_google_account WHERE id = 1`);
  }

  private rows(): CalendarRow[] {
    return this.db.all<CalendarRow>(`SELECT * FROM tal_google_calendars ORDER BY is_primary DESC, name`);
  }

  private present(row: CalendarRow): GoogleCalendarInfo {
    return {
      id: row.id,
      name: row.name,
      access_role: row.access_role,
      time_zone: row.time_zone,
      primary: row.is_primary === 1,
      mode: row.mode,
      writable: WRITABLE_ROLES.has(row.access_role),
    };
  }

  status(): GoogleCalendarStatus {
    const account = this.account();
    return {
      configured: this.configured,
      connected: !!account,
      email: account?.email ?? null,
      status: account?.status ?? null,
      error: account?.error ?? null,
      connected_at: account?.connected_at ?? null,
      calendars: account ? this.rows().map((r) => this.present(r)) : [],
    };
  }

  /** Calendars the agent may read (mode read or write), for the tools. */
  readable(): GoogleCalendarInfo[] {
    if (!this.account()) return [];
    return this.rows()
      .filter((r) => r.mode !== "off")
      .map((r) => this.present(r));
  }

  writable(): GoogleCalendarInfo[] {
    return this.readable().filter((c) => c.mode === "write" && c.writable);
  }

  /** One calendar by id, as stored, for approval snapshots. */
  calendar(id: string): GoogleCalendarInfo | null {
    const row = this.db.one<CalendarRow>(`SELECT * FROM tal_google_calendars WHERE id = ?`, id);
    return row && this.account() ? this.present(row) : null;
  }

  accountEmail(): string | null {
    return this.account()?.email ?? null;
  }

  private assertConfigured(): void {
    if (!this.configured) {
      throw new AppError(
        "NOT_CONFIGURED",
        "Google Calendar isn't set up on this deployment. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and MCP_CREDENTIAL_KEY (see the Google Calendar guide).",
      );
    }
  }

  // ---------- Connecting ----------

  /** The Google page where the owner allows access. Nothing is stored until `finishConnect`. */
  async beginConnect(origin: string): Promise<string> {
    this.assertConfigured();
    const state = randomToken(32);
    const verifier = randomToken(48);
    const challenge = toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const redirect = new URL(GOOGLE_CALENDAR_CALLBACK_PATH, origin).href;
    this.settings.setJson(PENDING_KEY, {
      state_hash: await sha256Hex(state),
      verifier: await this.credentials.encrypt(SEAL_AD, verifier),
      redirect_uri: redirect,
      expires_at: Date.now() + PENDING_TTL_MS,
    } satisfies PendingConnect);
    const url = new URL(GOOGLE_AUTH_URL);
    url.search = new URLSearchParams({
      client_id: this.env.GOOGLE_CLIENT_ID!.trim(),
      redirect_uri: redirect,
      response_type: "code",
      scope: GOOGLE_CALENDAR_SCOPES.join(" "),
      access_type: "offline",
      // Asked every time, so Google always returns a refresh token.
      prompt: "consent",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    return url.href;
  }

  /**
   * Finishes the connection from the callback page: the state is single use, expires in 10
   * minutes and must match; the code is redeemed with PKCE and the client secret.
   */
  async finishConnect(input: { state: string; code?: string; error?: string }): Promise<GoogleCalendarStatus> {
    this.assertConfigured();
    const pending = this.settings.getJson<PendingConnect>(PENDING_KEY);
    this.settings.delete(PENDING_KEY);
    const expired = () => new ValidationError("This Google sign-in expired or was already used. Start again from Settings → Integrations.");
    if (!pending || pending.expires_at < Date.now() || !sameSecret(pending.state_hash, await sha256Hex(input.state))) throw expired();
    if (input.error || !input.code) throw new ValidationError("Google access wasn't allowed. Connect again to retry.");
    const verifier = await this.credentials.decrypt(SEAL_AD, pending.verifier);
    if (!verifier) throw expired();
    const token = await this.tokenRequest({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: pending.redirect_uri,
      code_verifier: verifier,
    });
    if (typeof token.refresh_token !== "string" || !token.refresh_token) {
      throw new CalendarError("Google didn't grant lasting access. Connect again and allow every permission asked.");
    }
    const scopes = typeof token.scope === "string" ? token.scope : "";
    if (!GOOGLE_CALENDAR_SCOPES.every((s) => scopes.split(" ").includes(s))) {
      // Unticked permissions on Google's page: give back what was granted and stop. Not while an
      // account is connected: revoking ends the whole grant, which may be that account's.
      if (!this.account()) await this.revoke(token.refresh_token);
      throw new ValidationError("Allow both permissions on Google's page (see your calendars, and see and edit their events). Connect again to retry.");
    }
    const access = this.accessFrom(token);
    const list = await this.calendarList(access.token);
    const primary = list.find((c) => c.primary);
    const email = cleanText(primary?.id ?? "", 320);
    if (!email) throw new CalendarError("Google didn't return your main calendar. Try connecting again.");
    const previous = this.account();
    const now = new Date().toISOString();
    const sealedRefresh = await this.credentials.encrypt(SEAL_AD, token.refresh_token);
    const sealedAccess = await this.credentials.encrypt(SEAL_AD, access.token);
    this.db.transaction(() => {
      // Another account starts from nothing: its calendars are off until the owner turns them on.
      if (previous && previous.email !== email) this.db.run(`DELETE FROM tal_google_calendars`);
      this.db.run(
        `INSERT INTO tal_google_account (id, email, refresh_token, access_token, access_expires_at, scopes, status, error, connected_at, checked_at)
         VALUES (1, ?, ?, ?, ?, ?, 'connected', NULL, ?, ?)
         ON CONFLICT(id) DO UPDATE SET email = excluded.email, refresh_token = excluded.refresh_token, access_token = excluded.access_token,
           access_expires_at = excluded.access_expires_at, scopes = excluded.scopes, status = 'connected', error = NULL,
           connected_at = excluded.connected_at, checked_at = excluded.checked_at`,
        email,
        sealedRefresh,
        sealedAccess,
        access.expiresAt,
        scopes,
        now,
        now,
      );
      this.storeCalendars(list);
    });
    // An earlier token for a replaced account is given back to Google. Not for the same account:
    // revoking ends the whole grant, the token just stored included.
    if (previous && previous.email !== email) {
      const old = await this.credentials.decrypt(SEAL_AD, previous.refresh_token);
      if (old && old !== token.refresh_token) await this.revoke(old);
    }
    this.activity.record("calendar.connected", "Google Calendar connected");
    return this.status();
  }

  private storeCalendars(list: GoogleCalendarEntry[]): void {
    const now = new Date().toISOString();
    const ids = list.map((c) => c.id);
    for (const c of list) {
      const role = WRITABLE_ROLES.has(c.accessRole) || c.accessRole === "reader" || c.accessRole === "freeBusyReader" ? c.accessRole : "reader";
      this.db.run(
        `INSERT INTO tal_google_calendars (id, name, access_role, time_zone, is_primary, mode, updated_at) VALUES (?, ?, ?, ?, ?, 'off', ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, access_role = excluded.access_role, time_zone = excluded.time_zone,
           is_primary = excluded.is_primary, updated_at = excluded.updated_at`,
        c.id,
        cleanText(c.summaryOverride || c.summary || c.id, 120) || c.id,
        role,
        c.timeZone ? cleanText(c.timeZone, 64) : null,
        c.primary ? 1 : 0,
        now,
      );
    }
    // Write access Google took away is taken away here too.
    this.db.run(`UPDATE tal_google_calendars SET mode = 'read' WHERE mode = 'write' AND access_role NOT IN ('owner', 'writer')`);
    // Only events can be read, so a free/busy-only calendar is never on.
    this.db.run(`UPDATE tal_google_calendars SET mode = 'off' WHERE access_role = 'freeBusyReader'`);
    if (ids.length) this.db.run(`DELETE FROM tal_google_calendars WHERE id NOT IN (${ids.map(() => "?").join(",")})`, ...ids);
    else this.db.run(`DELETE FROM tal_google_calendars`);
  }

  /** Reads the calendar list again (new or removed calendars, changed roles). */
  async refreshCalendars(): Promise<GoogleCalendarStatus> {
    this.assertConfigured();
    if (!this.account()) throw new AppError("CONFLICT", "Connect Google Calendar first.");
    const list = await this.calendarList(await this.accessToken());
    this.db.transaction(() => this.storeCalendars(list));
    return this.status();
  }

  setMode(id: string, mode: CalendarMode): GoogleCalendarInfo {
    const row = this.account() ? this.db.one<CalendarRow>(`SELECT * FROM tal_google_calendars WHERE id = ?`, id) : null;
    if (!row) throw new NotFoundError("Calendar not found.");
    if (mode === "write" && !WRITABLE_ROLES.has(row.access_role)) throw new ValidationError("Google only lets you read this calendar.");
    if (mode !== "off" && row.access_role === "freeBusyReader") throw new ValidationError("This calendar only shares free and busy times, so there's nothing to read.");
    this.db.run(`UPDATE tal_google_calendars SET mode = ?, updated_at = ? WHERE id = ?`, mode, new Date().toISOString(), id);
    return this.present({ ...row, mode });
  }

  /** Forgets the account here and gives its access back to Google. */
  async disconnect(): Promise<void> {
    const account = this.account();
    this.db.transaction(() => {
      this.db.run(`DELETE FROM tal_google_account`);
      this.db.run(`DELETE FROM tal_google_calendars`);
      this.settings.delete(PENDING_KEY);
    });
    if (account) {
      const refresh = await this.credentials.decrypt(SEAL_AD, account.refresh_token);
      if (refresh) await this.revoke(refresh);
      this.activity.record("calendar.disconnected", "Google Calendar disconnected");
    }
  }

  // ---------- Tokens ----------

  private accessFrom(token: Record<string, unknown>): { token: string; expiresAt: number } {
    if (typeof token.access_token !== "string" || !token.access_token) throw new CalendarError("Google didn't return an access token. Try again.");
    const seconds = typeof token.expires_in === "number" && token.expires_in > 0 ? token.expires_in : 3600;
    return { token: token.access_token, expiresAt: Date.now() + seconds * 1000 };
  }

  private async tokenRequest(params: Record<string, string>): Promise<Record<string, unknown>> {
    const res = await this.send(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...params, client_id: this.env.GOOGLE_CLIENT_ID!.trim(), client_secret: this.env.GOOGLE_CLIENT_SECRET!.trim() }).toString(),
    });
    const body = await readJson(res);
    if (!res.ok) {
      if (body?.error === "invalid_grant") throw new CalendarError("Google access was revoked or expired. Connect again in Settings → Integrations.", 401);
      throw new CalendarError("Google refused the sign-in. Check GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and the redirect address in the Google Cloud console.", res.status);
    }
    return body ?? {};
  }

  /** A current access token, refreshed when it is about to expire. Marks the account when Google refuses. */
  async accessToken(force = false): Promise<string> {
    this.assertConfigured();
    const account = this.account();
    if (!account) throw new CalendarError("Google Calendar isn't connected.");
    if (!force && account.access_token && (account.access_expires_at ?? 0) > Date.now() + 60_000) {
      const cached = await this.credentials.decrypt(SEAL_AD, account.access_token);
      if (cached) return cached;
    }
    const refresh = await this.credentials.decrypt(SEAL_AD, account.refresh_token);
    if (!refresh) {
      this.markError("The stored Google access can't be opened (MCP_CREDENTIAL_KEY changed). Connect again in Settings → Integrations.");
      throw new CalendarError("Google Calendar needs to be connected again.");
    }
    try {
      const token = this.accessFrom(await this.tokenRequest({ grant_type: "refresh_token", refresh_token: refresh }));
      this.db.run(
        `UPDATE tal_google_account SET access_token = ?, access_expires_at = ?, status = 'connected', error = NULL, checked_at = ? WHERE id = 1`,
        await this.credentials.encrypt(SEAL_AD, token.token),
        token.expiresAt,
        new Date().toISOString(),
      );
      return token.token;
    } catch (error) {
      if (error instanceof CalendarError && error.status === 401) this.markError(error.message);
      throw error;
    }
  }

  private markError(message: string): void {
    this.db.run(`UPDATE tal_google_account SET status = 'error', error = ?, access_token = NULL, access_expires_at = NULL WHERE id = 1`, message);
  }

  private async revoke(token: string): Promise<void> {
    try {
      await this.send(GOOGLE_REVOKE_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
      });
    } catch {
      // Best effort: the token is forgotten here either way.
    }
  }

  // ---------- Calendar API ----------

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      // Google never redirects these calls; one that does is refused rather than followed.
      return await this.network.fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      throw new CalendarError("Couldn't reach Google Calendar. Try again in a minute.");
    }
  }

  /** A Calendar API call with the account's token, retried once with a new token after a 401. */
  async api(path: string, init: { method?: string; query?: Record<string, string>; body?: unknown; ifMatch?: string } = {}): Promise<{ status: number; body: Record<string, unknown> | null }> {
    const url = new URL(`${GOOGLE_CALENDAR_API}${path}`);
    if (init.query) url.search = new URLSearchParams(init.query).toString();
    for (const force of [false, true]) {
      const token = await this.accessToken(force);
      const res = await this.send(url.href, {
        method: init.method ?? "GET",
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
          ...(init.ifMatch ? { "if-match": init.ifMatch } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
      if (res.status === 401 && !force) continue;
      const body = res.status === 204 ? null : await readJson(res);
      if (res.ok) return { status: res.status, body };
      throw apiError(res.status);
    }
    throw new CalendarError("Google Calendar refused the request.");
  }

  private async calendarList(token: string): Promise<GoogleCalendarEntry[]> {
    const out: GoogleCalendarEntry[] = [];
    let pageToken: string | undefined;
    // A handful of pages covers any real account; the cap keeps a strange answer from looping.
    for (let page = 0; page < 5; page++) {
      const url = new URL(`${GOOGLE_CALENDAR_API}/users/me/calendarList`);
      url.search = new URLSearchParams({ maxResults: "250", minAccessRole: "freeBusyReader", ...(pageToken ? { pageToken } : {}) }).toString();
      const res = await this.send(url.href, { headers: { authorization: `Bearer ${token}` } });
      const body = await readJson(res);
      if (!res.ok) throw apiError(res.status);
      for (const item of Array.isArray(body?.items) ? body.items : []) {
        if (item && typeof item === "object" && typeof (item as GoogleCalendarEntry).id === "string") out.push(item as GoogleCalendarEntry);
      }
      pageToken = typeof body?.nextPageToken === "string" ? body.nextPageToken : undefined;
      if (!pageToken) break;
    }
    return out.slice(0, 100);
  }
}

interface GoogleCalendarEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  accessRole: string;
  timeZone?: string;
  primary?: boolean;
}

function apiError(status: number): CalendarError {
  if (status === 401 || status === 403) return new CalendarError("Google Calendar refused access. Check the connection in Settings → Integrations.", status);
  if (status === 404 || status === 410) return new CalendarError("That calendar or event doesn't exist anymore.", status);
  if (status === 412) return new CalendarError("The event changed in Google Calendar after it was proposed, so nothing was done. Ask again.", status);
  if (status === 429) return new CalendarError("Google Calendar is limiting requests right now. Try again in a minute.", status);
  return new CalendarError("Google Calendar couldn't do that right now. Try again later.", status);
}

/** A JSON body read up to MAX_RESPONSE_BYTES; null when it isn't JSON. */
async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const text = await res.text();
    if (text.length > MAX_RESPONSE_BYTES) return null;
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
