import {
  type SessionInfo,
  type SessionTimeouts,
  checkPasswordStrength,
  hashPassword,
  hmacSha256Hex,
  isPasswordHash,
  randomToken,
  sha256Hex,
  timingSafeEqual,
  verifyPassword,
} from "@talorys/shared";
import type { Database } from "../db/database";
import type { SettingsService } from "../services/settings";
import { AppError, ValidationError } from "../api/errors";

/** A session's use and presence are written at most this often (writes on the Free plan are counted). */
export const TOUCH_INTERVAL_MS = 60_000;
/** Sensitive actions need the password typed within this window: at sign-in or with confirm(). */
export const STEP_UP_WINDOW_MS = 15 * 60_000;

export const LOGIN_WINDOW_MS = 15 * 60_000;
export const MAX_FAILURES_PER_CLIENT = 5;
export const MAX_FAILURES_GLOBAL = 25;
/**
 * Past this many failures in the window, networks the owner hasn't used get no attempt at all,
 * so an attacker with many addresses (an IPv6 /48 holds 65,536 /64s) can't buy guesses with them.
 */
export const MAX_FAILURES_GLOBAL_HARD = 100;
/** A network with a successful sign-in this recent is the owner's, and exempt from the global cap. */
export const TRUSTED_CLIENT_MS = 30 * 24 * 3600_000;
/** While the global cap is tripped, the owner hears about it at most this often. */
export const ATTACK_ALERT_INTERVAL_MS = 6 * 3600_000;

const OVERRIDE_KEY = "auth.password_override";
const FINGERPRINT_KEY = "auth.secret_fingerprint";
const ATTACK_ALERT_KEY = "auth.attack_alerted_at";

/** Tells the owner something about their account (a notification). */
export type OwnerAlert = (title: string, body: string) => void;

/** Why a session ended on its own; recorded in the activity log. */
export type SessionEnd = "idle" | "presence" | "max";

/** When each of the session's three deadlines falls, and the timeouts behind them. */
export interface SessionDeadlines {
  /** The server's clock when this was computed, so a browser with a wrong clock can still count down. */
  now: string;
  idle_at: string;
  presence_at: string;
  max_at: string;
  timeouts: SessionTimeouts;
}

interface SessionRow {
  id: string;
  created_at: string;
  confirmed_at: string | null;
  /** Last time the owner used the app (a request their own input started). */
  last_seen_at: string;
  /** Last time an open tab answered; null for sessions from before presence existed. */
  last_presence_at: string | null;
  expires_at: string;
  user_agent: string;
}

export interface AuthSecrets {
  passwordHash?: string;
  /** Plain owner password, for deploys that cannot hash it ahead of time. Used only without a valid passwordHash. */
  password?: string;
  sessionSecret?: string;
}

/**
 * Single-owner authentication.
 *
 * The installer stores a PBKDF2 hash of the owner password as the Worker secret
 * OWNER_PASSWORD_HASH; a one-Worker deploy may set the plain OWNER_PASSWORD
 * instead. Password changes from the UI are stored as an override in the
 * Durable Object. Resetting the password via the CLI replaces the secret,
 * which changes its fingerprint: the override is discarded and all sessions revoked.
 *
 * Session tokens are random 256-bit values held only in an HttpOnly cookie. The
 * database stores HMAC(SESSION_SECRET, token), so a storage leak cannot be replayed.
 */
export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly secrets: AuthSecrets,
    private readonly alert: OwnerAlert = () => {},
    private readonly ended: (reason: SessionEnd) => void = () => {},
  ) {}

  private timeouts(): SessionTimeouts {
    return this.settings.get().session;
  }

  /** The three deadlines (section 17 of the plan), whichever comes first ends the session. */
  private deadlines(row: SessionRow, t = this.timeouts()): { idle: number; presence: number; max: number } {
    const seen = Date.parse(row.last_seen_at);
    return {
      idle: seen + t.idleMinutes * 60_000,
      presence: Date.parse(row.last_presence_at ?? row.last_seen_at) + t.presenceMinutes * 60_000,
      // expires_at keeps a stricter limit set at sign-in; a lower maximum applies to open sessions too.
      max: Math.min(Date.parse(row.expires_at), Date.parse(row.created_at) + t.maxHours * 3600_000),
    };
  }

  private secretHash(): string | null {
    return isPasswordHash(this.secrets.passwordHash) ? this.secrets.passwordHash! : null;
  }

  /** A valid hash, or a plain password that passes the same strength check as the installer. */
  passwordConfigured(): boolean {
    const { password } = this.secrets;
    return this.secretHash() !== null || (!!password && checkPasswordStrength(password) === null);
  }

  isConfigured(): boolean {
    return this.passwordConfigured() && (this.secrets.sessionSecret?.length ?? 0) >= 32;
  }

  private requireConfigured(): { sessionSecret: string } {
    if (!this.isConfigured()) {
      throw new AppError(
        "NOT_CONFIGURED",
        "Owner credentials are not configured. Run the Talorys installer, or set a strong OWNER_PASSWORD and SESSION_SECRET with `wrangler secret put`.",
      );
    }
    return { sessionSecret: this.secrets.sessionSecret! };
  }

  /** Detects a CLI password reset (secret changed) and invalidates stale state, remote tokens included. */
  async syncSecretFingerprint(): Promise<void> {
    const { sessionSecret } = this.requireConfigured();
    const secret = this.secretHash() ?? `plain$${await hmacSha256Hex(sessionSecret, this.secrets.password!)}`;
    const fingerprint = (await sha256Hex(secret)).slice(0, 32);
    const stored = this.settings.getJson<string>(FINGERPRINT_KEY);
    if (stored === fingerprint) return;
    this.db.transaction(() => {
      if (stored !== null) {
        this.settings.delete(OVERRIDE_KEY);
        this.db.run(`DELETE FROM tal_sessions`);
        this.db.run(`DELETE FROM tal_remote_tokens`);
      }
      this.settings.setJson(FINGERPRINT_KEY, fingerprint);
    });
  }

  private async checkPassword(password: string): Promise<boolean> {
    const hash = this.settings.getJson<string>(OVERRIDE_KEY) ?? this.secretHash();
    if (hash) return verifyPassword(password, hash);
    const { sessionSecret } = this.requireConfigured();
    const encode = (value: string) => new TextEncoder().encode(value);
    const [given, expected] = await Promise.all([
      hmacSha256Hex(sessionSecret, password.normalize("NFKC")),
      hmacSha256Hex(sessionSecret, this.secrets.password!.normalize("NFKC")),
    ]);
    return timingSafeEqual(encode(given), encode(expected));
  }

  // ---------- Rate limiting ----------

  private recentFailures(client?: string): number {
    const since = Date.now() - LOGIN_WINDOW_MS;
    const row = client
      ? this.db.one<{ n: number }>(`SELECT count(*) AS n FROM tal_login_attempts WHERE success = 0 AND at > ? AND client = ?`, since, client)
      : this.db.one<{ n: number }>(`SELECT count(*) AS n FROM tal_login_attempts WHERE success = 0 AND at > ?`, since);
    return row?.n ?? 0;
  }

  /** True when this client signed in successfully within TRUSTED_CLIENT_MS: one of the owner's own networks. */
  private isTrustedClient(client: string): boolean {
    const since = Date.now() - TRUSTED_CLIENT_MS;
    return !!this.db.one(`SELECT 1 AS x FROM tal_login_attempts WHERE success = 1 AND client = ? AND at > ? LIMIT 1`, client, since);
  }

  /**
   * Throws RATE_LIMITED when the client has too many recent failures (5 in 15 minutes).
   *
   * A distributed attack (25 failures in 15 minutes across all networks) does not lock anyone
   * out (AUTH-02): the owner's recent networks keep their normal allowance, and any other
   * network gets a single attempt per window instead of five. Someone guessing from many
   * addresses is slowed to one guess per address, and the owner on a new network can still
   * type the right password once. The owner is told when this starts. Past
   * MAX_FAILURES_GLOBAL_HARD, unknown networks get no attempt until the window clears, which caps
   * the guesses (and the PBKDF2 work) however many addresses the attacker has.
   */
  assertLoginAllowed(client: string): void {
    const nowMs = Date.now();
    // Failures matter for a day; successes are kept as long as they mark a trusted network.
    this.db.run(`DELETE FROM tal_login_attempts WHERE (success = 0 AND at < ?) OR at < ?`, nowMs - 24 * 3600_000, nowMs - TRUSTED_CLIENT_MS);
    const failures = this.recentFailures(client);
    let blocked = failures >= MAX_FAILURES_PER_CLIENT;
    let globally = false;
    const total = blocked ? 0 : this.recentFailures();
    if (total >= MAX_FAILURES_GLOBAL) {
      this.alertUnderAttack(nowMs);
      if (!this.isTrustedClient(client)) {
        globally = total >= MAX_FAILURES_GLOBAL_HARD;
        blocked = globally || failures >= 1;
      }
    }
    if (blocked) {
      const oldest = this.db.one<{ at: number }>(
        `SELECT min(at) AS at FROM tal_login_attempts WHERE success = 0 AND at > ?${globally ? "" : " AND client = ?"}`,
        ...(globally ? [nowMs - LOGIN_WINDOW_MS] : [nowMs - LOGIN_WINDOW_MS, client]),
      );
      const retryAfter = Math.max(1, Math.ceil(((oldest?.at ?? nowMs) + LOGIN_WINDOW_MS - nowMs) / 1000));
      throw new AppError("RATE_LIMITED", "Too many failed attempts. Please wait before trying again.", { retry_after: retryAfter }, {
        "retry-after": String(retryAfter),
      });
    }
  }

  private alertUnderAttack(nowMs: number): void {
    const last = this.settings.getJson<number>(ATTACK_ALERT_KEY);
    if (typeof last === "number" && nowMs - last < ATTACK_ALERT_INTERVAL_MS) return;
    this.settings.setJson(ATTACK_ALERT_KEY, nowMs);
    this.alert(
      "Many failed sign-ins",
      "Many sign-in attempts with a wrong password came from different networks in the last 15 minutes. Until they stop, each unknown network gets one attempt every 15 minutes; your recent networks are not affected. If this wasn't you, consider putting Cloudflare Access in front of Talorys.",
    );
  }

  /**
   * Checks the limit and records the attempt as a failure in one synchronous step,
   * before the (async) password check. Otherwise concurrent requests could all pass
   * the check while PBKDF2 runs and bypass the limit. Returns the attempt id.
   */
  private beginAttempt(client: string): number {
    this.assertLoginAllowed(client);
    return this.db.one<{ id: number }>(
      `INSERT INTO tal_login_attempts (client, success, at) VALUES (?, 0, ?) RETURNING id`,
      client,
      Date.now(),
    )!.id;
  }

  private markAttemptSucceeded(attemptId: number): void {
    this.db.run(`UPDATE tal_login_attempts SET success = 1 WHERE id = ?`, attemptId);
  }

  // ---------- Login / sessions ----------

  async login(password: string, client: string, userAgent: string): Promise<{ token: string; expiresAt: Date }> {
    this.requireConfigured();
    await this.syncSecretFingerprint();
    const attempt = this.beginAttempt(client);
    const ok = await this.checkPassword(password);
    if (!ok) throw new AppError("UNAUTHORIZED", "Incorrect password.");
    this.markAttemptSucceeded(attempt);
    return this.createSession(userAgent);
  }

  private async sessionId(token: string): Promise<string> {
    return hmacSha256Hex(this.requireConfigured().sessionSecret, token);
  }

  async createSession(userAgent: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomToken(32);
    const id = await this.sessionId(token);
    const ts = new Date();
    const expiresAt = new Date(ts.getTime() + this.timeouts().maxHours * 3600_000);
    this.db.run(
      `INSERT INTO tal_sessions (id, created_at, last_seen_at, last_presence_at, expires_at, user_agent, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id, ts.toISOString(), ts.toISOString(), ts.toISOString(), expiresAt.toISOString(), userAgent.slice(0, 300), ts.toISOString(),
    );
    // Cap concurrent sessions; drop the least recently used beyond 20.
    this.db.run(`DELETE FROM tal_sessions WHERE id NOT IN (SELECT id FROM tal_sessions ORDER BY last_seen_at DESC LIMIT 20)`);
    return { token, expiresAt };
  }

  /**
   * Returns the session id when the token is valid; otherwise null. The server decides: a session
   * past any of its three deadlines is deleted here, whatever the browser thinks.
   *
   * Every request shows a tab is open (presence). Only `activity` requests, which the owner's own
   * input started, count as use: background polling alone never keeps a session alive.
   */
  async validate(token: string | undefined | null, opts: { activity?: boolean } = {}): Promise<string | null> {
    if (!token || token.length > 200 || !this.isConfigured()) return null;
    await this.syncSecretFingerprint();
    const id = await this.sessionId(token);
    const row = this.db.one<SessionRow>(`SELECT * FROM tal_sessions WHERE id = ?`, id);
    if (!row) return null;
    if (this.endIfExpired(row)) return null;
    this.touch(row, opts.activity === true, false);
    return id;
  }

  /** Deletes a session past a deadline and records why. True when it ended. */
  private endIfExpired(row: SessionRow): boolean {
    const nowMs = Date.now();
    const d = this.deadlines(row);
    const reason: SessionEnd | null = nowMs >= d.max ? "max" : nowMs >= d.idle ? "idle" : nowMs >= d.presence ? "presence" : null;
    if (!reason) return false;
    this.db.run(`DELETE FROM tal_sessions WHERE id = ?`, row.id);
    this.ended(reason);
    return true;
  }

  /** Renews presence, and use when `activity`; at most one write a minute unless `force`. */
  private touch(row: SessionRow, activity: boolean, force: boolean): void {
    const nowMs = Date.now();
    const at = new Date(nowMs).toISOString();
    const stale = (iso: string | null) => force || !iso || nowMs - Date.parse(iso) >= TOUCH_INTERVAL_MS;
    if (activity && stale(row.last_seen_at)) {
      this.db.run(`UPDATE tal_sessions SET last_seen_at = ?, last_presence_at = ? WHERE id = ?`, at, at, row.id);
    } else if (stale(row.last_presence_at)) {
      this.db.run(`UPDATE tal_sessions SET last_presence_at = ? WHERE id = ?`, at, row.id);
    }
  }

  /**
   * The open app's signal (POST /api/auth/heartbeat): always renews presence, renews use only when
   * the owner used some tab since the last one. Answers with the deadlines, so the browser's
   * warning follows the server's clock instead of guessing.
   */
  heartbeat(sessionId: string, active: boolean): SessionDeadlines {
    const row = this.db.one<SessionRow>(`SELECT * FROM tal_sessions WHERE id = ?`, sessionId);
    if (!row || this.endIfExpired(row)) throw new AppError("UNAUTHORIZED", "Please sign in.");
    this.touch(row, active, true);
    return this.sessionDeadlines(sessionId)!;
  }

  sessionDeadlines(sessionId: string): SessionDeadlines | null {
    const row = this.db.one<SessionRow>(`SELECT * FROM tal_sessions WHERE id = ?`, sessionId);
    if (!row) return null;
    const timeouts = this.timeouts();
    const d = this.deadlines(row, timeouts);
    const iso = (ms: number) => new Date(ms).toISOString();
    return { now: iso(Date.now()), idle_at: iso(Math.min(d.idle, d.max)), presence_at: iso(Math.min(d.presence, d.max)), max_at: iso(d.max), timeouts };
  }

  revoke(sessionId: string): void {
    this.db.run(`DELETE FROM tal_sessions WHERE id = ?`, sessionId);
  }

  revokeAllExcept(sessionId: string | null): number {
    return this.db.run(`DELETE FROM tal_sessions WHERE id != ?`, sessionId ?? "").changes;
  }

  /**
   * Checks the password again for a signed-in session (same rate limit as sign-in) and opens
   * the step-up window. A wrong password is FORBIDDEN, not UNAUTHORIZED: the session stays valid.
   */
  async confirm(sessionId: string, password: string, client: string): Promise<Date> {
    this.requireConfigured();
    await this.syncSecretFingerprint();
    const attempt = this.beginAttempt(client);
    if (!(await this.checkPassword(password))) throw new AppError("FORBIDDEN", "Incorrect password.");
    this.markAttemptSucceeded(attempt);
    const at = new Date();
    this.db.run(`UPDATE tal_sessions SET confirmed_at = ? WHERE id = ?`, at.toISOString(), sessionId);
    return new Date(at.getTime() + STEP_UP_WINDOW_MS);
  }

  /** True when this session's password was typed within STEP_UP_WINDOW_MS. */
  recentlyConfirmed(sessionId: string): boolean {
    const row = this.db.one<{ confirmed_at: string | null }>(`SELECT confirmed_at FROM tal_sessions WHERE id = ?`, sessionId);
    return !!row?.confirmed_at && Date.parse(row.confirmed_at) + STEP_UP_WINDOW_MS > Date.now();
  }

  listSessions(currentId: string | null): SessionInfo[] {
    return this.db
      .all<SessionRow>(`SELECT * FROM tal_sessions ORDER BY last_seen_at DESC`)
      // A session past a deadline ends here too, so the list never shows one that can't be used.
      .filter((row) => !this.endIfExpired(row))
      .map(({ confirmed_at: _, last_presence_at: __, ...s }) => ({ ...s, id: s.id.slice(0, 16), current: s.id === currentId }));
  }

  /** Revokes a session by the shortened public id shown in the UI. */
  revokeByPublicId(publicId: string): boolean {
    if (!/^[0-9a-f]{16}$/.test(publicId)) return false;
    return this.db.run(`DELETE FROM tal_sessions WHERE substr(id, 1, 16) = ?`, publicId).changes > 0;
  }

  /**
   * Every session ends, the caller's too, along with all access tokens: whoever held one
   * before the change has nothing left. The route signs the caller back in with a new session.
   */
  async changePassword(current: string, next: string, client: string): Promise<void> {
    this.requireConfigured();
    await this.syncSecretFingerprint();
    const attempt = this.beginAttempt(client);
    if (!(await this.checkPassword(current))) {
      throw new AppError("UNAUTHORIZED", "Current password is incorrect.");
    }
    this.markAttemptSucceeded(attempt);
    const problem = checkPasswordStrength(next);
    if (problem) throw new ValidationError(problem);
    const hash = await hashPassword(next);
    this.db.transaction(() => {
      this.settings.setJson(OVERRIDE_KEY, hash);
      this.db.run(`DELETE FROM tal_sessions`);
      this.db.run(`DELETE FROM tal_remote_tokens`);
    });
  }
}
