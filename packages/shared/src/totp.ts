import { z } from "zod";
import { sha256Hex } from "./crypto";

/**
 * Two-step sign-in with an authenticator app (TOTP, RFC 6238): HMAC-SHA1, 6 digits, 30-second
 * steps, as every authenticator app expects. A code from the step before or after also counts,
 * for clocks a little off; a step already used never counts again.
 */
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_S = 30;
/** Steps accepted on each side of the current one. */
export const TOTP_DRIFT_STEPS = 1;
const SECRET_BYTES = 20;

/** Single-use codes for when the authenticator is lost; shown once, stored only as hashes. */
export const RECOVERY_CODE_COUNT = 10;
/** Below this many unused codes, the owner is asked to make new ones. */
export const RECOVERY_CODES_LOW = 2;
/** A started two-step sign-in lasts this long, and allows this many wrong codes. */
export const MFA_CHALLENGE_TTL_MS = 5 * 60_000;
export const MFA_MAX_ATTEMPTS = 5;
/**
 * Wrong sign-in codes allowed across all challenges and networks in the window. Past it, only the
 * owner's recent networks may try codes until the window clears: someone who has the password
 * can't buy more guesses by opening challenges from many addresses.
 */
export const MFA_WRONG_CODES_GLOBAL = 10;
export const MFA_WRONG_CODES_WINDOW_MS = 15 * 60_000;
/** A secret shown for setup must be confirmed with a code within this time. */
export const MFA_SETUP_TTL_MS = 10 * 60_000;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** Null for anything that isn't base32 (spaces, dashes and lowercase are fine). */
export function base32Decode(text: string): Uint8Array | null {
  const clean = text.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (!/^[A-Z2-7]*$/.test(clean)) return null;
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    value = (value << 5) | BASE32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** A new random secret, base32 as authenticator apps take it. */
export function newTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(SECRET_BYTES)));
}

export function totpStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_S);
}

/** The code for one time step (RFC 4226 dynamic truncation). */
export async function totpCode(secret: string, step: number): Promise<string> {
  const key = base32Decode(secret);
  if (!key || key.length === 0) throw new Error("invalid TOTP secret");
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(step));
  const hmacKey = await crypto.subtle.importKey("raw", key as Uint8Array<ArrayBuffer>, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, counter));
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/**
 * The step a code matches, within the drift window and after `lastStep`, or null. Every
 * candidate is computed and compared in full, so the time taken doesn't depend on which matched.
 */
export async function matchTotp(secret: string, code: string, lastStep: number | null, nowMs = Date.now()): Promise<number | null> {
  const given = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(given)) return null;
  const now = totpStep(nowMs);
  let found: number | null = null;
  for (let step = now - TOTP_DRIFT_STEPS; step <= now + TOTP_DRIFT_STEPS; step++) {
    const expected = await totpCode(secret, step);
    let diff = 0;
    for (let i = 0; i < TOTP_DIGITS; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
    if (diff === 0 && (lastStep === null || step > lastStep) && found === null) found = step;
  }
  return found;
}

/** The link an authenticator app reads from the QR code. */
export function otpauthUri(secret: string, account: string, issuer = "Talorys"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(TOTP_DIGITS), period: String(TOTP_PERIOD_S) });
  return `otpauth://totp/${label}?${params}`;
}

/** Recovery codes: 16 base32 characters (80 bits) in groups of four, like ABCD-EFGH-JKLM-NPQR. */
export function newRecoveryCode(): string {
  const raw = base32Encode(crypto.getRandomValues(new Uint8Array(10)));
  return raw.match(/.{4}/g)!.join("-");
}

/** The same code however it was typed: case, spaces and dashes don't matter. */
export function normalizeRecoveryCode(code: string): string | null {
  const clean = code.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z2-7]{16}$/.test(clean) ? clean : null;
}

/** Stored form of a recovery code. The codes carry 80 random bits, so a plain hash is enough. */
export async function hashRecoveryCode(code: string): Promise<string | null> {
  const clean = normalizeRecoveryCode(code);
  return clean ? sha256Hex(`talorys-recovery:${clean}`) : null;
}

/** An authenticator code (6 digits) or a recovery code. */
export const mfaCodeSchema = z.object({ code: z.string().min(1).max(40) });

export interface MfaStatus {
  enabled: boolean;
  enabled_at: string | null;
  recovery_codes_left: number;
}

export interface MfaSetup {
  /** base32, for typing into the app by hand. */
  secret: string;
  otpauth_uri: string;
  expires_at: string;
}
