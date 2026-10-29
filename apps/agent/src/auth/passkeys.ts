import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  type VerifiedAuthenticationResponse,
  type VerifiedRegistrationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import {
  MAX_PASSKEYS,
  PASSKEY_TIMEOUT_MS,
  type PasskeyInfo,
  type passkeyAssertionSchema,
  type passkeyRegistrationSchema,
} from "@talorys/shared";
import type { z } from "zod";
import type { Database } from "../db/database";
import type { SettingsService } from "../services/settings";

const PENDING_KEY = "auth.passkey_pending";
const USER_KEY = "auth.passkey_user";

/** Where the browser is: the passkey's domain (rpID) and the exact origin its answer must name. */
export interface RelyingParty {
  rpId: string;
  origin: string;
}

interface PendingRegistration {
  challenge: string;
  rp_id: string;
  origin: string;
  expires_at: number;
}

interface PasskeyRow {
  id: string;
  name: string;
  public_key: string;
  counter: number;
  transports: string;
  rp_id: string;
  synced: number;
  created_at: string;
  last_used_at: string | null;
}

type Registration = z.infer<typeof passkeyRegistrationSchema>["response"];
type Assertion = z.infer<typeof passkeyAssertionSchema>["response"];

function transportsOf(row: PasskeyRow): string[] {
  try {
    const value: unknown = JSON.parse(row.transports);
    return Array.isArray(value) ? value.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Passkeys for the second sign-in step. Only public keys are stored; the challenge for each
 * ceremony is random, kept on the server, tied to one domain and origin, and used once. The
 * signature counter is checked so a cloned security key shows up.
 */
export class PasskeyService {
  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
    /** Whether two-step sign-in is on: passkeys exist only alongside it. */
    private readonly mfaEnabled: () => boolean,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  private rows(): PasskeyRow[] {
    return this.db.all<PasskeyRow>(`SELECT * FROM tal_passkeys ORDER BY created_at`);
  }

  list(rpId: string): PasskeyInfo[] {
    return this.rows().map((r) => ({
      id: r.id,
      name: r.name,
      created_at: r.created_at,
      last_used_at: r.last_used_at,
      synced: r.synced === 1,
      usable_here: r.rp_id === rpId,
    }));
  }

  /** Whether a passkey made for this domain exists. */
  usableHere(rpId: string): boolean {
    return !!this.db.one(`SELECT 1 AS x FROM tal_passkeys WHERE rp_id = ? LIMIT 1`, rpId);
  }

  count(): number {
    return this.db.one<{ n: number }>(`SELECT count(*) AS n FROM tal_passkeys`)?.n ?? 0;
  }

  /** A random handle for the owner, the same for every passkey: it names no one. */
  private userId(): Uint8Array<ArrayBuffer> {
    let id = this.settings.getJson<string>(USER_KEY);
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{22,}$/.test(id)) {
      id = isoBase64URL.fromBuffer(crypto.getRandomValues(new Uint8Array(16)));
      this.settings.setJson(USER_KEY, id);
    }
    return isoBase64URL.toBuffer(id) as Uint8Array<ArrayBuffer>;
  }

  // ---------- Adding a passkey ----------

  /** What the browser needs to create a passkey. Nothing is stored until `register` gets its answer. */
  async registrationOptions(rp: RelyingParty, names: { rpName: string; userName: string }) {
    const options = await generateRegistrationOptions({
      rpName: names.rpName,
      rpID: rp.rpId,
      userName: names.userName,
      userDisplayName: names.userName,
      userID: this.userId(),
      timeout: PASSKEY_TIMEOUT_MS,
      attestationType: "none",
      // The same authenticator twice adds nothing.
      excludeCredentials: this.rows()
        .filter((r) => r.rp_id === rp.rpId)
        .map((r) => ({ id: r.id, transports: transportsOf(r) })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    });
    this.settings.setJson(PENDING_KEY, {
      challenge: options.challenge,
      rp_id: rp.rpId,
      origin: rp.origin,
      expires_at: this.clock() + PASSKEY_TIMEOUT_MS,
    } satisfies PendingRegistration);
    return options;
  }

  /**
   * Checks the browser's answer against the pending challenge (used up either way) and stores
   * the new passkey. Null when it doesn't check out.
   */
  async register(name: string, response: Registration, rp: RelyingParty): Promise<PasskeyInfo | null> {
    const pending = this.settings.getJson<PendingRegistration>(PENDING_KEY);
    this.settings.delete(PENDING_KEY);
    if (!pending || pending.expires_at < this.clock() || pending.rp_id !== rp.rpId || pending.origin !== rp.origin) return null;
    if (this.count() >= MAX_PASSKEYS) return null;
    let verified: VerifiedRegistrationResponse;
    try {
      verified = await verifyRegistrationResponse({
        response,
        expectedChallenge: pending.challenge,
        expectedOrigin: pending.origin,
        expectedRPID: pending.rp_id,
        requireUserVerification: false,
      });
    } catch {
      return null;
    }
    // Checked again after the await: two-step sign-in may have been turned off meanwhile.
    if (!verified.verified || !this.mfaEnabled()) return null;
    const { credential, credentialBackedUp } = verified.registrationInfo;
    if (this.db.one(`SELECT 1 AS x FROM tal_passkeys WHERE id = ?`, credential.id)) return null;
    const now = new Date(this.clock()).toISOString();
    this.db.run(
      `INSERT INTO tal_passkeys (id, name, public_key, counter, transports, rp_id, synced, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      credential.id,
      name,
      isoBase64URL.fromBuffer(credential.publicKey),
      credential.counter,
      JSON.stringify(credential.transports ?? response.response.transports ?? []),
      pending.rp_id,
      credentialBackedUp ? 1 : 0,
      now,
    );
    return this.list(rp.rpId).find((p) => p.id === credential.id) ?? null;
  }

  rename(id: string, name: string): boolean {
    return this.db.run(`UPDATE tal_passkeys SET name = ? WHERE id = ?`, name, id).changes > 0;
  }

  remove(id: string): boolean {
    return this.db.run(`DELETE FROM tal_passkeys WHERE id = ?`, id).changes > 0;
  }

  /** Every passkey and any ceremony half-way: two-step sign-in was turned off or reset. */
  removeAll(): void {
    this.db.run(`DELETE FROM tal_passkeys`);
    this.settings.delete(PENDING_KEY);
  }

  // ---------- Signing in ----------

  /** What the browser needs to use a passkey for the sign-in challenge `challengeId`; null when none fits this domain. */
  async authenticationOptions(challengeId: string, rp: RelyingParty) {
    const rows = this.rows().filter((r) => r.rp_id === rp.rpId);
    if (rows.length === 0) return null;
    const options = await generateAuthenticationOptions({
      rpID: rp.rpId,
      allowCredentials: rows.map((r) => ({ id: r.id, transports: transportsOf(r) })),
      timeout: PASSKEY_TIMEOUT_MS,
      userVerification: "preferred",
    });
    this.db.run(`UPDATE tal_mfa_challenges SET passkey_challenge = ? WHERE id = ?`, `${rp.origin} ${options.challenge}`, challengeId);
    return options;
  }

  /**
   * Checks a passkey's answer for the sign-in challenge `challengeId`. The WebAuthn challenge is
   * used up first, so an answer can't be replayed, right or wrong.
   */
  async verify(challengeId: string, response: Assertion, rp: RelyingParty): Promise<boolean> {
    // Read and cleared with no await in between: nothing else runs in the Durable Object meanwhile.
    const row = this.db.one<{ passkey_challenge: string | null }>(`SELECT passkey_challenge FROM tal_mfa_challenges WHERE id = ?`, challengeId);
    this.db.run(`UPDATE tal_mfa_challenges SET passkey_challenge = NULL WHERE id = ?`, challengeId);
    const [origin, challenge] = (row?.passkey_challenge ?? "").split(" ");
    if (!origin || !challenge || origin !== rp.origin) return false;
    const stored = this.db.one<PasskeyRow>(`SELECT * FROM tal_passkeys WHERE id = ? AND rp_id = ?`, response.id, rp.rpId);
    if (!stored) return false;
    let result: VerifiedAuthenticationResponse;
    try {
      result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rp.rpId,
        credential: {
          id: stored.id,
          publicKey: isoBase64URL.toBuffer(stored.public_key) as Uint8Array<ArrayBuffer>,
          counter: stored.counter,
          transports: transportsOf(stored) as never,
        },
        requireUserVerification: false,
      });
    } catch {
      return false;
    }
    if (!result.verified) return false;
    this.db.run(
      `UPDATE tal_passkeys SET counter = ?, synced = ?, last_used_at = ? WHERE id = ?`,
      result.authenticationInfo.newCounter,
      result.authenticationInfo.credentialBackedUp ? 1 : 0,
      new Date(this.clock()).toISOString(),
      stored.id,
    );
    return true;
  }
}
