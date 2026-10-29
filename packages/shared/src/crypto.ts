/**
 * Password hashing shared by the Worker and the installer CLI.
 * Uses WebCrypto PBKDF2-HMAC-SHA256, available in both Workers and Node >= 20.
 * Cloudflare Workers cap PBKDF2 at 100,000 iterations, below current advice, so a hash can also
 * use a pepper: a secret kept only in the Worker (PASSWORD_PEPPER), never next to the hash.
 *
 * Formats:
 * - pbkdf2-sha256$<iterations>$<salt base64url>$<hash base64url>: PBKDF2(NFKC(password))
 * - pbkdf2-sha256-p1$<iterations>$<salt>$<hash>: PBKDF2(HMAC-SHA256(pepper, NFKC(password)))
 */
export const PBKDF2_ITERATIONS = 100_000;
const HASH_BYTES = 32;

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function derive(password: string, salt: Uint8Array, iterations: number, pepper?: string): Promise<Uint8Array> {
  const normalized = new TextEncoder().encode(password.normalize("NFKC"));
  const material = pepper ? await hmacSha256(pepper, normalized) : normalized;
  const key = await crypto.subtle.importKey("raw", material as Uint8Array<ArrayBuffer>, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as Uint8Array<ArrayBuffer>, iterations },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

async function hmacSha256(secret: string, value: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, value as Uint8Array<ArrayBuffer>));
}

/** A pepper must be long and random: 32+ characters, as the installer generates. */
export const PEPPER_MIN_LENGTH = 32;

export function usablePepper(pepper: string | undefined | null): string | undefined {
  return pepper && pepper.length >= PEPPER_MIN_LENGTH ? pepper : undefined;
}

export async function hashPassword(password: string, opts: { pepper?: string; iterations?: number } = {}): Promise<string> {
  const iterations = opts.iterations ?? PBKDF2_ITERATIONS;
  const pepper = usablePepper(opts.pepper);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, iterations, pepper);
  return `${pepper ? "pbkdf2-sha256-p1" : "pbkdf2-sha256"}$${iterations}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export function isPasswordHash(value: string | undefined | null): boolean {
  return !!value && /^pbkdf2-sha256(-p1)?\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.test(value);
}

/** True for a hash that needs the pepper to check. */
export function isPepperedHash(value: string | undefined | null): boolean {
  return isPasswordHash(value) && value!.startsWith("pbkdf2-sha256-p1$");
}

/** A peppered hash never matches without its pepper. */
export async function verifyPassword(password: string, stored: string, pepper?: string): Promise<boolean> {
  try {
    if (!isPasswordHash(stored)) return false;
    const [format, iterStr, saltStr, hashStr] = stored.split("$");
    const usable = usablePepper(pepper);
    if (format === "pbkdf2-sha256-p1" && !usable) return false;
    const iterations = Number(iterStr);
    if (!Number.isInteger(iterations) || iterations < 10_000 || iterations > PBKDF2_ITERATIONS) return false;
    const expected = fromBase64Url(hashStr!);
    const actual = await derive(password, fromBase64Url(saltStr!), iterations, format === "pbkdf2-sha256-p1" ? usable : undefined);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
