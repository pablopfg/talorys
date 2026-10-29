import { authEventsQuerySchema, authLogSettingsSchema, changePasswordSchema, confirmSchema, heartbeatSchema, mfaCodeSchema, randomToken, signInSchema } from "@talorys/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import type { AppEnv } from "../app";
import type { AuthEventKind } from "@talorys/shared";
import type { ClientInfo } from "../../auth/auth-log";
import type { SignedIn } from "../../auth/auth-service";
import type { MfaFactor } from "../../auth/mfa";
import { raiseSecurityAlert } from "../../alerts/security";
import { body, clientId, clientInfo, deviceCookie, mfaCookie, readDeviceCookie, readMfaCookie, readSessionToken, requireRecentAuth, sessionCookie } from "../middleware";
import { AppError, ValidationError, errorResponse } from "../errors";

export const authRoutes = new Hono<AppEnv>();

/** Runs a password check and records a refusal in the sign-in activity before passing it on. */
async function logged<T>(c: Context<AppEnv>, client: ClientInfo, onWrong: AuthEventKind, reason: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const log = c.env.agent.services.authLog;
    if (error instanceof AppError && error.code === "RATE_LIMITED") log.record("login_rate_limited", client, { reason });
    else if (error instanceof AppError && (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN")) log.record(onWrong, client, { reason });
    throw error;
  }
}

authRoutes.post("/login", async (c) => {
  const { password, email } = await body(c, signInSchema, 4096);
  const s = c.env.agent.services;
  const client = await clientInfo(c);
  const result = await logged(c, client, "login_failure", "wrong_credentials", () =>
    s.auth.login(password, clientId(c), c.req.header("user-agent") ?? "", email),
  );
  if (result.mfa) {
    // The password was right; the code comes next. This line is worth seeing if the code never does.
    s.authLog.record("mfa_challenge", client);
    c.header("set-cookie", mfaCookie(c, result.mfa.token));
    return c.json({ authenticated: false, mfa_required: true, expires_at: result.mfa.expiresAt.toISOString() });
  }
  return finishSignIn(c, client, result, "password");
});

/** The second step of a sign-in: the code for the challenge in the cookie. */
authRoutes.post("/mfa", async (c) => {
  const { code } = await body(c, mfaCodeSchema, 1024);
  const s = c.env.agent.services;
  const client = await clientInfo(c);
  try {
    const result = await s.auth.completeMfa(readMfaCookie(c), code, c.req.header("user-agent") ?? "", clientId(c), (reason) =>
      s.authLog.record("mfa_failure", client, { reason }),
    );
    c.header("set-cookie", mfaCookie(c, null), { append: true });
    return finishSignIn(c, client, result, result.factor);
  } catch (error) {
    // Once the challenge is over, its cookie goes too: the next try starts from the password.
    // Built here, because the error handler's own response would drop headers set on the context.
    if (!(error instanceof AppError) || (error.details as { mfa?: string } | undefined)?.mfa !== "expired") throw error;
    const res = errorResponse(error);
    res.headers.append("set-cookie", mfaCookie(c, null));
    return res;
  }
});

/** Everything after a complete sign-in: the old session ends, the device is noted, the cookie is set. */
async function finishSignIn(c: Context<AppEnv>, client: ClientInfo, signed: SignedIn, factor: "password" | MfaFactor) {
  const s = c.env.agent.services;
  const { token, expiresAt, sessionId } = signed;
  // A session cookie this browser already had ends here, so a planted one can't outlive the sign-in.
  const previous = c.get("sessionId");
  if (previous) s.auth.revoke(previous);
  s.activity.record("auth.login", "Signed in");
  // The password was right and the session exists: a storage error past this point must not cost the cookie.
  try {
    const knownDevice = s.authLog.isKnownDevice(client.device);
    const newCountry = s.authLog.isNewCountry(client.geo.country);
    const earlier = s.authLog.hadEarlierSignIn();
    s.authLog.record("login_success", client, { session: sessionId.slice(0, 16), knownDevice, reason: factor });
    // A browser without a known device cookie gets a new one; a known one is sent again, so its 180 days restart.
    let device = client.device;
    const current = readDeviceCookie(c);
    if (knownDevice && current) {
      c.header("set-cookie", deviceCookie(c, current), { append: true });
    } else {
      const value = randomToken(32);
      device = await s.authLog.deviceId(value);
      c.header("set-cookie", deviceCookie(c, value), { append: true });
    }
    if (device) s.authLog.rememberDevice(device);
    // The alert says nothing about where from: it can show on a lock screen. The details are in the app.
    if (earlier && (!knownDevice || newCountry)) {
      s.alerts.raise({
        category: "security",
        priority: "critical",
        title: "New sign-in",
        body: "Someone signed in to Talorys from a new device or country. If it wasn't you, change your password now and sign out the other sessions. Details in Settings → Security → Sign-in activity.",
      });
    }
  } catch (error) {
    console.warn("Sign-in device check failed", error instanceof Error ? error.name : "error");
  }
  c.header("set-cookie", sessionCookie(c, token), { append: true });
  return c.json({ authenticated: true, expires_at: expiresAt.toISOString() });
}

authRoutes.post("/logout", async (c) => {
  const sessionId = c.get("sessionId");
  if (sessionId) {
    c.env.agent.services.auth.revoke(sessionId);
    c.env.agent.services.authLog.record("logout", await clientInfo(c), { session: sessionId.slice(0, 16) });
  }
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
    // Only whether the sign-in form needs the field, never the address.
    email_required: authenticated ? undefined : s.auth.emailRequired(),
    password_change_required: authenticated ? s.auth.passwordChangeRequired() : undefined,
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
  const proof = await body(c, confirmSchema, 4096);
  const client = await clientInfo(c);
  const until = await logged(c, client, "confirm_failure", proof.code !== undefined ? "wrong_code" : "wrong_password", () =>
    c.env.agent.services.auth.confirm(sessionId, proof, clientId(c)),
  );
  c.env.agent.services.authLog.record("confirm_success", client, { session: sessionId.slice(0, 16) });
  return c.json({ confirmed: true, until: until.toISOString() });
});

authRoutes.get("/sessions", (c) => c.json({ sessions: c.env.agent.services.auth.listSessions(c.get("sessionId")) }));

authRoutes.delete("/sessions/:id", async (c) => {
  const id = c.req.param("id");
  const ok = c.env.agent.services.auth.revokeByPublicId(id);
  if (!ok) throw new AppError("NOT_FOUND", "Session not found");
  c.env.agent.services.authLog.record("session_revoked", await clientInfo(c), { session: id, reason: "one" });
  return c.json({ revoked: true });
});

authRoutes.post("/sessions/revoke-others", async (c) => {
  const count = c.env.agent.services.auth.revokeAllExcept(c.get("sessionId"));
  if (count > 0) c.env.agent.services.authLog.record("session_revoked", await clientInfo(c), { reason: "others" });
  return c.json({ revoked: count });
});

authRoutes.post("/password", async (c) => {
  const input = await body(c, changePasswordSchema, 4096);
  const s = c.env.agent.services;
  const client = await clientInfo(c);
  await logged(c, client, "confirm_failure", "password_change", () => s.auth.changePassword(input.current_password, input.new_password, clientId(c)));
  s.activity.record("auth.password_changed", "Password changed; other sessions signed out and access tokens revoked");
  // This browser stays signed in, on a new session: the old token no longer works anywhere.
  const { token, sessionId } = await s.auth.createSession(c.req.header("user-agent") ?? "");
  s.authLog.record("password_changed", client, { session: sessionId.slice(0, 16) });
  raiseSecurityAlert(s.alerts, "password_changed");
  c.header("set-cookie", sessionCookie(c, token));
  return c.json({ changed: true });
});

// ---------- Sign-in activity (owner session only: access tokens never reach /api/auth) ----------

/** The detailed rows carry IPs and user agents: like the export, they need the password typed recently. */
authRoutes.get("/activity", (c) => {
  requireRecentAuth(c);
  const parsed = authEventsQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  return c.json(c.env.agent.services.authLog.list(parsed.data));
});

authRoutes.get("/activity/summary", (c) => c.json(c.env.agent.services.authLog.summary()));

/** IPs and user agents for the whole retention: the password must have been typed recently. */
authRoutes.post("/activity/export", (c) => {
  requireRecentAuth(c);
  const day = new Date().toISOString().slice(0, 10);
  c.env.agent.services.activity.record("auth.activity_exported", "Sign-in activity exported");
  return c.json({ filename: `talorys-sign-in-activity-${day}.csv`, csv: c.env.agent.services.authLog.csv() });
});

authRoutes.post("/activity/delete", (c) => {
  requireRecentAuth(c);
  const deleted = c.env.agent.services.authLog.clear();
  c.env.agent.services.activity.record("auth.activity_deleted", "Sign-in activity deleted");
  raiseSecurityAlert(c.env.agent.services.alerts, "activity_deleted");
  return c.json({ deleted });
});

/** Any change needs the password typed recently: a longer one keeps more, a shorter one erases details now. */
authRoutes.put("/activity/settings", async (c) => {
  requireRecentAuth(c);
  const { retention_days } = await body(c, authLogSettingsSchema, 1024);
  const log = c.env.agent.services.authLog;
  const before = log.retentionDays();
  log.setRetentionDays(retention_days);
  if (retention_days !== before) c.env.agent.services.activity.record("auth.activity_retention_changed", "Sign-in activity retention changed");
  return c.json(log.summary());
});

// ---------- Two-step sign-in (owner session only) ----------

authRoutes.get("/mfa/status", (c) => c.json(c.env.agent.services.auth.mfa.status()));

/** A new secret to scan. Nothing changes until /mfa/enable gets a code made from it. */
authRoutes.post("/mfa/setup", async (c) => {
  requireRecentAuth(c);
  const s = c.env.agent.services;
  if (s.auth.mfa.enabled()) throw new AppError("CONFLICT", "Two-step sign-in is already on. Turn it off first to use another app.");
  return c.json(await s.auth.mfa.beginSetup(s.settings.get().agentName));
});

/** Turns it on with a code from the new secret. The recovery codes come back once, here. */
authRoutes.post("/mfa/enable", async (c) => {
  requireRecentAuth(c);
  const { code } = await body(c, mfaCodeSchema, 1024);
  const s = c.env.agent.services;
  if (s.auth.mfa.enabled()) throw new AppError("CONFLICT", "Two-step sign-in is already on.");
  const codes = await s.auth.mfa.enable(code);
  if (!codes) throw new ValidationError("Incorrect code. Check that your phone's clock is right and try again.");
  return c.json({ recovery_codes: codes, ...(await afterMfaChange(c, "mfa_enabled")) });
});

/** Turns it off: needs the password typed recently and a current code (or a recovery code). */
authRoutes.post("/mfa/disable", async (c) => {
  requireRecentAuth(c);
  const { code } = await body(c, mfaCodeSchema, 1024);
  const s = c.env.agent.services;
  if (!s.auth.mfa.enabled()) return c.json({ disabled: true, signed_out: 0 });
  const client = await clientInfo(c);
  await logged(c, client, "mfa_failure", "disable", () => s.auth.checkMfaCode(code, clientId(c), { recovery: true }));
  s.auth.mfa.disable();
  return c.json({ disabled: true, ...(await afterMfaChange(c, "mfa_disabled")) });
});

/** New recovery codes; the old ones stop working. */
authRoutes.post("/mfa/recovery-codes", async (c) => {
  requireRecentAuth(c);
  const { code } = await body(c, mfaCodeSchema, 1024);
  const s = c.env.agent.services;
  if (!s.auth.mfa.enabled()) throw new AppError("CONFLICT", "Two-step sign-in is off.");
  const client = await clientInfo(c);
  await logged(c, client, "mfa_failure", "recovery_codes", () => s.auth.checkMfaCode(code, clientId(c), { recovery: false }));
  const codes = await s.auth.mfa.regenerateCodes();
  s.authLog.record("mfa_codes_regenerated", client, { session: c.get("sessionId")!.slice(0, 16) });
  s.activity.record("auth.mfa_codes", "New recovery codes made");
  return c.json({ recovery_codes: codes });
});

/** Turning the second step on or off signs out every other session, and the owner is told. */
async function afterMfaChange(c: Context<AppEnv>, kind: "mfa_enabled" | "mfa_disabled"): Promise<{ signed_out: number }> {
  const s = c.env.agent.services;
  const sessionId = c.get("sessionId")!;
  const signedOut = s.auth.revokeAllExcept(sessionId);
  s.authLog.record(kind, await clientInfo(c), { session: sessionId.slice(0, 16) });
  const on = kind === "mfa_enabled";
  s.activity.record(on ? "auth.mfa_enabled" : "auth.mfa_disabled", on ? "Two-step sign-in turned on" : "Two-step sign-in turned off");
  s.alerts.raise({
    category: "security",
    priority: "critical",
    ...(on
      ? { title: "Two-step sign-in on", body: "Signing in now also asks for a code from your authenticator app. Other sessions were signed out." }
      : { title: "Two-step sign-in off", body: "Signing in no longer asks for a code. If it wasn't you, change your password now and turn it back on in Settings → Security." }),
  });
  return { signed_out: signedOut };
}
