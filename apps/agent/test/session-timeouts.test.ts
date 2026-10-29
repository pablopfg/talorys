import { afterEach, describe, expect, it } from "vitest";
import { inAgent, loggedIn, type Client } from "./helpers";

const MIN = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const ACTIVE = { "x-talorys-activity": "1" };

/** Rewrites the browser's session row as if time had passed. */
const setSession = (fields: Partial<Record<"created_at" | "last_seen_at" | "last_presence_at" | "confirmed_at", string>>) =>
  inAgent((a) => {
    for (const [k, v] of Object.entries(fields)) a.services.db.run(`UPDATE tal_sessions SET ${k} = ?`, v);
  });

const row = () =>
  inAgent((a) => a.services.db.one<{ last_seen_at: string; last_presence_at: string }>(`SELECT last_seen_at, last_presence_at FROM tal_sessions`)!);

const endedLog = () => inAgent((a) => a.services.db.all<{ summary: string }>(`SELECT summary FROM tal_activity WHERE type = 'auth.session_ended'`));

async function only(): Promise<Client> {
  await inAgent((a) => a.services.db.run(`DELETE FROM tal_sessions`));
  return loggedIn();
}

afterEach(() => inAgent((a) => a.services.settings.update({ session: { idleMinutes: 15, presenceMinutes: 5, maxHours: 12 } })));

describe("the three session deadlines (D9)", () => {
  it("ends a session nobody used for 15 minutes, even with a tab still polling", async () => {
    const c = await only();
    await setSession({ last_seen_at: ago(16 * MIN), last_presence_at: ago(10_000) });
    expect((await c.call("/api/tasks")).status).toBe(401);
    expect((await endedLog()).at(-1)?.summary).toBe("Signed out: no use");
  });

  it("ends a session when no tab answered for 5 minutes: browser closed or device asleep", async () => {
    const c = await only();
    await setSession({ last_seen_at: ago(2 * MIN), last_presence_at: ago(6 * MIN) });
    expect((await c.call("/api/tasks", { headers: ACTIVE })).status).toBe(401);
    expect((await endedLog()).at(-1)?.summary).toBe("Signed out: no open tab");
  });

  it("ends a session 12 hours after sign-in, even in constant use", async () => {
    const c = await only();
    await setSession({ created_at: ago(12 * 60 * MIN + 1000), last_seen_at: ago(1000), last_presence_at: ago(1000) });
    expect((await c.call("/api/tasks", { headers: ACTIVE })).status).toBe(401);
    expect((await endedLog()).at(-1)?.summary).toBe("Signed out: maximum session length");
  });

  it("never lists a session past a deadline as active", async () => {
    const c = await only();
    const other = await loggedIn();
    await inAgent((a) => a.services.db.run(`UPDATE tal_sessions SET last_seen_at = ? WHERE rowid = (SELECT MIN(rowid) FROM tal_sessions)`, ago(16 * MIN)));
    const { sessions } = await other.json("/api/auth/sessions");
    expect(sessions).toHaveLength(1);
    expect((await c.call("/api/tasks")).status).toBe(401);
  });

  it("keeps a session that is inside all three", async () => {
    const c = await only();
    await setSession({ created_at: ago(11 * 60 * MIN), last_seen_at: ago(14 * MIN), last_presence_at: ago(4 * MIN) });
    expect((await c.call("/api/tasks")).status).toBe(200);
  });
});

describe("what counts as use", () => {
  it("background requests renew presence but never use", async () => {
    const c = await only();
    await setSession({ last_seen_at: ago(5 * MIN), last_presence_at: ago(2 * MIN) });
    const before = await row();
    await c.call("/api/notifications");
    const after = await row();
    expect(after.last_seen_at).toBe(before.last_seen_at);
    expect(Date.parse(after.last_presence_at)).toBeGreaterThan(Date.parse(before.last_presence_at));
  });

  it("requests the owner started renew use", async () => {
    const c = await only();
    await setSession({ last_seen_at: ago(5 * MIN) });
    await c.call("/api/tasks", { headers: ACTIVE });
    expect(Date.now() - Date.parse((await row()).last_seen_at)).toBeLessThan(10_000);
  });

  it("writes at most once a minute", async () => {
    const c = await only();
    const stamp = ago(30_000);
    await setSession({ last_seen_at: stamp, last_presence_at: stamp });
    await c.call("/api/tasks", { headers: ACTIVE });
    expect(await row()).toEqual({ last_seen_at: stamp, last_presence_at: stamp });
  });

  it("a heartbeat without use keeps presence only, so idle logout still happens", async () => {
    const c = await only();
    await setSession({ last_seen_at: ago(14 * MIN), last_presence_at: ago(4 * MIN) });
    const res = await c.call("/api/auth/heartbeat", { method: "POST", body: { active: false } });
    expect(res.status).toBe(200);
    const { deadlines } = (await res.json()) as { deadlines: { idle_at: string; presence_at: string; max_at: string } };
    expect(Date.parse(deadlines.idle_at) - Date.now()).toBeLessThan(MIN + 1000);
    expect(Date.parse(deadlines.presence_at) - Date.now()).toBeGreaterThan(4 * MIN);
    await setSession({ last_seen_at: ago(16 * MIN) });
    expect((await c.call("/api/auth/heartbeat", { method: "POST", body: { active: false } })).status).toBe(401);
  });

  it("a heartbeat with use renews both", async () => {
    const c = await only();
    await setSession({ last_seen_at: ago(14 * MIN), last_presence_at: ago(4 * MIN) });
    const { deadlines } = await c.json("/api/auth/heartbeat", { method: "POST", body: { active: true } });
    expect(Date.parse(deadlines.idle_at) - Date.now()).toBeGreaterThan(14 * MIN);
    expect(deadlines.timeouts).toEqual({ idleMinutes: 15, presenceMinutes: 5, maxHours: 12 });
  });

  it("the session endpoint reports the deadlines only when signed in", async () => {
    const c = await only();
    const s = await c.json("/api/auth/session");
    expect(Date.parse(s.deadlines.max_at) - Date.now()).toBeGreaterThan(11 * 60 * MIN);
    await c.call("/api/auth/logout", { method: "POST", body: {} });
    expect((await c.json("/api/auth/session")).deadlines).toBeUndefined();
  });
});

describe("cookie and sign-out", () => {
  it("the session cookie ends with the browser", async () => {
    const res = await (await only()).call("/api/auth/login", { method: "POST", body: { password: (await import("./helpers")).password() } });
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).not.toMatch(/Expires=|Max-Age=/i);
  });

  it("signing out clears the cookie and the browser's cache, but not storage (push)", async () => {
    const c = await only();
    const res = await c.call("/api/auth/logout", { method: "POST", body: {} });
    expect(res.headers.get("clear-site-data")).toBe('"cache"');
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });
});

describe("adjusting the timeouts", () => {
  it("shortening is free and applies to open sessions", async () => {
    const c = await only();
    await setSession({ confirmed_at: ago(60 * MIN) });
    expect((await c.call("/api/settings", { method: "PATCH", body: { session: { idleMinutes: 5 } } })).status).toBe(200);
    await setSession({ last_seen_at: ago(6 * MIN) });
    expect((await c.call("/api/tasks")).status).toBe(401);
  });

  it("lengthening needs the password typed recently", async () => {
    const c = await only();
    await setSession({ confirmed_at: ago(60 * MIN) });
    const res = await c.call("/api/settings", { method: "PATCH", body: { session: { maxHours: 24 } } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("REAUTH_REQUIRED");
    await setSession({ confirmed_at: ago(MIN) });
    expect((await c.call("/api/settings", { method: "PATCH", body: { session: { maxHours: 24 } } })).status).toBe(200);
  });

  it("the server enforces each range", async () => {
    const c = await only();
    for (const session of [{ idleMinutes: 4 }, { idleMinutes: 61 }, { presenceMinutes: 2 }, { presenceMinutes: 16 }, { maxHours: 0 }, { maxHours: 25 }, { idleMinutes: 7.5 }]) {
      expect((await c.call("/api/settings", { method: "PATCH", body: { session } })).status, JSON.stringify(session)).toBe(400);
    }
  });
});
