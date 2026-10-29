import { MAX_REMOTE_TOKENS, remoteStatusSchema, remoteTokenCreateSchema } from "@talorys/shared";
import { Hono } from "hono";
import type { AppEnv } from "../api/app";
import { NotFoundError } from "../api/errors";
import { body, requireRecentAuth } from "../api/middleware";
import { raiseSecurityAlert } from "../alerts/security";

/**
 * Owner-only token admin. Session and CSRF checks apply as for every other API route; a
 * Bearer token can never reach these. Activity events name tokens but never carry secrets.
 */
export const remoteRoutes = new Hono<AppEnv>();

remoteRoutes.get("/remote/status", (c) => c.json({ enabled: c.env.agent.services.remote.isEnabled(), max_tokens: MAX_REMOTE_TOKENS }));

remoteRoutes.patch("/remote/status", async (c) => {
  const s = c.env.agent.services;
  const { enabled } = await body(c, remoteStatusSchema, 1024);
  // Turning it off is always allowed: it only closes the door.
  if (enabled) requireRecentAuth(c);
  const was = s.remote.isEnabled();
  s.remote.setEnabled(enabled);
  if (enabled && !was) raiseSecurityAlert(s.alerts, "remote_enabled");
  s.activity.record(enabled ? "remote.enabled" : "remote.disabled", enabled ? "Remote access turned on" : "Remote access turned off");
  return c.json({ enabled });
});

remoteRoutes.get("/remote/tokens", (c) => c.json({ tokens: c.env.agent.services.remote.list() }));

remoteRoutes.post("/remote/tokens", async (c) => {
  const s = c.env.agent.services;
  requireRecentAuth(c);
  const input = await body(c, remoteTokenCreateSchema, 4 * 1024);
  const token = await s.remote.create(input, c.get("sessionId"));
  s.activity.record("remote.token_created", `Created access token "${token.name}" (${token.scope})`);
  raiseSecurityAlert(s.alerts, "token_created");
  return c.json({ token }, 201);
});

remoteRoutes.delete("/remote/tokens/:id", (c) => {
  const s = c.env.agent.services;
  const id = c.req.param("id");
  const token = s.remote.list().find((t) => t.id === id);
  if (!token || !s.remote.revoke(id)) throw new NotFoundError("Access token not found.");
  s.activity.record("remote.token_revoked", `Revoked access token "${token.name}"`);
  return c.json({ revoked: true });
});

remoteRoutes.delete("/remote/tokens", (c) => {
  const s = c.env.agent.services;
  const revoked = s.remote.revokeAll();
  s.activity.record("remote.token_revoked_all", `Revoked all ${revoked} access tokens`);
  return c.json({ revoked });
});
