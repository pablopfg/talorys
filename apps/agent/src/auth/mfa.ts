import {
  MFA_CHALLENGE_TTL_MS,
  MFA_WRONG_CODES_GLOBAL,
  MFA_WRONG_CODES_WINDOW_MS,
  MFA_MAX_ATTEMPTS,
  MFA_SETUP_TTL_MS,
  type MfaSetup,
  type MfaStatus,
  RECOVERY_CODE_COUNT,
  fromBase64Url,
  hashRecoveryCode,
  hmacSha256Hex,
  matchTotp,
  newRecoveryCode,
  newTotpSecret,
  otpauthUri,
  randomToken,
  toBase64Url,
} from "@talorys/shared";
import type { Database } from "../db/database";
import type { SettingsService } from "../services/settings";

const MFA_KEY = "auth.mfa";
const PENDING_KEY = "auth.mfa_pending";
const WRONG_KEY = "auth.mfa_wrong";
const VERSION = "v1";
const encoder = new TextEncoder();

interface StoredMfa {
  /** AES-GCM ciphertext of the base32 secret (see `seal`). */
  secret: string;
  enabled_at: string;
  /** The last time step a code was accepted for; that step and earlier ones never count again. */
  last_step: number | null;
  /** SHA-256 of each unused recovery code. */
  codes: string[];
  /** Wrong codes in a row since the last right one, for the alert. */
  failures: number;
}

interface PendingMfa {
  secret: string;
  expires_at: number;
}

export interface ChallengeRow {
  id: string;
  created_at: number;
  expires_at: number;
  attempts: number;
  login_attempt: number | null;
  weak_password: number;
  user_agent: string;
}

/** Which second step was used: recorded in the sign-in activity. */
export type MfaFactor = "totp" | "recovery_code" | "passkey";

/**
 * The second sign-in step (authenticator app and recovery codes) for the single owner.
 *
 * The TOTP secret is stored encrypted with AES-256-GCM under a key derived (HKDF) from
 * SESSION_SECRET, so a copy of the Durable Object's storage alone can't produce codes. Recovery
 * codes are kept only as hashes. A sign-in waiting for its code is a challenge row keyed by
 * HMAC(SESSION_SECRET, cookie value): the cookie alone opens nothing, and the row alone is useless.
 */
export class MfaService {
  private key: Promise<CryptoKey> | null = null;

  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly sessionSecret: () => string,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  private stored(): StoredMfa | null {
    const value = this.settings.getJson<StoredMfa>(MFA_KEY);
    return value && typeof value.secret === "string" ? value : null;
  }

  enabled(): boolean {
    return this.stored() !== null;
  }

  status(): MfaStatus {
    const s = this.stored();
    return { enabled: !!s, enabled_at: s?.enabled_at ?? null, recovery_codes_left: s?.codes.length ?? 0 };
  }

  private cryptoKey(): Promise<CryptoKey> {
    this.key ??= crypto.subtle
      .importKey("raw", encoder.encode(this.sessionSecret()), "HKDF", false, ["deriveKey"])
      .then((base) =>
        crypto.subtle.deriveKey(
          { name: "HKDF", hash: "SHA-256", salt: encoder.encode("talorys-mfa"), info: encoder.encode("totp-secret-v1") },
          base,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"],
        ),
      );
    return this.key;
  }

  private async seal(secret: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(MFA_KEY) }, await this.cryptoKey(), encoder.encode(secret));
    return `${VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(sealed))}`;
  }

  /** Null when the ciphertext can't be opened (SESSION_SECRET changed): only a recovery code works then. */
  private async open(sealed: string): Promise<string | null> {
    const [version, iv, data] = sealed.split(".");
    if (version !== VERSION || !iv || !data) return null;
    try {
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64Url(iv) as Uint8Array<ArrayBuffer>, additionalData: encoder.encode(MFA_KEY) },
        await this.cryptoKey(),
        fromBase64Url(data) as Uint8Array<ArrayBuffer>,
      );
      return new TextDecoder().decode(plain);
    } catch {
      return null;
    }
  }

  // ---------- Setup ----------

  /** A new secret to scan; nothing changes until `enable` gets a code made from it. */
  async beginSetup(account: string): Promise<MfaSetup> {
    const secret = newTotpSecret();
    const expires = this.clock() + MFA_SETUP_TTL_MS;
    this.settings.setJson(PENDING_KEY, { secret: await this.seal(secret), expires_at: expires } satisfies PendingMfa);
    return { secret, otpauth_uri: otpauthUri(secret, account), expires_at: new Date(expires).toISOString() };
  }

  /** Turns the second step on with the pending secret. Returns the recovery codes, shown once; null for a wrong code. */
  async enable(code: string): Promise<string[] | null> {
    const pending = this.settings.getJson<PendingMfa>(PENDING_KEY);
    if (!pending || pending.expires_at < this.clock()) return null;
    const secret = await this.open(pending.secret);
    if (!secret) return null;
    const step = await matchTotp(secret, code, null, this.clock());
    if (step === null) return null;
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    const hashes = await Promise.all(codes.map(async (c) => (await hashRecoveryCode(c))!));
    this.db.transaction(() => {
      this.settings.setJson(MFA_KEY, {
        secret: pending.secret,
        enabled_at: new Date(this.clock()).toISOString(),
        last_step: step,
        codes: hashes,
        failures: 0,
      } satisfies StoredMfa);
      this.settings.delete(PENDING_KEY);
    });
    return codes;
  }

  /** Turns it off: the secret, the codes, the passkeys and any sign-in waiting for its second step are gone. */
  disable(): void {
    this.db.transaction(() => {
      this.settings.delete(MFA_KEY);
      this.settings.delete(PENDING_KEY);
      this.settings.delete(WRONG_KEY);
      this.settings.delete("auth.passkey_pending");
      this.db.run(`DELETE FROM tal_mfa_challenges`);
      // Passkeys are a second step too; without the recovery codes behind them they'd have no way back.
      this.db.run(`DELETE FROM tal_passkeys`);
    });
  }

  /** New recovery codes; the old ones stop working. */
  async regenerateCodes(): Promise<string[]> {
    const s = this.stored();
    if (!s) return [];
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    const hashes = await Promise.all(codes.map(async (c) => (await hashRecoveryCode(c))!));
    this.settings.setJson(MFA_KEY, { ...s, codes: hashes } satisfies StoredMfa);
    return codes;
  }

  // ---------- Checking a code ----------

  /**
   * Checks an authenticator code (never one already used) or, when `recovery` allows it, a
   * recovery code, which is used up. Returns the factor that matched, or null.
   */
  async verify(code: string, opts: { recovery: boolean }): Promise<MfaFactor | null> {
    const s = this.stored();
    if (!s) return null;
    const secret = await this.open(s.secret);
    const step = secret ? await matchTotp(secret, code, s.last_step, this.clock()) : null;
    // Read again after the awaits: a concurrent request may have used a step or a code meanwhile.
    const now = this.stored();
    if (!now) return null;
    if (step !== null && (now.last_step === null || step > now.last_step)) {
      this.settings.setJson(MFA_KEY, { ...now, last_step: step, failures: 0 } satisfies StoredMfa);
      return "totp";
    }
    if (opts.recovery) {
      const hash = await hashRecoveryCode(code);
      const latest = this.stored();
      if (hash && latest?.codes.includes(hash)) {
        this.settings.setJson(MFA_KEY, { ...latest, codes: latest.codes.filter((c) => c !== hash), failures: 0 } satisfies StoredMfa);
        return "recovery_code";
      }
    }
    const latest = this.stored();
    if (latest) this.settings.setJson(MFA_KEY, { ...latest, failures: latest.failures + 1 } satisfies StoredMfa);
    return null;
  }

  /** Wrong codes in a row since the last right one. */
  consecutiveFailures(): number {
    return this.stored()?.failures ?? 0;
  }

  // ---------- Sign-in challenges ----------

  private async challengeId(token: string): Promise<string> {
    return hmacSha256Hex(this.sessionSecret(), `mfa:${token}`);
  }

  /** Starts the second step of a sign-in. Returns the cookie value. */
  async createChallenge(loginAttempt: number, weakPassword: boolean, userAgent: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomToken(32);
    const id = await this.challengeId(token);
    const now = this.clock();
    this.db.run(`DELETE FROM tal_mfa_challenges WHERE expires_at < ?`, now);
    this.db.run(
      `INSERT INTO tal_mfa_challenges (id, created_at, expires_at, attempts, login_attempt, weak_password, user_agent) VALUES (?, ?, ?, 0, ?, ?, ?)`,
      id,
      now,
      now + MFA_CHALLENGE_TTL_MS,
      loginAttempt,
      weakPassword ? 1 : 0,
      userAgent.slice(0, 300),
    );
    // A handful of browsers half-way through signing in is plenty; the oldest go first.
    this.db.run(`DELETE FROM tal_mfa_challenges WHERE id NOT IN (SELECT id FROM tal_mfa_challenges ORDER BY created_at DESC LIMIT 5)`);
    return { token, expiresAt: new Date(now + MFA_CHALLENGE_TTL_MS) };
  }

  /** The live challenge for a cookie value; "expired" when it ran out (and is gone now), null when unknown. */
  async findChallenge(token: string | null): Promise<ChallengeRow | "expired" | null> {
    if (!token || token.length > 200) return null;
    const id = await this.challengeId(token);
    const row = this.db.one<ChallengeRow>(`SELECT * FROM tal_mfa_challenges WHERE id = ?`, id);
    if (!row) return null;
    if (row.expires_at < this.clock() || row.attempts >= MFA_MAX_ATTEMPTS) {
      this.deleteChallenge(row.id);
      return "expired";
    }
    return row;
  }

  /**
   * Takes one try from the challenge before the code is checked, in one synchronous step, so
   * requests sent in parallel with the same cookie can't all see the same count. Returns the
   * tries used, or null when none are left (the challenge is gone then).
   */
  reserveAttempt(id: string): number | null {
    const row = this.db.one<{ attempts: number }>(
      `UPDATE tal_mfa_challenges SET attempts = attempts + 1 WHERE id = ? AND attempts < ? RETURNING attempts`,
      id,
      MFA_MAX_ATTEMPTS,
    );
    if (!row) this.deleteChallenge(id);
    return row?.attempts ?? null;
  }

  /** Wrong sign-in codes across every challenge and network in the window, newest last. */
  private wrongCodeTimes(): number[] {
    const since = this.clock() - MFA_WRONG_CODES_WINDOW_MS;
    const times = this.settings.getJson<number[]>(WRONG_KEY);
    return Array.isArray(times) ? times.filter((t) => typeof t === "number" && t > since) : [];
  }

  /** Counts a wrong sign-in code towards the cap shared by all networks. */
  noteWrongCode(): void {
    this.settings.setJson(WRONG_KEY, [...this.wrongCodeTimes(), this.clock()].slice(-MFA_WRONG_CODES_GLOBAL));
  }

  /** When codes may be tried again from a network that isn't the owner's, or null when they may now. */
  wrongCodesBlockedUntil(): number | null {
    const times = this.wrongCodeTimes();
    return times.length >= MFA_WRONG_CODES_GLOBAL ? times[0]! + MFA_WRONG_CODES_WINDOW_MS : null;
  }

  deleteChallenge(id: string): void {
    this.db.run(`DELETE FROM tal_mfa_challenges WHERE id = ?`, id);
  }
}
