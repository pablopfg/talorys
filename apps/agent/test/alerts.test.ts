import { DEFAULT_ALERT_PREFERENCES, type Notification } from "@talorys/shared";
import { beforeEach, describe, expect, it } from "vitest";
import type { TalorysAgent } from "../src/agent/talorys-agent";
import { AlertDeliveryRepository, DELIVERY_RETENTION_DAYS, PENDING_TIMEOUT_MS } from "../src/alerts/repository";
import { type AlertChannelAdapter, AlertService } from "../src/alerts/service";
import { b64url } from "../src/push/encoding";
import { isRemoteAllowed } from "../src/remote/allowlist";
import { inAgent, loggedIn } from "./helpers";
import { fakeBrowser, pushServiceStub } from "./push-helpers";

beforeEach(async () => {
  await inAgent((agent) => {
    const db = agent.services.db;
    db.run(`DELETE FROM tal_notifications`);
    db.run(`DELETE FROM tal_alert_deliveries`);
    db.run(`DELETE FROM tal_alert_profiles`);
    db.run(`DELETE FROM tal_alert_corrections`);
    db.run(`DELETE FROM tal_push_subscriptions`);
    agent.services.settings.delete("alerts.preferences");
  });
});

/** A channel that records what it was asked to send and reports `reached` (or throws). */
function fakeChannel(opts: { reached?: number; unavailable?: "not_configured" | "no_device" | null; throws?: boolean } = {}) {
  const sent: Notification[] = [];
  const channel: AlertChannelAdapter = {
    id: "push",
    unavailable: () => opts.unavailable ?? null,
    send: (n, done) => {
      if (opts.throws) throw new Error("channel exploded");
      sent.push(n);
      done(opts.reached ?? 1);
    },
  };
  return { channel, sent };
}

function service(agent: TalorysAgent, channel: AlertChannelAdapter) {
  const s = agent.services;
  return { alerts: new AlertService(s.notifications, new AlertDeliveryRepository(s.db), s.settings, { push: channel }), deliveries: new AlertDeliveryRepository(s.db) };
}

describe("alert center", () => {
  it("stores the alert with its priority and category and sends it to the category's channels", async () => {
    await inAgent((agent) => {
      const fake = fakeChannel({ reached: 2 });
      const { alerts, deliveries } = service(agent, fake.channel);
      const n = alerts.raise({ title: "Pay rent", body: "Today", category: "reminder", priority: "high" })!;
      expect(n).toMatchObject({ title: "Pay rent", priority: "high", category: "reminder", read_at: null });
      expect(agent.services.notifications.list()[0]).toMatchObject({ id: n.id, priority: "high", category: "reminder" });
      expect(agent.services.notifications.list()[0]).not.toHaveProperty("dedupe_key");
      expect(fake.sent.map((x) => x.id)).toEqual([n.id]);
      expect(deliveries.list()).toEqual([
        expect.objectContaining({ notification_id: n.id, title: "Pay rent", channel: "push", priority: "high", category: "reminder", status: "sent", reason: null, reached: 2 }),
      ]);
    });
  });

  it("defaults to normal priority", async () => {
    await inAgent((agent) => {
      const { alerts } = service(agent, fakeChannel().channel);
      expect(alerts.raise({ title: "t", body: "b", category: "system" })!.priority).toBe("normal");
    });
  });

  it("keeps low-priority alerts in the app only", async () => {
    await inAgent((agent) => {
      const fake = fakeChannel();
      const { alerts, deliveries } = service(agent, fake.channel);
      alerts.raise({ title: "Update available", body: "b", category: "system", priority: "low" });
      expect(fake.sent).toEqual([]);
      expect(deliveries.list()[0]).toMatchObject({ status: "skipped", reason: "low_priority" });
      expect(agent.services.notifications.unreadCount()).toBe(1);
    });
  });

  it("drops a repeat of the same key within its cooldown, and raises it again after", async () => {
    await inAgent((agent) => {
      const fake = fakeChannel();
      const { alerts } = service(agent, fake.channel);
      const first = alerts.raise({ title: "Overdue", body: "b", category: "task", dedupeKey: "task-overdue:1", cooldownMinutes: 60 });
      expect(first).not.toBeNull();
      expect(alerts.raise({ title: "Overdue", body: "b", category: "task", dedupeKey: "task-overdue:1", cooldownMinutes: 60 })).toBeNull();
      // Another key is a different alert.
      expect(alerts.raise({ title: "Overdue", body: "b", category: "task", dedupeKey: "task-overdue:2", cooldownMinutes: 60 })).not.toBeNull();
      agent.services.db.run(`UPDATE tal_notifications SET created_at = ? WHERE id = ?`, new Date(Date.now() - 61 * 60_000).toISOString(), first!.id);
      expect(alerts.raise({ title: "Overdue", body: "b", category: "task", dedupeKey: "task-overdue:1", cooldownMinutes: 60 })).not.toBeNull();
      expect(fake.sent).toHaveLength(3);
    });
  });

  it("uses a 6-hour cooldown by default", async () => {
    await inAgent((agent) => {
      const { alerts } = service(agent, fakeChannel().channel);
      const first = alerts.raise({ title: "x", body: "b", category: "system", dedupeKey: "k" })!;
      agent.services.db.run(`UPDATE tal_notifications SET created_at = ? WHERE id = ?`, new Date(Date.now() - 5 * 3600_000).toISOString(), first.id);
      expect(alerts.raise({ title: "x", body: "b", category: "system", dedupeKey: "k" })).toBeNull();
      agent.services.db.run(`UPDATE tal_notifications SET created_at = ? WHERE id = ?`, new Date(Date.now() - 6 * 3600_000 - 1000).toISOString(), first.id);
      expect(alerts.raise({ title: "x", body: "b", category: "system", dedupeKey: "k" })).not.toBeNull();
    });
  });

  it("sends nothing outside the app for a category routed to no channel", async () => {
    await inAgent((agent) => {
      const fake = fakeChannel();
      const { alerts, deliveries } = service(agent, fake.channel);
      alerts.updatePreferences({ ...DEFAULT_ALERT_PREFERENCES, routes: { ...DEFAULT_ALERT_PREFERENCES.routes, digest: [] } });
      alerts.raise({ title: "Digest", body: "b", category: "digest" });
      expect(fake.sent).toEqual([]);
      expect(deliveries.list()).toEqual([]);
      expect(agent.services.notifications.unreadCount()).toBe(1);
    });
  });

  it("holds back normal alerts over the hourly limit, but never a critical one", async () => {
    await inAgent((agent) => {
      const fake = fakeChannel();
      const { alerts, deliveries } = service(agent, fake.channel);
      alerts.updatePreferences({ ...DEFAULT_ALERT_PREFERENCES, limits: { perHour: 2, perDay: 30 } });
      for (let i = 0; i < 3; i++) alerts.raise({ title: `n${i}`, body: "b", category: "routine" });
      alerts.raise({ title: "New sign-in", body: "b", category: "security", priority: "critical" });
      expect(fake.sent.map((n) => n.title)).toEqual(["n0", "n1", "New sign-in"]);
      expect(deliveries.list().find((d) => d.title === "n2")).toMatchObject({ status: "skipped", reason: "rate_limited" });
      // A critical send doesn't use up the room of the others: after an hour they flow again.
      agent.services.db.run(`UPDATE tal_alert_deliveries SET created_at = ?`, new Date(Date.now() - 3601_000).toISOString());
      alerts.raise({ title: "n3", body: "b", category: "routine" });
      expect(fake.sent.at(-1)!.title).toBe("n3");
    });
  });

  it("holds back alerts over the daily limit", async () => {
    await inAgent((agent) => {
      const fake = fakeChannel();
      const { alerts, deliveries } = service(agent, fake.channel);
      alerts.updatePreferences({ ...DEFAULT_ALERT_PREFERENCES, limits: { perHour: 60, perDay: 2 } });
      alerts.raise({ title: "a", body: "b", category: "routine" });
      alerts.raise({ title: "b", body: "b", category: "routine" });
      // Older than an hour but within the day: still counts for the daily cap.
      agent.services.db.run(`UPDATE tal_alert_deliveries SET created_at = ?`, new Date(Date.now() - 2 * 3600_000).toISOString());
      alerts.raise({ title: "c", body: "b", category: "routine" });
      expect(fake.sent.map((n) => n.title)).toEqual(["a", "b"]);
      expect(deliveries.list()[0]).toMatchObject({ title: "c", reason: "rate_limited" });
    });
  });

  it("never holds back reminders, and doesn't count them against the limit", async () => {
    await inAgent((agent) => {
      const fake = fakeChannel();
      const { alerts } = service(agent, fake.channel);
      alerts.updatePreferences({ ...DEFAULT_ALERT_PREFERENCES, limits: { perHour: 1, perDay: 1 } });
      for (let i = 0; i < 3; i++) alerts.raise({ title: `r${i}`, body: "b", category: "reminder" });
      alerts.raise({ title: "routine", body: "b", category: "routine" });
      alerts.raise({ title: "routine 2", body: "b", category: "routine" });
      expect(fake.sent.map((n) => n.title)).toEqual(["r0", "r1", "r2", "routine"]);
    });
  });

  it("always sends security and critical alerts to every channel, whatever the routes say", async () => {
    await inAgent((agent) => {
      const fake = fakeChannel();
      const { alerts } = service(agent, fake.channel);
      alerts.updatePreferences({
        ...DEFAULT_ALERT_PREFERENCES,
        routes: { ...DEFAULT_ALERT_PREFERENCES.routes, security: [], system: [] },
      });
      alerts.raise({ title: "Two-step sign-in off", body: "b", category: "security", priority: "critical" });
      alerts.raise({ title: "Security, normal", body: "b", category: "security" });
      alerts.raise({ title: "System, critical", body: "b", category: "system", priority: "critical" });
      alerts.raise({ title: "System, normal", body: "b", category: "system" });
      expect(fake.sent.map((n) => n.title)).toEqual(["Two-step sign-in off", "Security, normal", "System, critical"]);
    });
  });

  it("marks a send that never reported back as failed, and stops counting it", async () => {
    await inAgent((agent) => {
      const s = agent.services;
      const deliveries = new AlertDeliveryRepository(s.db);
      const silent: AlertChannelAdapter = { id: "push", unavailable: () => null, send: () => {} };
      const alerts = new AlertService(s.notifications, deliveries, s.settings, { push: silent });
      alerts.raise({ title: "lost", body: "b", category: "routine" });
      expect(deliveries.list()[0]).toMatchObject({ status: "pending" });
      expect(deliveries.sentSince("push", new Date(Date.now() - 3600_000).toISOString())).toBe(1);
      s.db.run(`UPDATE tal_alert_deliveries SET created_at = ?`, new Date(Date.now() - PENDING_TIMEOUT_MS - 1000).toISOString());
      expect(deliveries.list()[0]).toMatchObject({ status: "failed", reason: "unreachable" });
      expect(deliveries.sentSince("push", new Date(Date.now() - 3600_000).toISOString())).toBe(0);
    });
  });

  it("records why a channel could not send", async () => {
    await inAgent((agent) => {
      const { alerts, deliveries } = service(agent, fakeChannel({ unavailable: "no_device" }).channel);
      alerts.raise({ title: "t", body: "b", category: "reminder" });
      expect(deliveries.list()[0]).toMatchObject({ status: "skipped", reason: "no_device" });
      const other = service(agent, fakeChannel({ unavailable: "not_configured" }).channel);
      other.alerts.raise({ title: "t2", body: "b", category: "reminder" });
      expect(deliveries.list()[0]).toMatchObject({ status: "skipped", reason: "not_configured" });
    });
  });

  it("marks a send that reached nobody as failed", async () => {
    await inAgent((agent) => {
      const { alerts, deliveries } = service(agent, fakeChannel({ reached: 0 }).channel);
      alerts.raise({ title: "t", body: "b", category: "reminder" });
      expect(deliveries.list()[0]).toMatchObject({ status: "failed", reason: "unreachable", reached: 0 });
    });
  });

  it("still stores the alert when a channel throws", async () => {
    await inAgent((agent) => {
      const { alerts } = service(agent, fakeChannel({ throws: true }).channel);
      const n = alerts.raise({ title: "t", body: "b", category: "reminder" });
      expect(n).not.toBeNull();
      expect(agent.services.notifications.get(n!.id)).not.toBeNull();
    });
  });

  it("keeps the delivery history within its retention", async () => {
    await inAgent((agent) => {
      const { alerts, deliveries } = service(agent, fakeChannel().channel);
      alerts.raise({ title: "old", body: "b", category: "reminder" });
      agent.services.db.run(`UPDATE tal_alert_deliveries SET created_at = ?`, new Date(Date.now() - (DELIVERY_RETENTION_DAYS + 1) * 86_400_000).toISOString());
      alerts.raise({ title: "new", body: "b", category: "reminder" });
      expect(deliveries.list().map((d) => d.title)).toEqual(["new"]);
    });
  });
});

describe("alert preferences", () => {
  it("start with every category on push and 6 per hour, 30 per day", async () => {
    await inAgent((agent) => {
      expect(agent.services.alerts.preferences()).toEqual(DEFAULT_ALERT_PREFERENCES);
      expect(DEFAULT_ALERT_PREFERENCES.limits).toEqual({ perHour: 6, perDay: 30 });
    });
  });

  it("fill in categories missing from older stored preferences, and survive a corrupt record", async () => {
    await inAgent((agent) => {
      const s = agent.services;
      s.settings.setJson("alerts.preferences", { routes: { reminder: [] }, limits: { perHour: 3 } });
      expect(s.alerts.preferences()).toEqual({
        routes: { ...DEFAULT_ALERT_PREFERENCES.routes, reminder: [] },
        limits: { perHour: 3, perDay: 30 },
        fullText: [],
        digest: { enabled: true, time: "07:30" },
        watchers: true,
      });
      s.settings.setJson("alerts.preferences", { routes: { reminder: ["fax"] }, limits: { perHour: -1 } });
      expect(s.alerts.preferences()).toEqual(DEFAULT_ALERT_PREFERENCES);
    });
  });

  it("drop a channel listed twice", async () => {
    await inAgent((agent) => {
      const prefs = agent.services.alerts.updatePreferences({
        ...DEFAULT_ALERT_PREFERENCES,
        routes: { ...DEFAULT_ALERT_PREFERENCES.routes, reminder: ["push", "push"] },
      });
      expect(prefs.routes.reminder).toEqual(["push"]);
    });
  });
});

describe("alert API", () => {
  it("shows preferences, channels and the delivery history", async () => {
    const c = await loggedIn();
    await inAgent((agent) => agent.services.alerts.raise({ title: "Stretch", body: "b", category: "reminder" }));
    const res = await c.json("/api/alerts");
    expect(res.preferences).toEqual(DEFAULT_ALERT_PREFERENCES);
    // E-mail needs the send_email binding, which this deployment doesn't have.
    expect(res.channels).toEqual({ push: { available: true }, telegram: { available: true }, email: { available: false } });
    expect(res.email).toEqual({ to: null, sentToday: 0 });
    // No device subscribed and no Telegram chat linked in this test.
    for (const channel of ["push", "telegram"]) {
      expect(res.deliveries.find((d: { channel: string }) => d.channel === channel)).toMatchObject({ title: "Stretch", status: "skipped", reason: "no_device" });
    }
  });

  it("saves valid preferences and refuses invalid ones", async () => {
    const c = await loggedIn();
    const next = { routes: { ...DEFAULT_ALERT_PREFERENCES.routes, system: [] }, limits: { perHour: 10, perDay: 100 }, fullText: ["reminder"] };
    const saved = await c.json("/api/alerts/preferences", { method: "PUT", body: next });
    // Saved before the summary and the watchers existed: both come on with their defaults.
    const withDefaults = { ...next, digest: { enabled: true, time: "07:30" }, watchers: true };
    expect(saved.preferences).toEqual(withDefaults);
    expect((await c.json("/api/alerts")).preferences).toEqual(withDefaults);
    for (const bad of [
      { ...next, limits: { perHour: 0, perDay: 100 } },
      { ...next, limits: { perHour: 10, perDay: 501 } },
      { ...next, routes: { ...next.routes, system: ["sms"] } },
      { ...next, fullText: ["fax"] },
      { limits: next.limits },
    ]) {
      const res = await c.call("/api/alerts/preferences", { method: "PUT", body: bad });
      expect(res.status).toBe(400);
    }
    expect((await c.json("/api/alerts")).preferences).toEqual(withDefaults);
  });

  it("changes a notification's priority", async () => {
    const c = await loggedIn();
    const n = await inAgent((agent) => agent.services.alerts.raise({ title: "t", body: "b", category: "reminder" })!);
    const res = await c.json(`/api/notifications/${n.id}`, { method: "PATCH", body: { priority: "high" } });
    expect(res.notification).toMatchObject({ id: n.id, priority: "high" });
    expect((await c.json("/api/notifications")).notifications[0]).toMatchObject({ id: n.id, priority: "high", category: "reminder" });
    expect((await c.call(`/api/notifications/${n.id}`, { method: "PATCH", body: { priority: "urgent" } })).status).toBe(400);
    expect((await c.call("/api/notifications/missing", { method: "PATCH", body: { priority: "low" } })).status).toBe(404);
  });

  it("is only for the signed-in owner", async () => {
    const res = await (await import("./helpers")).client().call("/api/alerts");
    expect(res.status).toBe(401);
    for (const [method, path] of [["GET", "/api/alerts"], ["PUT", "/api/alerts/preferences"], ["PATCH", "/api/notifications/0b6f6f7e-1c2d-4e5f-8a9b-0c1d2e3f4a5b"]] as const) {
      expect(isRemoteAllowed(method, path), `${method} ${path}`).toBe(false);
    }
  });
});

describe("alerts raised by the app", () => {
  it("sends a reminder through push as a normal reminder alert, and records it", async () => {
    await inAgent(async (agent) => {
      const s = agent.services;
      const browser = await fakeBrowser();
      s.push.subscriptions.save({ endpoint: browser.endpoint, p256dh: b64url(browser.p256dh), auth: b64url(browser.auth), label: "Test", origin: "https://me.pages.dev" });
      const stub = pushServiceStub(201);
      s.push.fetcher = stub.fetcher;
      const a = await s.automations.create({ name: "Stretch", kind: "reminder", message: "Time to stretch", schedule: { type: "interval", minutes: 15 }, enabled: true });
      await agent.runAutomation({ automationId: a.id }, { id: a.schedule_id! });
      await s.push.idle();
      expect(s.notifications.list({ limit: 1 })[0]).toMatchObject({ body: "Time to stretch", category: "reminder", priority: "normal", automation_id: a.id });
      expect(stub.sent).toHaveLength(1);
      expect(s.alerts.overview().deliveries.find((d) => d.channel === "push")).toMatchObject({ status: "sent", reached: 1, category: "reminder" });
      await s.automations.delete(a.id);
    });
  });

  it("raises account alerts as critical security alerts", async () => {
    await inAgent((agent) => {
      // The auth service's owner alert, e.g. after many failed sign-ins.
      (agent.services.auth as unknown as { alert: (t: string, b: string) => void }).alert("Many failed sign-ins", "b");
      expect(agent.services.notifications.list({ limit: 1 })[0]).toMatchObject({ title: "Many failed sign-ins", category: "security", priority: "critical" });
    });
  });
});
