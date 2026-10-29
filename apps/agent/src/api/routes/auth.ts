import { changePasswordSchema, heartbeatSchema, loginSchema } from "@talorys/shared";
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { body, clientId, readSessionToken, sessionCookie } from "../middleware";
import { AppError } from "../errors";

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/login", async (c) => {
  const { password } = await body(c, loginSchema, 4096);
  const auth = c.env.agent.services.auth;
  const { token, expiresAt } = await auth.login(password, clientId(c), c.req.header("user-agent") ?? "");
  // A session cookie this browser already had ends here, so a planted one can't outlive the sign-in.
  const previous = c.get("sessionId");
  if (previous) auth.revoke(previous);
  c.env.agent.services.activity.record("auth.login", "Signed in");
  c.header("set-cookie", sessionCookie(c, token));
  return c.json({ authenticated: true, expires_at: expiresAt.toISOString() });
});

authRoutes.post("/logout", (c) => {
  const sessionId = c.get("sessionId");
  if (sessionId) c.env.agent.services.auth.revoke(sessionId);
  c.header("set-cookie", sessionCookie(c, null));
  // Drops what this browser cached of the app. Not "storage": that would remove the service
  // worker and with it push notifications; local storage holds only theme and language.
  c.header("clear-site-data", '"cache"');
  return c.json({ authenticated: false });
});

authRoutes.get("/session", (c) => {
  const s = c.env.agent.services;
  const authenticated = !!c.get("sessionId");
  if (!authenticated && readSessionToken(c)) c.header("set-cookie", sessionCookie(c, null));
  const settings = s.settings.get();
  return c.json({
    authenticated,
    configured: s.auth.isConfigured(),
    agent_name: authenticated ? settings.agentName : undefined,
    theme: authenticated ? settings.theme : undefined,
    language: authenticated ? settings.language : undefined,
    deadlines: authenticated ? (s.auth.sessionDeadlines(c.get("sessionId")!) ?? undefined) : undefined,
  });
});

/**
 * The open app's signal, once a minute from one tab: keeps presence, and use when `active`.
 * Answers with the deadlines so the browser can warn before the session ends.
 */
authRoutes.post("/heartbeat", async (c) => {
  const sessionId = c.get("sessionId");
  if (!sessionId) throw new AppError("UNAUTHORIZED", "Please sign in.");
  const { active } = await body(c, heartbeatSchema, 1024);
  return c.json({ deadlines: c.env.agent.services.auth.heartbeat(sessionId, active) });
});

/** Opens the step-up window for sensitive actions. Only for a signed-in browser session. */
authRoutes.post("/confirm", async (c) => {
  const sessionId = c.get("sessionId");
  if (!sessionId) throw new AppError("UNAUTHORIZED", "Please sign in.");
  const { password } = await body(c, loginSchema, 4096);
  const until = await c.env.agent.services.auth.confirm(sessionId, password, clientId(c));
  return c.json({ confirmed: true, until: until.toISOString() });
});

authRoutes.get("/sessions", (c) => c.json({ sessions: c.env.agent.services.auth.listSessions(c.get("sessionId")) }));

authRoutes.delete("/sessions/:id", (c) => {
  const ok = c.env.agent.services.auth.revokeByPublicId(c.req.param("id"));
  if (!ok) throw new AppError("NOT_FOUND", "Session not found");
  return c.json({ revoked: true });
});

authRoutes.post("/sessions/revoke-others", (c) => {
  const count = c.env.agent.services.auth.revokeAllExcept(c.get("sessionId"));
  return c.json({ revoked: count });
});

authRoutes.post("/password", async (c) => {
  const input = await body(c, changePasswordSchema, 4096);
  const s = c.env.agent.services;
  await s.auth.changePassword(input.current_password, input.new_password, clientId(c));
  s.activity.record("auth.password_changed", "Password changed; other sessions signed out and access tokens revoked");
  // This browser stays signed in, on a new session: the old token no longer works anywhere.
  const { token } = await s.auth.createSession(c.req.header("user-agent") ?? "");
  c.header("set-cookie", sessionCookie(c, token));
  return c.json({ changed: true });
});
