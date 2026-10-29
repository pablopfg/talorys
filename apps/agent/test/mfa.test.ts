import { MFA_MAX_ATTEMPTS, totpCode, totpStep } from "@talorys/shared";
import { afterEach, describe, expect, it } from "vitest";
import type { TalorysAgent } from "../src/agent/talorys-agent";
import { type Client, client, inAgent, loggedIn, password } from "./helpers";

/** Turns two-step sign-in on through the service. Returns the secret and the recovery codes. */
async function turnOn(): Promise<{ secret: string; codes: string[] }> {
  return inAgent(async (a) => {
    const mfa = a.services.auth.mfa;
    const { secret } = await mfa.beginSetup("Talorys");
    const codes = (await mfa.enable(await totpCode(secret, totpStep())))!;
    return { secret, codes };
  });
}

/**
 * A code for the current step that no earlier request used. Only one code per 30 seconds is
 * accepted (a used step never counts again), so tests that need several move the record back.
 */
async function freshCode(secret: string): Promise<string> {
  await inAgent((a) => {
    const state = mfaState(a);
    if (state) a.services.settings.setJson("auth.mfa", { ...state, last_step: totpStep() - 2 });
  });
  return totpCode(secret, totpStep());
}

const mfaState = (a: TalorysAgent) => a.services.settings.getJson<{ secret: string; codes: string[]; last_step: number }>("auth.mfa");
const events = () => inAgent((a) => a.services.authLog.list({ limit: 200 }).events);
const alerts = (title: string) => inAgent((a) => a.services.notifications.list({ limit: 50 }).filter((n) => n.title === title));
const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; message: string; details?: Record<string, unknown> } }).error;

afterEach(() =>
  inAgent((a) => {
    a.services.auth.mfa.disable();
    a.services.authLog.clear();
    a.services.db.run(`DELETE FROM tal_notifications`);
    a.services.db.run(`DELETE FROM tal_login_attempts`);
  }),
);

async function passwordStep(c: Client = client()): Promise<Response> {
  return c.call("/api/auth/login", { method: "POST", body: { password: password() } });
}

describe("signing in with two-step sign-in on", () => {
  it("a right password opens no session: it sets a 5-minute challenge cookie instead", async () => {
    await turnOn();
    const c = client();
    const res = await passwordStep(c);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ authenticated: false, mfa_required: true });
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((s) => s.startsWith("__Host-talorys_session="))).toBe(false);
    const mfa = cookies.find((s) => s.startsWith("__Host-talorys_mfa="))!;
    for (const attr of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/", "Max-Age=300"]) expect(mfa).toContain(attr);
    expect((await c.call("/api/tasks")).status).toBe(401);
  });

  it("the right code finishes the sign-in, once", async () => {
    const { secret } = await turnOn();
    const c = client();
    await passwordStep(c);
    const code = await freshCode(secret);
    const res = await c.call("/api/auth/mfa", { method: "POST", body: { code } });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().find((s) => s.startsWith("__Host-talorys_mfa="))).toContain("Max-Age=0");
    expect((await c.call("/api/tasks")).status).toBe(200);
    const kinds = (await events()).map((e) => [e.kind, e.reason]);
    expect(kinds).toContainEqual(["login_success", "totp"]);
    expect(kinds).toContainEqual(["mfa_challenge", null]);
    // The same code never works twice, even on a new challenge.
    const again = client();
    await passwordStep(again);
    expect((await again.call("/api/auth/mfa", { method: "POST", body: { code } })).status).toBe(401);
  });

  it("five wrong codes end the challenge; three in a row tell the owner", async () => {
    const { secret } = await turnOn();
    const c = client();
    await passwordStep(c);
    for (let i = 1; i < MFA_MAX_ATTEMPTS; i++) {
      const err = await errorOf(await c.call("/api/auth/mfa", { method: "POST", body: { code: "000000" } }));
      expect(err).toMatchObject({ code: "UNAUTHORIZED", details: { mfa: "retry", attempts_left: MFA_MAX_ATTEMPTS - i } });
    }
    expect(await alerts("Wrong sign-in codes")).toHaveLength(1);
    const last = await c.call("/api/auth/mfa", { method: "POST", body: { code: "000000" } });
    expect((await errorOf(last)).details).toMatchObject({ mfa: "expired" });
    expect(last.headers.getSetCookie().find((s) => s.includes("talorys_mfa="))).toContain("Max-Age=0");
    // A right code after that is too late: the password comes first again.
    expect((await errorOf(await c.call("/api/auth/mfa", { method: "POST", body: { code: await freshCode(secret) } }))).details).toMatchObject({ mfa: "expired" });
    const failures = (await events()).filter((e) => e.kind === "mfa_failure").map((e) => e.reason);
    expect(failures).toEqual(["too_many", "wrong_code", "wrong_code", "wrong_code", "wrong_code"]);
  });

  it("codes sent in parallel with one cookie still get only five tries", async () => {
    await turnOn();
    const c = client();
    await passwordStep(c);
    const replies = await Promise.all(Array.from({ length: 12 }, () => c.call("/api/auth/mfa", { method: "POST", body: { code: "000000" } })));
    const retries = (await Promise.all(replies.map(errorOf))).filter((e) => e.details?.mfa === "retry");
    expect(retries.length).toBeLessThan(MFA_MAX_ATTEMPTS);
    const wrong = (await events()).filter((e) => e.kind === "mfa_failure" && (e.reason === "wrong_code" || e.reason === "too_many"));
    expect(wrong.length).toBeLessThanOrEqual(MFA_MAX_ATTEMPTS);
  });

  it("past 10 wrong codes from anywhere, only the owner's own networks may try codes", async () => {
    const { secret } = await turnOn();
    // The owner signed in from this network before.
    const home = client();
    await inAgent((a) => a.services.db.run(`INSERT INTO tal_login_attempts (client, success, at) VALUES (?, 1, ?)`, home.ip, Date.now()));
    for (let n = 0; n < 2; n++) {
      const c = client();
      await passwordStep(c);
      for (let i = 0; i < MFA_MAX_ATTEMPTS; i++) await c.call("/api/auth/mfa", { method: "POST", body: { code: "000000" } });
    }
    const stranger = client();
    await passwordStep(stranger);
    const refused = await stranger.call("/api/auth/mfa", { method: "POST", body: { code: await freshCode(secret) } });
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBeTruthy();
    expect((await stranger.call("/api/tasks")).status).toBe(401);
    await passwordStep(home);
    expect((await home.call("/api/auth/mfa", { method: "POST", body: { code: await freshCode(secret) } })).status).toBe(200);
  });

  it("changing the password ends sign-ins waiting for their code", async () => {
    const { secret } = await turnOn();
    const waiting = client();
    await passwordStep(waiting);
    try {
      await inAgent((a) => a.services.auth.changePassword(password(), "Outra-frase-Longa-de-teste-47", "203.0.113.9"));
      const res = await waiting.call("/api/auth/mfa", { method: "POST", body: { code: await freshCode(secret) } });
      expect((await errorOf(res)).details).toMatchObject({ mfa: "expired" });
    } finally {
      await inAgent((a) => a.services.settings.delete("auth.password_override"));
    }
  });

  it("a challenge past 5 minutes is over", async () => {
    const { secret } = await turnOn();
    const c = client();
    await passwordStep(c);
    await inAgent((a) => a.services.db.run(`UPDATE tal_mfa_challenges SET expires_at = ?`, Date.now() - 1));
    const res = await c.call("/api/auth/mfa", { method: "POST", body: { code: await freshCode(secret) } });
    expect(res.status).toBe(401);
    expect((await events()).map((e) => [e.kind, e.reason])).toContainEqual(["mfa_failure", "expired"]);
  });

  it("without a real challenge cookie, nothing happens and nothing is written", async () => {
    const { secret } = await turnOn();
    for (const cookie of [null, "__Host-talorys_mfa=made-up-value"]) {
      const res = await client({ cookie }).call("/api/auth/mfa", { method: "POST", body: { code: await freshCode(secret) } });
      expect(res.status).toBe(401);
    }
    expect(await events()).toHaveLength(0);
  });

  it("a recovery code works once, and the owner hears about it", async () => {
    const { codes } = await turnOn();
    const c = client();
    await passwordStep(c);
    expect((await c.call("/api/auth/mfa", { method: "POST", body: { code: codes[0]!.toLowerCase() } })).status).toBe(200);
    expect((await alerts("Recovery code used"))[0]!.body).toContain("9");
    const other = client();
    await passwordStep(other);
    expect((await other.call("/api/auth/mfa", { method: "POST", body: { code: codes[0] } })).status).toBe(401);
    expect(await inAgent((a) => a.services.auth.mfa.status().recovery_codes_left)).toBe(9);
  });

  it("a weak password still has to be changed after the code", async () => {
    const { secret } = await turnOn();
    const c = client();
    await passwordStep(c);
    await inAgent((a) => a.services.db.run(`UPDATE tal_mfa_challenges SET weak_password = 1`));
    await c.call("/api/auth/mfa", { method: "POST", body: { code: await freshCode(secret) } });
    try {
      expect((await errorOf(await c.call("/api/tasks"))).code).toBe("PASSWORD_CHANGE_REQUIRED");
    } finally {
      await inAgent((a) => a.services.settings.delete("auth.password_change_required"));
    }
  });
});

describe("turning two-step sign-in on and off", () => {
  it("stores the secret encrypted and the recovery codes only as hashes", async () => {
    const { secret, codes } = await turnOn();
    const stored = JSON.stringify(await inAgent(mfaState));
    expect(stored).not.toContain(secret);
    for (const code of codes) expect(stored).not.toContain(code.replace(/-/g, ""));
    expect(codes).toHaveLength(10);
  });

  it("setup and enabling need the password typed recently and a right code; other sessions end", async () => {
    const other = await loggedIn();
    const c = await loggedIn();
    await inAgent((a) => a.services.db.run(`UPDATE tal_sessions SET confirmed_at = ?`, new Date(Date.now() - 3600_000).toISOString()));
    expect((await errorOf(await c.call("/api/auth/mfa/setup", { method: "POST", body: {} }))).code).toBe("REAUTH_REQUIRED");
    await c.call("/api/auth/confirm", { method: "POST", body: { password: password() } });
    const setup = await c.json("/api/auth/mfa/setup", { method: "POST", body: {} });
    expect(setup.otpauth_uri).toMatch(/^otpauth:\/\/totp\//);
    expect((await c.call("/api/auth/mfa/enable", { method: "POST", body: { code: "000000" } })).status).toBe(400);
    const on = await c.json("/api/auth/mfa/enable", { method: "POST", body: { code: await totpCode(setup.secret, totpStep()) } });
    expect(on.recovery_codes).toHaveLength(10);
    expect(on.signed_out).toBeGreaterThanOrEqual(1);
    expect((await other.call("/api/tasks")).status).toBe(401);
    expect(await c.json("/api/auth/mfa/status")).toMatchObject({ enabled: true, recovery_codes_left: 10 });
    expect(await alerts("Two-step sign-in on")).toHaveLength(1);
    expect((await events()).map((e) => e.kind)).toContain("mfa_enabled");
  });

  it("turning it off needs a right code; a recovery code counts", async () => {
    const { codes } = await turnOn();
    const owner = client();
    await passwordStep(owner);
    await owner.call("/api/auth/mfa", { method: "POST", body: { code: codes[0] } });
    expect((await owner.call("/api/auth/mfa/disable", { method: "POST", body: { code: "000000" } })).status).toBe(403);
    expect(await inAgent((a) => a.services.auth.mfa.enabled())).toBe(true);
    expect((await owner.json("/api/auth/mfa/disable", { method: "POST", body: { code: codes[1] } })).disabled).toBe(true);
    expect(await alerts("Two-step sign-in off")).toHaveLength(1);
    expect((await passwordStep()).status).toBe(200);
    expect(await inAgent((a) => a.services.auth.mfa.enabled())).toBe(false);
  });

  it("new recovery codes replace the old ones", async () => {
    const { secret, codes } = await turnOn();
    const owner = client();
    await passwordStep(owner);
    await owner.call("/api/auth/mfa", { method: "POST", body: { code: await freshCode(secret) } });
    // Recovery codes can't be used to make new ones: that takes the app.
    expect((await owner.call("/api/auth/mfa/recovery-codes", { method: "POST", body: { code: codes[0] } })).status).toBe(403);
    const fresh = (await owner.json("/api/auth/mfa/recovery-codes", { method: "POST", body: { code: await freshCode(secret) } })).recovery_codes as string[];
    expect(fresh).toHaveLength(10);
    const next = client();
    await passwordStep(next);
    expect((await next.call("/api/auth/mfa", { method: "POST", body: { code: codes[1] } })).status).toBe(401);
    expect((await next.call("/api/auth/mfa", { method: "POST", body: { code: fresh[0] } })).status).toBe(200);
  });

  it("codes typed to confirm identity count as wrong codes: alert at 3 in a row, pause for networks that aren't the owner's", async () => {
    const { secret } = await turnOn();
    const owner = client();
    await passwordStep(owner);
    await owner.call("/api/auth/mfa", { method: "POST", body: { code: await freshCode(secret) } });
    for (let i = 0; i < 3; i++) expect((await owner.call("/api/auth/confirm", { method: "POST", body: { code: "000000" } })).status).toBe(403);
    expect(await alerts("Wrong sign-in codes")).toHaveLength(1);
    // A stolen session on another network: with the pause on, not even the right code is checked.
    await inAgent((a) => {
      a.services.db.run(`DELETE FROM tal_login_attempts`);
      for (let i = 0; i < 10; i++) a.services.auth.mfa.noteWrongCode();
    });
    const paused = await owner.call("/api/auth/confirm", { method: "POST", body: { code: await freshCode(secret) } });
    expect(paused.status).toBe(429);
    expect((await errorOf(paused)).code).toBe("RATE_LIMITED");
    expect((await owner.call("/api/auth/mfa/recovery-codes", { method: "POST", body: { code: await freshCode(secret) } })).status).toBe(429);
  });

  it("an authenticator code also confirms identity for sensitive actions", async () => {
    const { secret } = await turnOn();
    const owner = client();
    await passwordStep(owner);
    await owner.call("/api/auth/mfa", { method: "POST", body: { code: await freshCode(secret) } });
    await inAgent((a) => a.services.db.run(`UPDATE tal_sessions SET confirmed_at = ?`, new Date(Date.now() - 3600_000).toISOString()));
    expect((await owner.call("/api/auth/confirm", { method: "POST", body: { code: "000000" } })).status).toBe(403);
    expect((await owner.call("/api/auth/confirm", { method: "POST", body: { code: await freshCode(secret) } })).status).toBe(200);
    expect((await owner.call("/api/auth/confirm", { method: "POST", body: { password: password(), code: "123456" } })).status).toBe(400);
  });

  it("a CLI password reset turns it off, so a lost phone isn't a lost account", async () => {
    await turnOn();
    await inAgent(async (a) => {
      a.services.settings.setJson("auth.secret_fingerprint", "an-older-secret");
      await a.services.auth.syncSecretFingerprint();
      expect(a.services.auth.mfa.enabled()).toBe(false);
    });
    expect((await (await passwordStep()).json()) as { authenticated: boolean }).toMatchObject({ authenticated: true });
  });

  it("is closed to anyone without a session", async () => {
    for (const path of ["/api/auth/mfa/setup", "/api/auth/mfa/enable", "/api/auth/mfa/disable", "/api/auth/mfa/recovery-codes"]) {
      expect((await client().call(path, { method: "POST", body: { code: "123456" } })).status).toBe(401);
    }
    expect((await client().call("/api/auth/mfa/status")).status).toBe(401);
  });
});
