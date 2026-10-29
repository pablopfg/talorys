import { ACTIVITY_HEADER, CLIENT_GEO_HEADER, CSRF_HEADER, DEV_DEVICE_COOKIE, DEV_MFA_COOKIE, DEV_SESSION_COOKIE, DEVICE_COOKIE, MFA_CHALLENGE_TTL_MS, MFA_COOKIE, SESSION_COOKIE } from "@talorys/shared";
import type { Context, MiddlewareHandler } from "hono";
import type { z } from "zod";
import type { AppEnv } from "./app";
import { AppError, ValidationError } from "./errors";
import { type ClientGeo, type ClientInfo, DEVICE_COOKIE_MAX_AGE_S, NO_GEO } from "../auth/auth-log";

/** Routes reachable without a session. Nothing here can claim ownership or read owner data. */
const PUBLIC_ROUTES = new Set([
  "GET /api/health",
  "POST /api/auth/login",
  "POST /api/auth/mfa",
  "POST /api/auth/mfa/passkey/options",
  "POST /api/auth/mfa/passkey",
  "GET /api/auth/session",
  "POST /api/auth/recovery",
  "POST /api/auth/recovery/complete",
]);

/** All a session can do while its password fails the current rules: change it, or leave. */
const WEAK_PASSWORD_ROUTES = new Set([...PUBLIC_ROUTES, "POST /api/auth/password", "POST /api/auth/logout", "POST /api/auth/heartbeat"]);

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** API responses are data, never pages: nothing in them may load, run or be framed. */
const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  c.res.headers.set("cache-control", "no-store");
  c.res.headers.set("x-content-type-options", "nosniff");
  c.res.headers.set("referrer-policy", "same-origin");
  c.res.headers.set("content-security-policy", API_CSP);
  c.res.headers.set("x-frame-options", "DENY");
  if (isHttps(c)) c.res.headers.set("strict-transport-security", "max-age=63072000; includeSubDomains");
};

function isDevelopment(c: Context<AppEnv>): boolean {
  return c.env.env.TALORYS_ENV === "development";
}

function isHttps(c: Context<AppEnv>): boolean {
  return new URL(c.req.url).protocol === "https:";
}

/** Outside development, plain HTTP is refused before anything reads a cookie or a password. */
export const requireHttps: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isDevelopment(c) && !isHttps(c)) throw new AppError("FORBIDDEN", "HTTPS is required.");
  return next();
};

export function allowedOrigins(c: Context<AppEnv>): Set<string> {
  const origins = new Set([new URL(c.req.url).origin]);
  if (isDevelopment(c)) {
    for (const o of (c.env.env.TALORYS_DEV_ORIGINS ?? "").split(",")) if (o.trim()) origins.add(o.trim());
  }
  return origins;
}

/**
 * CSRF defence in depth for state-changing requests:
 *  1. SameSite=Strict session cookie (set at login),
 *  2. a custom request header that cross-site forms cannot send without a CORS preflight (never granted),
 *  3. Origin / Sec-Fetch-Site verification.
 */
export const csrfProtection: MiddlewareHandler<AppEnv> = async (c, next) => {
  // Set only after `remoteAuth` validated a token; a header alone never skips this check.
  if (c.get("remote")) return next();
  if (SAFE_METHODS.has(c.req.method)) return next();
  if (c.req.header(CSRF_HEADER) !== "1") {
    throw new AppError("FORBIDDEN", "Missing CSRF header.");
  }
  const origin = c.req.header("origin");
  if (origin) {
    if (!allowedOrigins(c).has(origin)) throw new AppError("FORBIDDEN", "Cross-origin request rejected.");
  } else {
    const site = c.req.header("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") throw new AppError("FORBIDDEN", "Cross-site request rejected.");
  }
  return next();
};

/** The __Host- cookie, always Secure; the plain name only for local development over HTTP. */
export function sessionCookieName(c: Context<AppEnv>): string {
  return isHttps(c) || !isDevelopment(c) ? SESSION_COOKIE : DEV_SESSION_COOKIE;
}

export function readSessionToken(c: Context<AppEnv>): string | null {
  return readCookie(c, sessionCookieName(c));
}

function readCookie(c: Context<AppEnv>, name: string): string | null {
  const header = c.req.header("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        // Not something this app ever issued (it encodes the token), so treat it as no session.
        return null;
      }
    }
  }
  return null;
}

function deviceCookieName(c: Context<AppEnv>): string {
  return sessionCookieName(c) === SESSION_COOKIE ? DEVICE_COOKIE : DEV_DEVICE_COOKIE;
}

export function readDeviceCookie(c: Context<AppEnv>): string | null {
  return readCookie(c, deviceCookieName(c));
}

/** The device cookie: random, HttpOnly, for 180 days. It only tells "seen before" from "new"; it never authenticates. */
export function deviceCookie(c: Context<AppEnv>, value: string): string {
  const attrs = [`${deviceCookieName(c)}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${DEVICE_COOKIE_MAX_AGE_S}`];
  if (deviceCookieName(c) === DEVICE_COOKIE) attrs.push("Secure");
  return attrs.join("; ");
}

function mfaCookieName(c: Context<AppEnv>): string {
  return sessionCookieName(c) === SESSION_COOKIE ? MFA_COOKIE : DEV_MFA_COOKIE;
}

export function readMfaCookie(c: Context<AppEnv>): string | null {
  return readCookie(c, mfaCookieName(c));
}

/** The two-step challenge cookie: random, HttpOnly, 5 minutes; with null, the one that clears it. */
export function mfaCookie(c: Context<AppEnv>, value: string | null): string {
  const attrs = [`${mfaCookieName(c)}=${value ? encodeURIComponent(value) : ""}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${value ? MFA_CHALLENGE_TTL_MS / 1000 : 0}`];
  if (mfaCookieName(c) === MFA_COOKIE) attrs.push("Secure");
  return attrs.join("; ");
}

const geoText = (value: unknown, max: number) => (typeof value === "string" && value ? value.slice(0, max) : null);

/** The edge's view of the request, from the header the Worker's entry point set (absent in local development). */
export function clientGeo(c: Context<AppEnv>): ClientGeo {
  const raw = c.req.header(CLIENT_GEO_HEADER);
  if (!raw || raw.length > 4096) return NO_GEO;
  try {
    const g = JSON.parse(decodeURIComponent(raw)) as Record<string, unknown>;
    if (!g || typeof g !== "object") return NO_GEO;
    const country = geoText(g.country, 2);
    return {
      country: country && /^[A-Z]{2}$/.test(country) ? country : null,
      region: geoText(g.region, 100),
      city: geoText(g.city, 100),
      asn: typeof g.asn === "number" && Number.isInteger(g.asn) && g.asn > 0 && g.asn < 2 ** 32 ? g.asn : null,
      asOrg: geoText(g.asOrg, 120),
      colo: geoText(g.colo, 8),
    };
  } catch {
    return NO_GEO;
  }
}

/** Who is behind this request, for the sign-in activity. */
export async function clientInfo(c: Context<AppEnv>): Promise<ClientInfo> {
  const ip = c.req.header("cf-connecting-ip") ?? null;
  return {
    ip,
    network: ip ? clientKey(ip) : isDevelopment(c) ? "local" : null,
    userAgent: c.req.header("user-agent") ?? "",
    host: new URL(c.req.url).hostname,
    geo: clientGeo(c),
    device: await c.env.agent.services.authLog.deviceId(readDeviceCookie(c)),
  };
}

/**
 * The session cookie, or with a null token the one that clears it. It has no Expires or Max-Age,
 * so the browser drops it when it closes; the server's deadlines are what actually end a session.
 */
export function sessionCookie(c: Context<AppEnv>, token: string | null): string {
  const secure = sessionCookieName(c) === SESSION_COOKIE;
  const attrs = [`${sessionCookieName(c)}=${token ? encodeURIComponent(token) : ""}`, "Path=/", "HttpOnly", "SameSite=Strict"];
  if (!token) attrs.push("Max-Age=0");
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("remote")) {
    c.set("sessionId", null);
    return next();
  }
  const route = `${c.req.method} ${new URL(c.req.url).pathname.replace(/\/$/, "")}`;
  const token = readSessionToken(c);
  const activity = c.req.header(ACTIVITY_HEADER) === "1";
  const sessionId = token ? await c.env.agent.services.auth.validate(token, { activity }) : null;
  c.set("sessionId", sessionId);
  if (!sessionId && !PUBLIC_ROUTES.has(route)) {
    throw new AppError("UNAUTHORIZED", "Please sign in.");
  }
  if (sessionId && !WEAK_PASSWORD_ROUTES.has(route) && c.env.agent.services.auth.passwordChangeRequired()) {
    throw new AppError("PASSWORD_CHANGE_REQUIRED", "Your password no longer meets the minimum requirements. Change it to continue.");
  }
  return next();
};

/**
 * Sensitive actions (turning on remote access, minting a token, export, import) need the password
 * typed recently, so a stolen session cookie alone can't take the data or open a back door.
 * Access tokens never reach these routes; if one did, it is refused too.
 */
export function requireRecentAuth(c: Context<AppEnv>): void {
  const sessionId = c.get("sessionId");
  if (!sessionId || !c.env.agent.services.auth.recentlyConfirmed(sessionId)) {
    throw new AppError("REAUTH_REQUIRED", "Confirm your password to continue.");
  }
}

/** Parses and validates a JSON body with a Zod schema, with a size limit. */
export async function body<S extends z.ZodType>(c: Context<AppEnv>, schema: S, maxBytes = 256 * 1024): Promise<z.infer<S>> {
  const length = Number(c.req.header("content-length") ?? "0");
  if (length > maxBytes) throw new ValidationError("Request body too large.");
  let raw: unknown;
  try {
    const text = await readLimited(c.req.raw, maxBytes);
    raw = text ? JSON.parse(text) : {};
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new ValidationError("Request body must be valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  return parsed.data;
}

/**
 * Reads a body as UTF-8, counting bytes as they arrive and cancelling once past the limit.
 * Content-Length alone is not enough: a streamed body has none and would be read in full.
 */
async function readLimited(request: Request, maxBytes: number): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ValidationError("Request body too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export function query<S extends z.ZodType>(c: Context<AppEnv>, schema: S): z.infer<S> {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  return parsed.data;
}

export function clientId(c: Context<AppEnv>): string {
  // Set by Cloudflare's edge and not spoofable by clients; absent only in local development.
  const ip = c.req.header("cf-connecting-ip");
  if (ip) return clientKey(ip);
  // Elsewhere every such request would share one rate-limit bucket, so refuse it instead.
  if (!isDevelopment(c)) throw new AppError("NOT_CONFIGURED", "The client address is missing. Reach Talorys through its Cloudflare URL.");
  return "local";
}

export function ipv4Octets(text: string): number[] | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

/** Eight hextets, or null when `addr` is not an IPv6 address. A trailing dotted quad is two hextets. */
export function expandIPv6(addr: string): number[] | null {
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const pieces = (half: string): number[] | null => {
    if (!half) return [];
    const out: number[] = [];
    for (const part of half.split(":")) {
      if (part.includes(".")) {
        const octets = ipv4Octets(part);
        if (!octets) return null;
        out.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
      } else if (/^[0-9a-f]{1,4}$/.test(part)) {
        out.push(Number.parseInt(part, 16));
      } else {
        return null;
      }
    }
    return out;
  };
  const left = pieces(halves[0] ?? "");
  const right = halves.length === 2 ? pieces(halves[1] ?? "") : [];
  if (!left || !right) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  return [...left, ...Array(missing).fill(0), ...right];
}

/**
 * Rate-limit key for a client IP. IPv6 is grouped by /64: one subscriber usually holds a
 * whole /64 and could otherwise rotate addresses for a fresh allowance on every guess.
 * IPv4-mapped addresses (::ffff:192.0.2.1, ::ffff:c000:201, and the expanded form) stay
 * per IPv4 address, or they all collapse into the same ::/64 bucket as ::1.
 */
export function clientKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  const addr = ip.toLowerCase().split("%")[0]!;
  const groups = expandIPv6(addr);
  if (groups) {
    const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
    if (mapped) {
      const hi = groups[6]!;
      const lo = groups[7]!;
      return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
    }
    return `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
  }
  const [head = "", tail = ""] = addr.split("::");
  const left = head ? head.split(":") : [];
  const right = addr.includes("::") && tail ? tail.split(":") : [];
  const zeros = addr.includes("::") ? Array(Math.max(0, 8 - left.length - right.length)).fill("0") : [];
  return `${[...left, ...zeros, ...right].slice(0, 4).map((g) => (Number.parseInt(g, 16) || 0).toString(16)).join(":")}::/64`;
}
