import { MAX_PUSH_DEVICES, PUSH_INACTIVE_DAYS } from "@talorys/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { client, inAgent, loggedIn } from "./helpers";
import { fakeBrowser, pushServiceStub } from "./push-helpers";
import { endpointProblem } from "../src/push/endpoint";
import { deviceLabel } from "../src/push/routes";

beforeEach(async () => {
  await inAgent((agent) => {
    agent.services.db.run(`DELETE FROM tal_push_subscriptions`);
    // A new device raises a security alert, which is pushed: a fake push service accepts it.
    agent.services.push.fetcher = pushServiceStub(201).fetcher;
  });
});

describe("push endpoint validation", () => {
  it.each([
    ["http://fcm.googleapis.com/x", /https/],
    ["https://user:pw@fcm.googleapis.com/x", /credentials/],
    ["https://fcm.googleapis.com:8443/x", /default https port/],
    ["https://127.0.0.1/x", /known browser push service/],
    ["https://2130706433/x", /known browser push service/],
    ["https://[::1]/x", /known browser push service/],
    ["https://localhost/x", /known browser push service/],
    ["https://printer.local/x", /known browser push service/],
    ["https://example.com/push", /known browser push service/],
    ["https://fcm.googleapis.com.example.com/x", /known browser push service/],
    ["https://evilpush.apple.com.example.net/x", /known browser push service/],
    ["https://notpush.apple.com/x", /known browser push service/],
    ["not a url", /valid URL/],
  ])("refuses %s", (url, reason) => {
    expect(endpointProblem(url)).toMatch(reason);
  });

  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/QGx",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])("accepts %s", (url) => {
    expect(endpointProblem(url)).toBeNull();
  });
});

describe("push API", () => {
  it("requires a session and the CSRF header", async () => {
    const anon = client();
    expect((await anon.call("/api/push")).status).toBe(401);
    const c = await loggedIn();
    const browser = await fakeBrowser();
    const res = await c.call("/api/push/subscriptions", { method: "POST", body: browser.json, headers: { "x-talorys-request": "0" } });
    expect(res.status).toBe(403);
    expect((await c.json("/api/push")).devices).toEqual([]);
  });

  it("reports that push is available and exposes only the public key", async () => {
    const c = await loggedIn();
    const status = await c.json("/api/push");
    expect(status.available).toBe(true);
    expect(status.public_key).toMatch(/^[\w-]{87}$/);
    expect(status.max_devices).toBe(MAX_PUSH_DEVICES);
    expect(MAX_PUSH_DEVICES).toBe(3);
    expect(status.inactive_days).toBe(PUSH_INACTIVE_DAYS);
    expect(JSON.stringify(status)).not.toContain("PRIVATE");
    const health = await c.json("/api/health");
    expect(health.push).toBe(true);
  });

  it("subscribes, refreshes the same endpoint, and removes devices", async () => {
    const c = await loggedIn();
    const browser = await fakeBrowser();
    const first = await c.json("/api/push/subscriptions", { method: "POST", body: { ...browser.json, label: "My phone" } });
    expect(first.device).toMatchObject({ label: "My phone", service: "fcm.googleapis.com", failures: 0, last_success_at: null });
    expect(JSON.stringify(first)).not.toContain(browser.endpoint);
    const again = await c.json("/api/push/subscriptions", { method: "POST", body: browser.json });
    expect(again.device.id).toBe(first.device.id);
    expect(again.status.devices).toHaveLength(1);

    const other = await fakeBrowser("https://updates.push.services.mozilla.com/wpush/v2/xyz");
    const second = await c.json("/api/push/subscriptions", { method: "POST", body: other.json });
    expect(second.status.devices).toHaveLength(2);

    const afterDelete = await c.json(`/api/push/subscriptions/${first.device.id}`, { method: "DELETE" });
    expect(afterDelete.devices.map((d: { id: string }) => d.id)).toEqual([second.device.id]);
    expect((await c.call(`/api/push/subscriptions/${first.device.id}`, { method: "DELETE" })).status).toBe(404);

    const afterUnsub = await c.json("/api/push/unsubscribe", { method: "POST", body: { endpoint: other.endpoint } });
    expect(afterUnsub.devices).toEqual([]);
  });

  it("rejects unsafe endpoints and malformed keys without storing anything", async () => {
    const c = await loggedIn();
    const browser = await fakeBrowser("https://10.0.0.5/push");
    const res = await c.call("/api/push/subscriptions", { method: "POST", body: browser.json });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/known browser push service/);
    const good = await fakeBrowser();
    const badKeys = await c.call("/api/push/subscriptions", { method: "POST", body: { ...good.json, keys: { p256dh: "x", auth: good.json.keys.auth } } });
    expect(badKeys.status).toBe(400);
    expect((await c.json("/api/push")).devices).toEqual([]);
  });

  it(`caps subscriptions at ${MAX_PUSH_DEVICES} devices`, async () => {
    const c = await loggedIn();
    for (let i = 0; i < MAX_PUSH_DEVICES; i++) {
      const res = await c.call("/api/push/subscriptions", { method: "POST", body: (await fakeBrowser()).json });
      expect(res.status).toBe(200);
    }
    const over = await c.call("/api/push/subscriptions", { method: "POST", body: (await fakeBrowser()).json });
    expect(over.status).toBe(400);
    expect((await c.json("/api/push")).devices).toHaveLength(MAX_PUSH_DEVICES);
  });

  it("notes when a device opens the app, and tells a browser whose device is gone", async () => {
    const c = await loggedIn();
    const browser = await fakeBrowser();
    const { device } = await c.json("/api/push/subscriptions", { method: "POST", body: browser.json });
    expect(Date.now() - Date.parse(device.last_seen_at)).toBeLessThan(60_000);
    const old = new Date(Date.now() - 2 * 86_400_000).toISOString();
    await inAgent((agent) => agent.services.db.run(`UPDATE tal_push_subscriptions SET last_seen_at = ?`, old));
    expect(await c.json("/api/push/seen", { method: "POST", body: { endpoint: browser.endpoint } })).toEqual({ known: true });
    const [seen] = (await c.json("/api/push")).devices;
    expect(seen.last_seen_at > old).toBe(true);
    // Renewing the subscription counts too.
    await inAgent((agent) => agent.services.db.run(`UPDATE tal_push_subscriptions SET last_seen_at = ?`, old));
    const renewed = await c.json("/api/push/subscriptions", { method: "POST", body: browser.json });
    expect(renewed.device.last_seen_at > old).toBe(true);

    expect(await c.json("/api/push/seen", { method: "POST", body: { endpoint: "https://fcm.googleapis.com/fcm/send/unknown" } })).toEqual({ known: false });
    expect((await c.call("/api/push/seen", { method: "POST", body: { endpoint: "not a url" } })).status).toBe(400);
    expect((await client().call("/api/push/seen", { method: "POST", body: { endpoint: browser.endpoint } })).status).toBe(401);
  });

  it("moves a device to the endpoint its browser rotated to, without the password and without extending it", async () => {
    const c = await loggedIn();
    const old = await fakeBrowser();
    const { device } = await c.json("/api/push/subscriptions", { method: "POST", body: { ...old.json, label: "Phone" } });
    const seen = "2026-10-01T00:00:00.000Z";
    await inAgent((agent) => {
      agent.services.db.run(`UPDATE tal_push_subscriptions SET last_seen_at = ?, failures = 2`, seen);
      agent.services.db.run(`UPDATE tal_sessions SET confirmed_at = '2000-01-01T00:00:00.000Z'`);
      agent.services.db.run(`DELETE FROM tal_notifications`);
    });
    const rotated = await fakeBrowser();
    const moved = await c.json("/api/push/subscriptions", { method: "POST", body: { ...rotated.json, replaces: old.endpoint } });
    expect(moved.device).toMatchObject({ id: device.id, label: "Phone", last_seen_at: seen, failures: 0 });
    expect(moved.status.devices).toHaveLength(1);
    await inAgent((agent) => {
      expect(agent.services.push.subscriptions.hasEndpoint(rotated.endpoint)).toBe(true);
      expect(agent.services.push.subscriptions.hasEndpoint(old.endpoint)).toBe(false);
      expect(agent.services.notifications.list({ limit: 10 }).map((n) => n.title)).not.toContain("New push device");
    });
    // An endpoint that is not registered is no key: that is a new device, which needs the password.
    const stranger = await c.call("/api/push/subscriptions", { method: "POST", body: { ...(await fakeBrowser()).json, replaces: old.endpoint } });
    expect(stranger.status).toBe(403);
    expect(((await stranger.json()) as { error: { code: string } }).error.code).toBe("REAUTH_REQUIRED");
    expect((await c.json("/api/push")).devices).toHaveLength(1);
  });

  it("never puts push subscriptions in a backup", async () => {
    const c = await loggedIn();
    const browser = await fakeBrowser();
    await c.json("/api/push/subscriptions", { method: "POST", body: browser.json });
    const backup = await (await c.call("/api/export")).text();
    expect(backup).not.toContain(browser.endpoint);
    expect(backup).not.toContain(browser.json.keys.auth);
  });

  it("labels devices from the user agent", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0")).toBe("Edge on Windows");
    expect(deviceLabel("")).toBe("Browser");
  });
});
