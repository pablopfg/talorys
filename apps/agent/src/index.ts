import { getAgentByName } from "agents";
import { AGENT_INSTANCE_NAME } from "@talorys/shared";
import type { Env } from "./env";
import { AppError, errorResponse } from "./api/errors";

export { TalorysAgent } from "./agent/talorys-agent";

/**
 * Backend entry point. The installer deploys it with workers_dev and preview
 * URLs disabled, so it is reachable only through the Pages Function service
 * binding. A one-Worker deploy (wrangler.standalone.jsonc) serves the UI as
 * static assets and routes /api here; it is then public, behind the same auth.
 *
 * Every /api request is forwarded to the single owner agent ("personal-agent").
 * The instance name is fixed server-side; clients cannot choose agent identities.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // A "sub" path segment is the Agents SDK's sub-agent routing marker; Talorys has no sub-agents.
    const isSubAgentPath = url.pathname.split("/").includes("sub");
    if ((!url.pathname.startsWith("/api/") && url.pathname !== "/api") || isSubAgentPath) {
      return Response.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
    }
    // WebSocket upgrades are not part of the API surface.
    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      return Response.json({ error: { code: "FORBIDDEN", message: "WebSockets are not supported" } }, { status: 400 });
    }
    const agent = await getAgentByName(env.TalorysAgent, AGENT_INSTANCE_NAME);
    return withoutRawErrors(await agent.fetch(withoutInternalHeaders(request)));
  },
} satisfies ExportedHandler<Env>;

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
