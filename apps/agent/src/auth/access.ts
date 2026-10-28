/**
 * Cloudflare Access in front of Talorys (AUTH-03).
 *
 * Access signs every request it lets through with a JWT in the `Cf-Access-Jwt-Assertion`
 * header. Checking it here, inside the Worker, means a host Access does not cover (a forgotten
 * *.workers.dev or *.pages.dev alias) cannot be used to skip it. Without both settings the
 * check is off and nothing changes.
 */

export interface AccessConfig {
  /** The Zero Trust team domain, for example `myteam.cloudflareaccess.com`. */
  teamDomain: string;
  /** The Access application's Audience (AUD) tag. */
  aud: string;
}

const TEAM_DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/;
const AUD = /^[0-9a-f]{64}$/;
/** Clock difference tolerated between Cloudflare's edge and this Worker. */
const LEEWAY_S = 60;
const KEYS_TTL_MS = 10 * 60_000;
/** A token signed with an unknown key refetches the keys at most this often (key rotation). */
const REFETCH_MIN_MS = 60_000;

export class AccessMisconfigured extends Error {}

/** The Access settings, null when Access is not used. Half a configuration is an error, never "off". */
export function accessConfig(env: { TALORYS_ACCESS_TEAM_DOMAIN?: string; TALORYS_ACCESS_AUD?: string }): AccessConfig | null {
  const teamDomain = (env.TALORYS_ACCESS_TEAM_DOMAIN ?? "").trim().toLowerCase().replace(/^https:\/\//, "").replace(/\/$/, "");
  const aud = (env.TALORYS_ACCESS_AUD ?? "").trim().toLowerCase();
  if (!teamDomain && !aud) return null;
  if (!TEAM_DOMAIN.test(teamDomain) || !AUD.test(aud)) {
    throw new AccessMisconfigured("TALORYS_ACCESS_TEAM_DOMAIN and TALORYS_ACCESS_AUD must both be set and valid.");
  }
  return { teamDomain, aud };
}

interface Jwk extends JsonWebKey {
  kid?: string;
}

interface KeyCache {
  keys: Map<string, CryptoKey>;
  fetchedAt: number;
}

const caches = new Map<string, KeyCache>();

/** Test hook: forgets the cached signing keys. */
export function clearAccessKeys(): void {
  caches.clear();
}

async function loadKeys(teamDomain: string, fetcher: typeof fetch): Promise<KeyCache> {
  const res = await fetcher(`https://${teamDomain}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`Access keys answered ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys ?? []) {
    if (!jwk.kid || jwk.kty !== "RSA") continue;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    keys.set(jwk.kid, key);
  }
  const cache = { keys, fetchedAt: Date.now() };
  caches.set(teamDomain, cache);
  return cache;
}

async function signingKey(teamDomain: string, kid: string, fetcher: typeof fetch): Promise<CryptoKey | null> {
  let cache = caches.get(teamDomain);
  if (!cache || Date.now() - cache.fetchedAt > KEYS_TTL_MS) cache = await loadKeys(teamDomain, fetcher);
  const key = cache.keys.get(kid);
  if (key || Date.now() - cache.fetchedAt < REFETCH_MIN_MS) return key ?? null;
  return (await loadKeys(teamDomain, fetcher)).keys.get(kid) ?? null;
}

function decodePart<T>(part: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(base64urlBytes(part))) as T;
  } catch {
    return null;
  }
}

function base64urlBytes(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("not base64url");
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
}

/**
 * True only for a token Access signed for this application that is valid right now.
 * Any error (a malformed token, the key endpoint unreachable) is a refusal.
 */
export async function verifyAccessToken(token: string | null | undefined, config: AccessConfig, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!token || token.length > 8192) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string];
  const header = decodePart<{ alg?: string; kid?: string }>(rawHeader);
  const payload = decodePart<{ aud?: string | string[]; iss?: string; exp?: number; nbf?: number }>(rawPayload);
  if (!header || !payload || header.alg !== "RS256" || typeof header.kid !== "string") return false;

  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(config.aud)) return false;
  if (payload.iss !== `https://${config.teamDomain}`) return false;
  if (typeof payload.exp !== "number" || payload.exp + LEEWAY_S <= now) return false;
  if (typeof payload.nbf === "number" && payload.nbf - LEEWAY_S > now) return false;

  try {
    const key = await signingKey(config.teamDomain, header.kid, fetcher);
    if (!key) return false;
    const data = new TextEncoder().encode(`${rawHeader}.${rawPayload}`);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64urlBytes(rawSignature), data);
  } catch {
    return false;
  }
}
