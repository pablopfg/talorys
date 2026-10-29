import { CLIENT_GEO_HEADER } from "@talorys/shared";
import { afterEach, describe, expect, it } from "vitest";
import { AuthLog, BLOCKED_FLUSH_MS, csvCell, FOLD_AFTER, MAX_EVENT_ROWS, MAX_OWNER_ROWS } from "../src/auth/auth-log";
import { withoutInternalHeaders } from "../src/index";
import { client, freshIp, inAgent, loggedIn, password } from "./helpers";

const DAY = 24 * 3600_000;
const geo = (g: Record<string, unknown>) => ({ [CLIENT_GEO_HEADER]: encodeURIComponent(JSON.stringify(g)) });
const events = () => inAgent((a) => a.services.authLog.list({ limit: 200 }).events);

afterEach(() =>
  inAgent((a) => {
    a.services.authLog.clear();
    a.services.authLog.forgetDevices();
    a.services.settings.delete("auth_log.retention_days");
    a.services.settings.delete("auth_log.purged_at");
  }),
);

describe("what the sign-in activity records", () => {
  it("records a failure and a success with the network details, never the password or the typed address", async () => {
    const c = client();
    const headers = { "user-agent": "Mozilla/5.0 (iPhone) Safari/605.1" };
    // What the edge fills in on a real request; a geo header the client sends itself is dropped.
    const cf = { country: "BR", region: "São Paulo", city: "Campinas", asn: 28573, asOrganization: "Claro", colo: "GRU" };
    expect((await c.call("/api/auth/login", { method: "POST", body: { password: "not-the-right-one-77" }, headers: { ...headers, ...geo({ country: "US" }) }, cf })).status).toBe(401);
    expect((await c.call("/api/auth/login", { method: "POST", body: { password: password() }, headers, cf })).status).toBe(200);
    const [success, failure] = await events();
    expect(failure).toMatchObject({ kind: "login_failure", reason: "wrong_credentials", ip: c.ip, network: c.ip, country: "BR", city: "Campinas", asn: 28573, as_org: "Claro", colo: "GRU" });
    expect(success).toMatchObject({ kind: "login_success", ip: c.ip, region: "São Paulo", known_device: false, host: "talorys.example.pages.dev" });
    expect(success!.session).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(await events())).not.toContain("not-the-right-one-77");
    expect(JSON.stringify(await events())).not.toContain(password());
  });

  it("records blocked attempts, logout, confirmation and session changes", async () => {
    const ip = freshIp();
    for (let i = 0; i < 4; i++) await client({ ip }).call("/api/auth/login", { method: "POST", body: { password: `wrong-${i}-xxxxxxxx` } });
    const c = await loggedIn();
    await c.call("/api/auth/confirm", { method: "POST", body: { password: "wrong-confirm-xxxxx" } });
    await c.call("/api/auth/confirm", { method: "POST", body: { password: password() } });
    await c.call("/api/auth/sessions/revoke-others", { method: "POST", body: {} });
    await c.call("/api/auth/logout", { method: "POST", body: {} });
    const kinds = (await events()).map((e) => e.kind).reverse();
    expect(kinds).toEqual(["login_failure", "login_failure", "login_failure", "login_rate_limited", "login_success", "confirm_failure", "confirm_success", "session_revoked", "logout"]);
  });

  it("ignores a location header sent by the client: only the Worker's entry point sets it", () => {
    const forged = new Request("https://talorys.example.pages.dev/api/auth/login", { headers: geo({ country: "US" }) });
    expect(withoutInternalHeaders(forged).headers.get(CLIENT_GEO_HEADER)).toBeNull();
  });

  it("keeps hostile text as plain text", async () => {
    await client().call("/api/auth/login", { method: "POST", body: { password: "wrong-password-xxxx" }, headers: { "user-agent": `<script>x</script>\u0007\u001b${"A".repeat(500)}` } });
    const [e] = await events();
    expect(e!.user_agent).toHaveLength(300);
    expect([...e!.user_agent!].every((ch) => ch.charCodeAt(0) >= 0x20)).toBe(true);
  });
});

describe("new device alerts", () => {
  const signIns = () => inAgent((a) => a.services.notifications.list({ limit: 50 }).filter((n) => n.title === "New sign-in"));

  it("warns on a new device, never on the first sign-in or a known device, and says nothing about where", async () => {
    await inAgent((a) => a.services.db.run(`DELETE FROM tal_notifications`));
    const phone = await loggedIn();
    expect(await signIns()).toHaveLength(0);
    expect(phone.cookie).toMatch(/__Host-talorys_device=/);
    // Same browser (device cookie kept), new network: no alert.
    phone.ip = freshIp();
    await phone.call("/api/auth/login", { method: "POST", body: { password: password() } });
    expect(await signIns()).toHaveLength(0);
    // A browser without the cookie: alert.
    const stranger = await loggedIn();
    const alerts = await signIns();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.body).not.toContain(stranger.ip);
  });

  it("sends a known device's cookie again at each sign-in, so its 180 days restart", async () => {
    const phone = await loggedIn();
    const first = phone.cookie!.match(/__Host-talorys_device=([^;]+)/)![1];
    const res = await phone.call("/api/auth/login", { method: "POST", body: { password: password() } });
    const again = res.headers.getSetCookie().find((s) => s.startsWith("__Host-talorys_device="))!;
    expect(again).toContain(`__Host-talorys_device=${first};`);
    expect(again).toMatch(/Max-Age=15552000/);
  });

  it("sets the device cookie HttpOnly, Secure and SameSite=Strict, for 180 days", async () => {
    const res = await client().call("/api/auth/login", { method: "POST", body: { password: password() } });
    const device = res.headers.getSetCookie().find((s) => s.startsWith("__Host-talorys_device="))!;
    expect(device).toMatch(/HttpOnly/);
    expect(device).toMatch(/Secure/);
    expect(device).toMatch(/SameSite=Strict/);
    expect(device).toMatch(/Max-Age=15552000/);
  });
});

describe("limits", () => {
  it("folds repeated failures from one network into one row", async () => {
    await inAgent((a) => {
      const log = a.services.authLog;
      const info = { ip: "203.0.113.9", network: "203.0.113.9", userAgent: "bot", host: "h", geo: { country: null, region: null, city: null, asn: null, asOrg: null, colo: null }, device: null };
      for (let i = 0; i < FOLD_AFTER + 30; i++) log.record("login_failure", info, { reason: "wrong_credentials" });
      const rows = log.list({ limit: 200 }).events;
      expect(rows).toHaveLength(FOLD_AFTER);
      expect(rows[0]!.count).toBe(31);
      expect(log.summary().failures).toBe(FOLD_AFTER + 30);
    });
  });

  it("a blocked network writes one row per window, and its count at most once a minute", async () => {
    await inAgent((a) => {
      let now = Date.now();
      const log = new AuthLog(a.services.db, a.services.settings, () => "secret-for-tests-0123456789abcdef", () => now);
      const info = { ip: "203.0.113.10", network: "203.0.113.10", userAgent: "bot", host: "h", geo: { country: null, region: null, city: null, asn: null, asOrg: null, colo: null }, device: null };
      const writes = () => a.services.db.one<{ n: number }>(`SELECT count(*) AS n FROM tal_auth_events`)!.n;
      for (let i = 0; i < 30; i++) log.record("login_rate_limited", info, { reason: "wrong_credentials" });
      expect(writes()).toBe(1);
      expect(log.list({ limit: 10 }).events[0]!.count).toBe(1);
      now += BLOCKED_FLUSH_MS;
      log.record("login_rate_limited", info, { reason: "wrong_credentials" });
      expect(writes()).toBe(1);
      expect(log.list({ limit: 10 }).events[0]!.count).toBe(31);
    });
  });

  it("a flood of refusals never pushes out the owner's own sign-ins", async () => {
    await inAgent((a) => {
      const db = a.services.db;
      const log = a.services.authLog;
      log.record("login_success", { ip: "198.51.100.1", network: "198.51.100.1", userAgent: "ua", host: "h", geo: { country: "BR", region: null, city: null, asn: null, asOrg: null, colo: null }, device: null });
      // Bulk rows standing in for many networks' refusals, then one more insert runs the cap.
      db.run(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
         INSERT INTO tal_auth_events (at, last_at, count, kind, network) SELECT ?, ?, 1, 'remote_token_rejected', 'net-' || i FROM n`,
        MAX_EVENT_ROWS,
        Date.now(),
        Date.now(),
      );
      (log as unknown as { cap(): void }).cap();
      const kinds = db.all<{ kind: string; n: number }>(`SELECT kind, count(*) AS n FROM tal_auth_events GROUP BY kind ORDER BY kind`);
      expect(kinds).toEqual([
        { kind: "login_success", n: 1 },
        { kind: "remote_token_rejected", n: MAX_EVENT_ROWS - MAX_OWNER_ROWS },
      ]);
    });
  });

  it("expired rows go when the activity is read, even with no new events", async () => {
    await inAgent((a) => {
      let now = Date.now() - 100 * DAY;
      const log = new AuthLog(a.services.db, a.services.settings, () => "secret-for-tests-0123456789abcdef", () => now);
      log.record("login_success", { ip: "198.51.100.8", network: "198.51.100.8", userAgent: "ua", host: "h", geo: { country: "BR", region: null, city: null, asn: null, asOrg: null, colo: null }, device: null });
      now = Date.now();
      expect(log.summary().successes).toBe(0);
      expect(log.list({ limit: 10 }).events).toHaveLength(0);
    });
  });

  it("turns rows past the retention into daily counts without IP or user agent", async () => {
    await inAgent((a) => {
      let now = Date.now() - 100 * DAY;
      const log = new AuthLog(a.services.db, a.services.settings, () => "secret-for-tests-0123456789abcdef", () => now);
      const info = { ip: "198.51.100.7", network: "198.51.100.7", userAgent: "ua", host: "h", geo: { country: "BR", region: null, city: null, asn: null, asOrg: null, colo: null }, device: null };
      log.record("login_success", info);
      now = Date.now();
      log.purge(true);
      expect(log.list({ limit: 10 }).events).toHaveLength(0);
      const daily = a.services.db.all<{ country: string; kind: string; n: number }>(`SELECT country, kind, n FROM tal_auth_daily`);
      expect(daily).toEqual([{ country: "BR", kind: "login_success", n: 1 }]);
    });
  });
});

describe("owner controls", () => {
  it("the details, export, delete and any retention change need the password typed recently; the summary doesn't", async () => {
    const c = await loggedIn();
    await inAgent((a) => a.services.db.run(`UPDATE tal_sessions SET confirmed_at = ?`, new Date(Date.now() - 3600_000).toISOString()));
    const code = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
    for (const path of ["/api/auth/activity/export", "/api/auth/activity/delete"]) {
      expect(await code(await c.call(path, { method: "POST", body: {} }))).toBe("REAUTH_REQUIRED");
    }
    expect(await code(await c.call("/api/auth/activity"))).toBe("REAUTH_REQUIRED");
    for (const days of [30, 180]) expect(await code(await c.call("/api/auth/activity/settings", { method: "PUT", body: { retention_days: days } }))).toBe("REAUTH_REQUIRED");
    expect((await c.call("/api/auth/activity/summary")).status).toBe(200);
    await c.call("/api/auth/confirm", { method: "POST", body: { password: password() } });
    expect((await c.json("/api/auth/activity/settings", { method: "PUT", body: { retention_days: 30 } })).retention_days).toBe(30);
    const { csv } = await c.json("/api/auth/activity/export", { method: "POST", body: {} });
    expect(csv.split("\r\n")[0]).toMatch(/^at,last_at,count,kind/);
    expect((await c.json("/api/auth/activity/delete", { method: "POST", body: {} })).deleted).toBeGreaterThan(0);
  });

  it("lists, filters and pages", async () => {
    const c = await loggedIn();
    for (let i = 0; i < 3; i++) await client().call("/api/auth/login", { method: "POST", body: { password: "wrong-password-xxxx" } });
    const page = await c.json("/api/auth/activity?failures=1&limit=2");
    expect(page.events).toHaveLength(2);
    expect(page.events.every((e: { kind: string }) => e.kind === "login_failure")).toBe(true);
    const rest = await c.json(`/api/auth/activity?failures=1&limit=2&before=${page.next_before}`);
    expect(rest.events).toHaveLength(1);
    expect((await c.call("/api/auth/activity?limit=999")).status).toBe(400);
    expect((await c.json("/api/auth/activity/summary")).failures).toBe(3);
  });

  it("is closed to anyone without a session", async () => {
    expect((await client().call("/api/auth/activity")).status).toBe(401);
    expect((await client().call("/api/auth/activity", { headers: { authorization: "Bearer tal_invalid" } })).status).toBe(401);
  });
});

describe("CSV cells", () => {
  it("neutralises spreadsheet formulas and quotes separators", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell("@x")).toBe(`"'@x"`);
    expect(csvCell('a,"b"')).toBe(`"a,""b"""`);
    expect(csvCell(null)).toBe("");
    expect(csvCell(42)).toBe("42");
  });
});
