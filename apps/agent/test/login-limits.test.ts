import { afterEach, describe, expect, it } from "vitest";
import { client, freshIp, inAgent, password } from "./helpers";
import { clientKey } from "../src/api/middleware";

const DAY = 24 * 3600_000;
const login = (ip: string, pw = password()) => client({ ip }).call("/api/auth/login", { method: "POST", body: { password: pw } });
const recordAttempt = (ip: string, success: 0 | 1, at: number) =>
  inAgent((a) => a.services.db.run(`INSERT INTO tal_login_attempts (client, success, at) VALUES (?, ?, ?)`, clientKey(ip), success, at));

/** Trips the global (distributed-guessing) limit with failures from 25 unrelated clients. */
const tripGlobalLimit = () =>
  inAgent((a) => {
    for (let i = 0; i < 25; i++) a.services.db.run(`INSERT INTO tal_login_attempts (client, success, at) VALUES (?, 0, ?)`, `bot-${i}`, Date.now());
  });

const randomPrefix = () => `2001:db8:${Math.floor(Math.random() * 0xffff).toString(16)}:${Math.floor(Math.random() * 0xffff).toString(16)}`;

afterEach(() => inAgent((a) => a.services.db.run(`DELETE FROM tal_login_attempts`)));

describe("login limits per client", () => {
  it("counts an IPv6 /64 as one client, so rotating addresses inside it does not reset the limit", async () => {
    const prefix = randomPrefix();
    for (let i = 0; i < 5; i++) expect((await login(`${prefix}::${i + 1}`, `wrong-${i}`)).status).toBe(401);
    expect((await login(`${prefix}:ffff::9`)).status).toBe(429);
    // Another /64 is a different client.
    expect((await login(`${randomPrefix()}::1`)).status).toBe(200);
  });

  it("derives one key per IPv4 address or IPv6 /64", () => {
    expect(clientKey("203.0.113.7")).toBe("203.0.113.7");
    expect(clientKey("2001:db8:a:b:1:2:3:4")).toBe("2001:db8:a:b::/64");
    expect(clientKey("2001:DB8:A:B::9")).toBe("2001:db8:a:b::/64");
    expect(clientKey("2001:0db8:000a:000b:ffff::1")).toBe("2001:db8:a:b::/64");
    expect(clientKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(clientKey("::1")).toBe("0:0:0:0::/64");
    expect(clientKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    // IPv4-mapped addresses stay per IPv4 address rather than collapsing into one /64.
    expect(clientKey("::ffff:192.0.2.1")).toBe("192.0.2.1");
    expect(clientKey("::ffff:c000:201")).toBe("192.0.2.1");
    expect(clientKey("0:0:0:0:0:ffff:192.0.2.1")).toBe("192.0.2.1");
    expect(clientKey("::ffff:192.000.002.001")).toBe("192.0.2.1");
    expect(clientKey("local")).toBe("local");
  });
});

describe("global limit and the owner's own networks (AUTH-02)", () => {
  it("gives a new network one attempt per window instead of locking it out", async () => {
    await tripGlobalLimit();
    // The owner on a network they never used can still type the right password.
    expect((await login(freshIp())).status).toBe(200);
    // A guesser gets one try per address.
    const bot = freshIp();
    expect((await login(bot, "wrong")).status).toBe(401);
    const res = await login(bot);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(800);
  });

  it("past 100 failures, unknown networks get no attempt at all, so more addresses buy no more guesses", async () => {
    await inAgent((a) => {
      for (let i = 0; i < 100; i++) a.services.db.run(`INSERT INTO tal_login_attempts (client, success, at) VALUES (?, 0, ?)`, `bot-${i}`, Date.now());
    });
    const res = await login(freshIp());
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(800);
    // The owner's recent networks still get in.
    const home = freshIp();
    await recordAttempt(home, 1, Date.now() - DAY);
    expect((await login(home)).status).toBe(200);
  });

  it("tells the owner once, not on every attempt", async () => {
    const count = () => inAgent((a) => a.services.db.one<{ n: number }>(`SELECT count(*) AS n FROM tal_notifications WHERE title = 'Many failed sign-ins'`)!.n);
    await inAgent((a) => a.services.settings.delete("auth.attack_alerted_at"));
    const before = await count();
    await tripGlobalLimit();
    await login(freshIp(), "wrong");
    await login(freshIp(), "wrong");
    expect(await count()).toBe(before + 1);
  });

  it("lets the owner sign in from a network that signed in within the last 30 days", async () => {
    const home = freshIp();
    // Older than the 24-hour cleanup of failures, so the success row must survive it.
    await recordAttempt(home, 1, Date.now() - 2 * DAY);
    await tripGlobalLimit();
    expect((await login(home)).status).toBe(200);
  });

  it("does not trust a network whose last sign-in is older than 30 days", async () => {
    const stale = freshIp();
    await recordAttempt(stale, 1, Date.now() - 31 * DAY);
    await tripGlobalLimit();
    expect((await login(stale, "wrong")).status).toBe(401);
    expect((await login(stale)).status).toBe(429);
  });

  it("keeps a trusted network's full allowance during an attack", async () => {
    const home = freshIp();
    await recordAttempt(home, 1, Date.now() - DAY);
    await tripGlobalLimit();
    for (let i = 0; i < 4; i++) expect((await login(home, `wrong-${i}`)).status).toBe(401);
    expect((await login(home)).status).toBe(200);
  });

  it("keeps the per-client limit for trusted networks", async () => {
    const home = freshIp();
    await recordAttempt(home, 1, Date.now() - DAY);
    for (let i = 0; i < 5; i++) expect((await login(home, `wrong-${i}`)).status).toBe(401);
    expect((await login(home)).status).toBe(429);
  });
});
