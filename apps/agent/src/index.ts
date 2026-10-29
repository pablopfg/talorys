import { getAgentByName } from "agents";
import { AGENT_INSTANCE_NAME } from "@talorys/shared";
import type { Env } from "./env";
import { AppError, errorResponse } from "./api/errors";
import { AccessMisconfigured, accessConfig, verifyAccessToken } from "./auth/access";
import { allowedHosts } from "./hosts";

export { allowedHosts };

export { TalorysAgent } from "./agent/talorys-agent";

/**
 * Backend entry point. The installer deploys it with workers_dev and preview
 * URLs disabled, so it is reachable only through the Pages Function service
 * binding. A one-Worker deploy (wrangler.standalone.jsonc) serves the UI as
 * static assets and routes /api here; it is then public, behind the same auth.
 *
 * Every /api request is forwarded to the single owner agent ("personal-agent").
 * The instance name is fixed server-side; clients cannot choose agent identities.
 *
 * Before that, two optional gates (AUTH-03): TALORYS_ALLOWED_HOSTS answers 404 on any other
 * host, and with Cloudflare Access configured every request must carry a valid Access token.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // A "sub" path segment is the Agents SDK's sub-agent routing marker; Talorys has no sub-agents.
    const isSubAgentPath = url.pathname.split("/").includes("sub");
    if ((!url.pathname.startsWith("/api/") && url.pathname !== "/api") || isSubAgentPath) {
      return Response.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
    }
    const hosts = allowedHosts(env);
    if (hosts && !hosts.has(url.hostname.toLowerCase())) {
      return Response.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
    }
    const denied = await accessDenied(request, url, env);
    if (denied) return denied;
    // WebSocket upgrades are not part of the API surface.
    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      return Response.json({ error: { code: "FORBIDDEN", message: "WebSockets are not supported" } }, { status: 400 });
    }
    const agent = await getAgentByName(env.TalorysAgent, AGENT_INSTANCE_NAME);
    return withoutRawErrors(await agent.fetch(withoutInternalHeaders(request)));
  },
} satisfies ExportedHandler<Env>;

/**
 * With Cloudflare Access configured, a request without a valid Access token is refused here,
 * whatever host it came through. Only the anonymous health check is exempt, so a deploy can
 * check itself through an Access bypass rule; it answers no more than "ok" or "not ok".
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
  if (await verifyAccessToken(request.headers.get("cf-access-jwt-assertion"), config)) return null;
  return errorResponse(new AppError("FORBIDDEN", "Sign in through Cloudflare Access to continue."));
}

/**
 * The Agents SDK reads its own `x-agents-*` headers before the API router runs (a malformed one
 * answers with a raw stack trace), so a client must never be able to set them.
 */
function withoutInternalHeaders(request: Request): Request {
  const internal = [...request.headers.keys()].filter((name) => name.startsWith("x-agents-"));
  if (internal.length === 0) return request;
  const headers = new Headers(request.headers);
  for (const name of internal) headers.delete(name);
  return new Request(request, { headers });
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
