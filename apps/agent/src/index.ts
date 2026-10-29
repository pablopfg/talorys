import { getAgentByName } from "agents";
import { AGENT_INSTANCE_NAME, CLIENT_GEO_HEADER } from "@talorys/shared";
import type { Env } from "./env";
import { AppError, errorResponse } from "./api/errors";
import { AccessMisconfigured, accessConfig, verifyAccessToken } from "./auth/access";
import { allowedHosts } from "./hosts";
import { WEB_HEADERS, withWebHeaders } from "./web-headers";
import { isTelegramWebhook, TELEGRAM_WEBHOOK_PATH } from "./telegram/client";

/** API responses are data, never pages: nothing in them may load, run or be framed. */
const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export { allowedHosts };

export { TalorysAgent } from "./agent/talorys-agent";
export { TalorysWorkflow } from "./workflows/workflow";

/**
 * Backend entry point. The installer deploys it with workers_dev and preview
 * URLs disabled, so it is reachable only through the Pages Function service
 * binding. A one-Worker deploy (wrangler.standalone.jsonc) also serves the UI from its
 * ASSETS binding and runs first on every request; it is then public, behind the same auth.
 *
 * Every /api request is forwarded to the single owner agent ("personal-agent").
 * The instance name is fixed server-side; clients cannot choose agent identities.
 *
 * Gates, in order, for the UI and the API alike: TALORYS_ALLOWED_HOSTS answers 404 on any other
 * host (AUTH-03); plain HTTP is sent to HTTPS, or refused when it carries a body or a
 * credential; with
 * Cloudflare Access configured every request must carry a valid Access token.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const hosts = allowedHosts(env);
    if (hosts && !hosts.has(url.hostname.toLowerCase())) return notFound();
    if (url.protocol !== "https:" && env.TALORYS_ENV !== "development") return toHttps(request, url);
    // A "sub" path segment is the Agents SDK's sub-agent routing marker; Talorys has no sub-agents.
    const isSubAgentPath = url.pathname.split("/").includes("sub");
    const isApi = url.pathname.startsWith("/api/") || url.pathname === "/api";
    if (!isApi && !env.ASSETS) return notFound();
    if (isSubAgentPath && isApi) return notFound();
    const denied = await accessDenied(request, url, env);
    if (denied) return gate(denied);
    if (!isApi) return withWebHeaders(await env.ASSETS!.fetch(request), url.pathname);
    // WebSocket upgrades are not part of the API surface.
    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      return gate(Response.json({ error: { code: "FORBIDDEN", message: "WebSockets are not supported" } }, { status: 400 }));
    }
    const agent = await getAgentByName(env.TalorysAgent, AGENT_INSTANCE_NAME);
    return withoutRawErrors(await agent.fetch(withoutInternalHeaders(request)));
  },
} satisfies ExportedHandler<Env>;

/**
 * The API's header set on the entry point's own answers (404, refusals, redirects). Browsers
 * ignore HSTS received over plain HTTP, so sending it on every answer is safe.
 */
function gate(response: Response): Response {
  const res = new Response(response.body, response);
  res.headers.set("cache-control", "no-store");
  res.headers.set("x-content-type-options", "nosniff");
  res.headers.set("referrer-policy", "same-origin");
  res.headers.set("content-security-policy", API_CSP);
  res.headers.set("x-frame-options", "DENY");
  res.headers.set("strict-transport-security", WEB_HEADERS["strict-transport-security"]);
  return res;
}

function notFound(): Response {
  return gate(Response.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 }));
}

/**
 * "Always Use HTTPS" inside the app, whatever the zone settings say: an anonymous page or read
 * is moved to the same address over HTTPS for good (301), and HSTS keeps the browser there.
 * Anything else is refused instead of redirected. A body (a password, a message) or a credential
 * (a session cookie, a bearer token from n8n or another client) already crossed the network in
 * clear text; a redirect would make the client send it again and hide the leak for good.
 */
function toHttps(request: Request, url: URL): Response {
  // Only the API reads cookies; a page visit may carry unrelated cookies of the parent domain.
  const isApi = url.pathname.startsWith("/api/") || url.pathname === "/api";
  const anonymous = !request.headers.has("authorization") && !(isApi && request.headers.has("cookie"));
  if ((request.method === "GET" || request.method === "HEAD") && anonymous) {
    const target = new URL(url);
    target.protocol = "https:";
    target.port = "";
    target.hash = "";
    return gate(new Response(null, { status: 301, headers: { location: target.href } }));
  }
  return gate(errorResponse(new AppError("FORBIDDEN", "HTTPS is required.")));
}

/**
 * With Cloudflare Access configured, a request without a valid Access token is refused here,
 * whatever host it came through. Only the anonymous health check is exempt, so a deploy can
 * check itself through an Access bypass rule; it answers no more than "ok" or "not ok". The
 * Telegram webhook is exempt too, but only with the right secret header (see docs/alerts.md).
 */
async function accessDenied(request: Request, url: URL, env: Env): Promise<Response | null> {
  let config: ReturnType<typeof accessConfig>;
  try {
    config = accessConfig(env);
  } catch (error) {
    if (!(error instanceof AccessMisconfigured)) throw error;
    return errorResponse(new AppError("NOT_CONFIGURED", "Cloudflare Access is not configured correctly."));
  }
  if (!config) return null;
  const isHealth = request.method === "GET" && url.pathname.replace(/\/$/, "") === "/api/health";
  if (isHealth && !request.headers.has("cookie") && !request.headers.has("authorization")) return null;
  // Telegram can't pass Access; its webhook proves itself with the secret header instead.
  const isTelegram = request.method === "POST" && url.pathname === TELEGRAM_WEBHOOK_PATH;
  if (isTelegram && !request.headers.has("cookie") && !request.headers.has("authorization")
    && (await isTelegramWebhook(request.headers.get("x-telegram-bot-api-secret-token"), env.SESSION_SECRET))) return null;
  if (await verifyAccessToken(request.headers.get("cf-access-jwt-assertion"), config)) return null;
  return errorResponse(new AppError("FORBIDDEN", "Sign in through Cloudflare Access to continue."));
}

/**
 * The Agents SDK reads its own `x-agents-*` headers before the API router runs (a malformed one
 * answers with a raw stack trace), so a client must never be able to set them. The same goes for
 * the client-location header: only this entry point writes it, from Cloudflare's `request.cf`.
 */
export function withoutInternalHeaders(request: Request): Request {
  const internal = [...request.headers.keys()].filter((name) => name.startsWith("x-agents-") || name === CLIENT_GEO_HEADER);
  const geo = edgeGeo(request);
  if (internal.length === 0 && !geo) return request;
  const headers = new Headers(request.headers);
  for (const name of internal) headers.delete(name);
  if (geo) headers.set(CLIENT_GEO_HEADER, geo);
  return new Request(request, { headers });
}

/** Where the edge says the request came from, as JSON; null when there is no `request.cf` (local development). */
function edgeGeo(request: Request): string | null {
  const cf = (request as Request & { cf?: Record<string, unknown> }).cf;
  const text = (value: unknown, max: number) => (typeof value === "string" && value ? value.slice(0, max) : undefined);
  const country = text(cf?.country, 2) ?? text(request.headers.get("cf-ipcountry"), 2);
  if (!cf && !country) return null;
  // Header values must be ASCII; city names often are not ("São Paulo").
  return encodeURIComponent(JSON.stringify({
    country,
    region: text(cf?.region, 100),
    city: text(cf?.city, 100),
    asn: typeof cf?.asn === "number" ? cf.asn : undefined,
    asOrg: text(cf?.asOrganization, 120),
    colo: text(cf?.colo, 8),
  }));
}

/**
 * When the Durable Object fails before the API router runs (a failed migration on startup, a
 * storage error), the Agents SDK answers with the raw stack trace as plain text. The API's own
 * errors are always JSON, so any other 5xx body is replaced with the generic error.
 */
export function withoutRawErrors(response: Response): Response {
  if (response.status < 500 || response.headers.get("content-type")?.startsWith("application/json")) return response;
  void response.body?.cancel();
  const safe = errorResponse(new AppError("INTERNAL_ERROR", "Something went wrong. Your data is safe; please try again."));
  safe.headers.set("x-content-type-options", "nosniff");
  safe.headers.set("content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  return safe;
}
