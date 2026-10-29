/**
 * Headers for the web UI when this Worker serves it (one-Worker deploy, run_worker_first).
 * Cloudflare applies apps/web/public/_headers only to assets it serves on its own, not to
 * responses that pass through Worker code, so the same rules live here. A test keeps the two
 * in step: change both together.
 */
export const WEB_HEADERS = {
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "cross-origin-opener-policy": "same-origin",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
} as const satisfies Record<string, string>;

/**
 * Cache rules as in _headers: hashed bundles forever, the app shell and service worker never
 * stale. The shell also answers every client-side route ("/", "/chat", ...), hence the type check.
 */
export function webCacheControl(pathname: string, contentType: string | null, ok = true): string | null {
  const html = contentType?.startsWith("text/html") ?? false;
  // A missing bundle falls back to the HTML shell; that must never be cached for a year.
  if (pathname.startsWith("/assets/") && ok && !html) return "public, max-age=31536000, immutable";
  if (pathname === "/index.html" || pathname === "/sw.js" || html) return "no-cache";
  return null;
}

/** The asset response with the UI's security headers on it. */
export function withWebHeaders(response: Response, pathname: string): Response {
  const res = new Response(response.body, response);
  for (const [name, value] of Object.entries(WEB_HEADERS)) res.headers.set(name, value);
  const cache = webCacheControl(pathname, res.headers.get("content-type"), res.ok);
  if (cache) res.headers.set("cache-control", cache);
  return res;
}
