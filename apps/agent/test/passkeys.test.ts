import { MAX_PASSKEYS, totpCode, totpStep } from "@talorys/shared";
import { afterEach, describe, expect, it } from "vitest";
import { BASE, type Client, client, inAgent, loggedIn, password } from "./helpers";
import { softPasskey, type SoftPasskey } from "./soft-authenticator";
import { PasskeyService } from "../src/auth/passkeys";

const RP_ID = new URL(BASE).hostname;

async function turnOnMfa(): Promise<void> {
  await inAgent(async (a) => {
    const { secret } = await a.services.auth.mfa.beginSetup("Axis");
    await a.services.auth.mfa.enable(await totpCode(secret, totpStep()));
  });
}

const stale = () => inAgent((a) => a.services.db.run(`UPDATE tal_sessions SET confirmed_at = ?`, new Date(Date.now() - 60 * 60_000).toISOString()));
const fresh = () => inAgent((a) => a.services.db.run(`UPDATE tal_sessions SET confirmed_at = ?`, new Date().toISOString()));
const events = () => inAgent((a) => a.services.authLog.list({ limit: 200 }).events);
const alerts = (title: string) => inAgent((a) => a.services.notifications.list({ limit: 50 }).filter((n) => n.title === title));
const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; message: string; details?: Record<string, unknown> } }).error;

/** Adds `key` as a passkey through the API, as the settings page does. */
async function add(c: Client, key: SoftPasskey, name = "Phone"): Promise<Response> {
  const { options } = await c.json("/api/auth/passkeys/options", { method: "POST", body: {} });
  return c.call("/api/auth/passkeys", { method: "POST", body: { name, response: await key.register(options, BASE) } });
}

/** Password, then the passkey request for that sign-in. */
async function passwordThenOptions(c: Client = client()) {
  const login = await c.json("/api/auth/login", { method: "POST", body: { password: password() } });
  const res = await c.call("/api/auth/mfa/passkey/options", { method: "POST", body: {} });
  return { c, login, res, options: res.status === 200 ? ((await res.json()) as { options: { challenge: string; rpId: string } }).options : null };
}

afterEach(() =>
  inAgent((a) => {
    a.services.auth.mfa.disable();
    a.services.authLog.clear();
    a.services.db.run(`DELETE FROM tal_notifications`);
    a.services.db.run(`DELETE FROM tal_login_attempts`);
  }),
);

describe("adding a passkey", () => {
  it("needs two-step sign-in on and the password typed recently", async () => {
    const c = await loggedIn();
    const off = await c.call("/api/auth/passkeys/options", { method: "POST", body: {} });
    expect(off.status).toBe(409);
    await turnOnMfa();
    await stale();
    expect((await errorOf(await c.call("/api/auth/passkeys/options", { method: "POST", body: {} }))).code).toBe("REAUTH_REQUIRED");
  });

  it("stores the public key only, lists it, logs it and tells the owner", async () => {
    const c = await loggedIn();
    await turnOnMfa();
    const key = await softPasskey();
    const { options } = await c.json("/api/auth/passkeys/options", { method: "POST", body: {} });
    expect(options).toMatchObject({ rp: { id: RP_ID }, attestation: "none" });
    expect(options.user.name).not.toContain("@");
    const res = await c.call("/api/auth/passkeys", { method: "POST", body: { name: "Phone", response: await key.register(options, BASE) } });
    expect(res.status).toBe(201);
    expect(((await res.json()) as any).passkey).toMatchObject({ id: key.id, name: "Phone", usable_here: true, last_used_at: null });
    expect((await c.json("/api/auth/passkeys")).passkeys).toHaveLength(1);
    expect((await events()).map((e) => e.kind)).toContain("passkey_added");
    expect(await alerts("Passkey added")).toHaveLength(1);
    // Offered again, the same authenticator is excluded.
    const again = await c.json("/api/auth/passkeys/options", { method: "POST", body: {} });
    expect(again.options.excludeCredentials.map((x: { id: string }) => x.id)).toEqual([key.id]);
  });

  it("refuses an answer for another site, a replayed answer and an expired request", async () => {
    const c = await loggedIn();
    await turnOnMfa();
    const key = await softPasskey();
    // Made for another origin (a phishing page relaying the request).
    const { options } = await c.json("/api/auth/passkeys/options", { method: "POST", body: {} });
    const phished = await key.register(options, "https://talorys.evil.example");
    expect((await c.call("/api/auth/passkeys", { method: "POST", body: { name: "x", response: phished } })).status).toBe(400);
    // The request is used up by that try, even with a good answer now.
    expect((await c.call("/api/auth/passkeys", { method: "POST", body: { name: "x", response: await key.register(options, BASE) } })).status).toBe(400);
    // Another rpId.
    const second = await c.json("/api/auth/passkeys/options", { method: "POST", body: {} });
    const otherRp = await key.register({ ...second.options, rp: { id: "evil.example" } }, BASE);
    expect((await c.call("/api/auth/passkeys", { method: "POST", body: { name: "x", response: otherRp } })).status).toBe(400);
    expect((await c.json("/api/auth/passkeys")).passkeys).toEqual([]);
  });

  it("stores nothing when two-step sign-in went off while the answer was being checked", async () => {
    await inAgent(async (a) => {
      const service = new PasskeyService(a.services.db, a.services.settings, () => false);
      const rp = { rpId: RP_ID, origin: BASE };
      const options = await service.registrationOptions(rp, { rpName: "Axis", userName: "Axis" });
      const key = await softPasskey();
      expect(await service.register("Phone", (await key.register(options as never, BASE)) as never, rp)).toBeNull();
      expect(service.count()).toBe(0);
    });
  });

  it(`keeps at most ${MAX_PASSKEYS}`, async () => {
    const c = await loggedIn();
    await turnOnMfa();
    for (let i = 0; i < MAX_PASSKEYS; i++) expect((await add(c, await softPasskey(), `Key ${i}`)).status).toBe(201);
    expect((await c.call("/api/auth/passkeys/options", { method: "POST", body: {} })).status).toBe(409);
  });
});

describe("signing in with a passkey", () => {
  async function withPasskey() {
    const owner = await loggedIn();
    await turnOnMfa();
    const key = await softPasskey();
    expect((await add(owner, key)).status).toBe(201);
    return { owner, key };
  }

  it("after the password, the passkey finishes the sign-in", async () => {
    const { key } = await withPasskey();
    const { c, login, options } = await passwordThenOptions();
    expect(login).toMatchObject({ mfa_required: true, passkey: true });
    expect(options).toMatchObject({ rpId: RP_ID, allowCredentials: [{ id: key.id }] });
    const res = await c.call("/api/auth/mfa/passkey", { method: "POST", body: { response: await key.assert(options!, BASE) } });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().find((s) => s.startsWith("__Host-talorys_mfa="))).toContain("Max-Age=0");
    expect((await c.call("/api/tasks")).status).toBe(200);
    expect((await events()).map((e) => [e.kind, e.reason])).toContainEqual(["login_success", "passkey"]);
    const [stored] = (await c.json("/api/auth/passkeys")).passkeys;
    expect(stored.last_used_at).not.toBeNull();
  });

  it("needs the password first: no challenge cookie, no passkey request", async () => {
    await withPasskey();
    const res = await client().call("/api/auth/mfa/passkey/options", { method: "POST", body: {} });
    expect(res.status).toBe(401);
  });

  it("refuses a replayed answer, another site's answer and a cloned key, each counted as a wrong try", async () => {
    const { key } = await withPasskey();
    const { c, options } = await passwordThenOptions();
    const good = await key.assert(options!, BASE);
    // A phishing origin's answer to the same challenge.
    const phished = await key.assert(options!, "https://talorys.evil.example");
    const first = await c.call("/api/auth/mfa/passkey", { method: "POST", body: { response: phished } });
    expect(await errorOf(first)).toMatchObject({ code: "UNAUTHORIZED", details: { mfa: "retry", attempts_left: 4 } });
    // The challenge was used up by that try: the good answer to it no longer works.
    expect(await errorOf(await c.call("/api/auth/mfa/passkey", { method: "POST", body: { response: good } }))).toMatchObject({ details: { mfa: "retry" } });

    // A fresh request, answered with a counter that went backwards (a copy of the key).
    const next = await c.json("/api/auth/mfa/passkey/options", { method: "POST", body: {} });
    await c.call("/api/auth/mfa/passkey", { method: "POST", body: { response: await key.assert(next.options, BASE) } });
    expect((await c.call("/api/tasks")).status).toBe(200);
    const again = await passwordThenOptions();
    const cloned = await key.assert(again.options!, BASE, { counter: 1 });
    expect((await again.c.call("/api/auth/mfa/passkey", { method: "POST", body: { response: cloned } })).status).toBe(401);
    expect((await events()).filter((e) => e.kind === "mfa_failure").map((e) => e.reason)).toContain("passkey");
  });

  it("three wrong passkey answers in a row tell the owner, and say passkey, not code", async () => {
    const { key } = await withPasskey();
    for (let i = 0; i < 3; i++) {
      const { c, options } = await passwordThenOptions();
      const res = await c.call("/api/auth/mfa/passkey", { method: "POST", body: { response: await key.assert(options!, "https://talorys.evil.example") } });
      expect((await errorOf(res)).message).toContain("passkey");
    }
    expect(await alerts("Wrong sign-in codes")).toHaveLength(1);
  });

  it("a right passkey answer ends a run of wrong codes", async () => {
    const { key } = await withPasskey();
    await inAgent((a) => a.services.settings.setJson("auth.mfa", { ...a.services.settings.getJson<object>("auth.mfa"), failures: 2 }));
    const { c, options } = await passwordThenOptions();
    expect((await c.call("/api/auth/mfa/passkey", { method: "POST", body: { response: await key.assert(options!, BASE) } })).status).toBe(200);
    expect(await inAgent((a) => a.services.auth.mfa.consecutiveFailures())).toBe(0);
  });

  it("a passkey made on another address isn't offered here", async () => {
    await withPasskey();
    await inAgent((a) => a.services.db.run(`UPDATE tal_passkeys SET rp_id = 'talorys.exemplo.com.br'`));
    const { login, res } = await passwordThenOptions();
    expect(login.passkey).toBe(false);
    expect(res.status).toBe(404);
  });

  it("turning two-step sign-in off removes every passkey", async () => {
    const { owner } = await withPasskey();
    await inAgent((a) => a.services.auth.mfa.disable());
    expect((await owner.json("/api/auth/passkeys")).passkeys).toEqual([]);
  });
});

describe("removing a passkey", () => {
  it("needs the password typed recently, then stops it working and tells the owner", async () => {
    const c = await loggedIn();
    await turnOnMfa();
    const key = await softPasskey();
    await add(c, key);
    await stale();
    expect((await c.call(`/api/auth/passkeys/${key.id}`, { method: "DELETE" })).status).toBe(403);
    await fresh();
    expect((await c.call(`/api/auth/passkeys/${key.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await alerts("Passkey removed")).toHaveLength(1);
    const { login } = await passwordThenOptions();
    expect(login.passkey).toBe(false);
  });

  it("can be renamed, with the password typed recently", async () => {
    const c = await loggedIn();
    await turnOnMfa();
    const key = await softPasskey();
    await add(c, key);
    await stale();
    expect((await c.call(`/api/auth/passkeys/${key.id}`, { method: "PATCH", body: { name: "Work key" } })).status).toBe(403);
    await fresh();
    expect((await c.call(`/api/auth/passkeys/${key.id}`, { method: "PATCH", body: { name: "Work key" } })).status).toBe(200);
    expect((await c.json("/api/auth/passkeys")).passkeys[0].name).toBe("Work key");
  });
});
