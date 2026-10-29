import { ESCALATION, type Notification } from "@talorys/shared";
import { beforeEach, describe, expect, it } from "vitest";
import type { TalorysAgent } from "../src/agent/talorys-agent";
import { AlertDeliveryRepository } from "../src/alerts/repository";
import { type AlertAttempt, type AlertChannelAdapter, AlertService } from "../src/alerts/service";
import { b64url } from "../src/push/encoding";
import { isRemoteAllowed } from "../src/remote/allowlist";
import { inAgent, loggedIn } from "./helpers";
import { decryptAsBrowser, fakeBrowser, pushServiceStub } from "./push-helpers";

const MIN = 60_000;

beforeEach(async () => {
  await inAgent((agent) => {
    const db = agent.services.db;
    db.run(`DELETE FROM tal_notifications`);
    db.run(`DELETE FROM tal_alert_deliveries`);
    db.run(`DELETE FROM tal_alert_profiles`);
    db.run(`DELETE FROM tal_alert_corrections`);
    db.run(`DELETE FROM tal_push_subscriptions`);
    db.run(`DELETE FROM tal_activity`);
    agent.services.settings.delete("alerts.preferences");
  });
});

/** A channel that records each send with its try, and timers that record each alarm. */
function harness(agent: TalorysAgent, opts: { unavailable?: "no_device" | null } = {}) {
  const sent: { n: Notification; attempt?: AlertAttempt }[] = [];
  const alarms: { at: Date; id: string; step: number }[] = [];
  const channel: AlertChannelAdapter = {
    id: "push",
    unavailable: () => opts.unavailable ?? null,
    send: (n, done, attempt) => {
      sent.push({ n, attempt });
      done(1);
    },
  };
  const s = agent.services;
  const alerts = new AlertService(s.notifications, new AlertDeliveryRepository(s.db), s.settings, { push: channel }, {
    timers: { schedule: (at, id, step) => alarms.push({ at, id, step }) },
    automations: s.automations,
    activity: s.activity,
  });
  return { alerts, sent, alarms, deliveries: new AlertDeliveryRepository(s.db) };
}

/** Moves an alert's first send `minutes` into the past, and its next step to when it is due. */
function age(agent: TalorysAgent, id: string, minutes: number) {
  const n = agent.services.notifications.get(id)!;
  const shift = (iso: string | null) => (iso ? new Date(Date.parse(iso) - minutes * MIN).toISOString() : null);
  agent.services.db.run(`UPDATE tal_notifications SET created_at = ?, next_attempt_at = ? WHERE id = ?`, shift(n.created_at), shift(n.next_attempt_at), id);
}

describe("insistent alerts", () => {
  it("insist only when high or critical and sent outside the app", async () => {
    await inAgent((agent) => {
      const { alerts, alarms } = harness(agent);
      const normal = alerts.raise({ title: "FYI", body: "b", category: "system" })!;
      expect(normal).toMatchObject({ escalation: null, attempts: 1, next_attempt_at: null });
      const high = alerts.raise({ title: "Take the pill", body: "b", category: "reminder", priority: "high" })!;
      expect(high.escalation).toBe("active");
      expect(high.attempts).toBe(1);
      expect(Date.parse(high.next_attempt_at!) - Date.parse(high.created_at)).toBe(ESCALATION.afterMinutes[0] * MIN);
      expect(alarms).toEqual([{ at: new Date(high.next_attempt_at!), id: high.id, step: 2 }]);
      // Routed to no channel: nobody to insist with.
      agent.services.settings.setJson("alerts.preferences", { routes: { task: [] }, limits: { perHour: 6, perDay: 30 }, fullText: [] });
      expect(alerts.raise({ title: "Quiet", body: "b", category: "task", priority: "high" })!.escalation).toBeNull();
      // No channel can send right now (no device): nothing insists either.
      const offline = harness(agent, { unavailable: "no_device" });
      expect(offline.alerts.raise({ title: "Offline", body: "b", category: "reminder", priority: "high" })!.escalation).toBeNull();
    });
  });

  it("sends try 2 after 15 minutes, try 3 to the private chat after 1 hour, then records it as not confirmed", async () => {
    await inAgent((agent) => {
      const { alerts, sent, alarms, deliveries } = harness(agent);
      const n = alerts.raise({ title: "Take the pill", body: "b", category: "reminder", priority: "high" })!;
      expect(sent.map((x) => x.attempt)).toEqual([undefined]);

      age(agent, n.id, 15);
      alerts.escalate(n.id);
      expect(sent.map((x) => x.attempt)).toEqual([undefined, { number: 2, direct: false }]);
      let now = agent.services.notifications.get(n.id)!;
      expect(now).toMatchObject({ escalation: "active", attempts: 2 });
      expect(Date.parse(now.next_attempt_at!) - Date.parse(now.created_at)).toBe(ESCALATION.afterMinutes[1] * MIN);
      expect(alarms.at(-1)).toEqual({ at: new Date(now.next_attempt_at!), id: n.id, step: 3 });
      expect(deliveries.list()[0]).toMatchObject({ title: "Take the pill (2/3)", status: "sent" });

      age(agent, n.id, 45);
      alerts.escalate(n.id);
      expect(sent.at(-1)!.attempt).toEqual({ number: 3, direct: true });
      now = agent.services.notifications.get(n.id)!;
      expect(now).toMatchObject({ escalation: "active", attempts: 3 });
      expect(Date.parse(now.next_attempt_at!) - Date.parse(now.created_at)).toBe(ESCALATION.giveUpAfterMinutes * MIN);

      age(agent, n.id, 15);
      alerts.escalate(n.id);
      expect(sent).toHaveLength(3);
      expect(agent.services.notifications.get(n.id)).toMatchObject({ escalation: "unacknowledged", attempts: 3, next_attempt_at: null });
      expect(agent.services.activity.list(5)[0]!.summary).toBe("Alert not confirmed after 3 tries: “Take the pill”");
      // A stale alarm after that does nothing.
      alerts.escalate(n.id);
      expect(sent).toHaveLength(3);
    });
  });

  it("waits when an alarm comes early, and never sends a try twice", async () => {
    await inAgent((agent) => {
      const { alerts, sent, alarms } = harness(agent);
      const n = alerts.raise({ title: "Early", body: "b", category: "reminder", priority: "critical" })!;
      alerts.escalate(n.id);
      expect(sent).toHaveLength(1);
      expect(alarms).toHaveLength(2);
      expect(alarms[1]).toEqual(alarms[0]);
      age(agent, n.id, 15);
      alerts.escalate(n.id);
      alerts.escalate(n.id);
      expect(sent).toHaveLength(2);
    });
  });

  it("stops when the alert is read, muted, deleted or no longer high", async () => {
    await inAgent(async (agent) => {
      const { alerts, sent } = harness(agent);
      const s = agent.services;
      const raise = () => {
        const n = alerts.raise({ title: "Stop me", body: "b", category: "reminder", priority: "high" })!;
        age(agent, n.id, 15);
        return n;
      };
      const read = raise();
      s.notifications.markRead(read.id);
      expect(s.notifications.get(read.id)).toMatchObject({ escalation: "acknowledged", next_attempt_at: null });
      alerts.escalate(read.id);

      const muted = raise();
      expect(await alerts.respond(muted.id, "mute")).toBe("muted");
      expect(await alerts.respond(muted.id, "mute")).toBe("already");
      expect(s.notifications.get(muted.id)).toMatchObject({ escalation: "muted", read_at: null });
      alerts.escalate(muted.id);

      const lowered = raise();
      expect(alerts.setPriority(lowered.id, "normal")).toMatchObject({ escalation: null, next_attempt_at: null });
      alerts.escalate(lowered.id);

      const deleted = raise();
      s.notifications.delete(deleted.id);
      alerts.escalate(deleted.id);

      const all = raise();
      s.notifications.markRead();
      expect(s.notifications.get(all.id)!.escalation).toBe("acknowledged");
      alerts.escalate(all.id);

      expect(sent.every((x) => x.attempt === undefined)).toBe(true);
    });
  });

  it("keep a security alert insisting until Telegram confirms it, whatever is done in the app", async () => {
    await inAgent(async (agent) => {
      const { alerts, sent } = harness(agent);
      const s = agent.services;
      const n = alerts.raise({ title: "New sign-in", body: "b", category: "security", priority: "critical" })!;
      s.notifications.markRead();
      s.notifications.markRead(n.id);
      expect(s.notifications.get(n.id)!.escalation).toBe("active");
      // Security alerts are always critical: lowering one is refused, and it keeps insisting.
      expect(() => alerts.setPriority(n.id, "low")).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
      expect(s.notifications.get(n.id)).toMatchObject({ priority: "critical", escalation: "active" });
      await expect(alerts.respond(n.id, "mute")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(await alerts.respond(n.id, "done")).toBe("already");
      expect(() => alerts.delete(n.id)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
      age(agent, n.id, 15);
      alerts.escalate(n.id);
      expect(sent.at(-1)!.attempt).toEqual({ number: 2, direct: false });
      // Telegram's Done confirms it, even though it was already read in the app.
      expect(await alerts.respond(n.id, "done", { outOfBand: true })).toBe("done");
      expect(s.notifications.get(n.id)!.escalation).toBe("acknowledged");
      alerts.delete(n.id);
      // A message in the bot's chat confirms security alerts too.
      const other = alerts.raise({ title: "Two-step sign-in turned off", body: "b", category: "security", priority: "critical" })!;
      expect(alerts.acknowledgeAll()).toBe(true);
      expect(s.notifications.get(other.id)!.escalation).toBe("acknowledged");
    });
  });

  it("insist on at most 20 alerts at once, security alerts aside", async () => {
    await inAgent((agent) => {
      const { alerts } = harness(agent);
      for (let i = 0; i < 20; i++) expect(alerts.raise({ title: `High ${i}`, body: "b", category: "reminder", priority: "high" })!.escalation).toBe("active");
      expect(alerts.raise({ title: "One too many", body: "b", category: "reminder", priority: "high" })!.escalation).toBeNull();
      expect(alerts.raise({ title: "New sign-in", body: "b", category: "security", priority: "critical" })!.escalation).toBe("active");
    });
  });

  it("sends later tries even over the channel limits", async () => {
    await inAgent((agent) => {
      const { alerts, sent } = harness(agent);
      agent.services.settings.setJson("alerts.preferences", { routes: {}, limits: { perHour: 1, perDay: 1 }, fullText: [] });
      const n = alerts.raise({ title: "Insist", body: "b", category: "task", priority: "high" })!;
      alerts.raise({ title: "Busy", body: "b", category: "system" });
      age(agent, n.id, 15);
      alerts.escalate(n.id);
      expect(sent.map((x) => x.n.title)).toEqual(["Insist", "Insist"]);
    });
  });

  it("recovers tries whose alarm was lost, one step at a time", async () => {
    await inAgent((agent) => {
      const { alerts, sent } = harness(agent);
      const n = alerts.raise({ title: "Lost alarm", body: "b", category: "reminder", priority: "high" })!;
      expect(alerts.reconcile()).toBe(0);
      // A long outage: every step is overdue, but only the next one goes out.
      age(agent, n.id, 120);
      expect(alerts.reconcile()).toBe(1);
      expect(sent).toHaveLength(2);
      expect(agent.services.notifications.get(n.id)!.attempts).toBe(2);
    });
  });
});

describe("answering an alert", () => {
  it("marks it done, snoozes it into a reminder an hour later, and does nothing twice", async () => {
    await inAgent(async (agent) => {
      const { alerts } = harness(agent);
      const s = agent.services;
      const done = alerts.raise({ title: "Done one", body: "secret body", category: "task", priority: "high" })!;
      expect(await alerts.respond(done.id, "done")).toBe("done");
      expect(s.notifications.get(done.id)).toMatchObject({ escalation: "acknowledged" });
      expect(s.notifications.get(done.id)!.read_at).not.toBeNull();
      expect(await alerts.respond(done.id, "done")).toBe("already");
      expect(await alerts.respond(done.id, "snooze")).toBe("already");

      const snoozed = alerts.raise({ title: "Snooze one", body: "secret body", category: "task", priority: "high" })!;
      expect(await alerts.respond(snoozed.id, "snooze")).toBe("snoozed");
      const reminder = s.automations.list().find((a) => a.name === "Snooze one")!;
      // The task category is discreet: the reminder keeps the text in the notification center.
      expect(reminder).toMatchObject({ kind: "reminder", priority: "high", message: "Snoozed alert. Its full text is in the notification center." });
      expect(Date.parse(reminder.next_run!) - Date.now()).toBeGreaterThan(59 * MIN);
      await s.automations.delete(reminder.id);

      await expect(alerts.respond("missing", "done")).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  it("works from the API for the owner only", async () => {
    const c = await loggedIn();
    const id = await inAgent((agent) => agent.services.alerts.raise({ title: "API", body: "b", category: "system", priority: "high" })!.id);
    const bad = await c.call(`/api/notifications/${id}/action`, { method: "POST", body: { action: "delete" } });
    expect(bad.status).toBe(400);
    const res = await c.call(`/api/notifications/${id}/action`, { method: "POST", body: { action: "done" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ result: "done", notification: { id, escalation: null }, unread: 0 });
    const again = await c.call(`/api/notifications/${id}/action`, { method: "POST", body: { action: "done" } });
    expect(await again.json()).toMatchObject({ result: "already" });
    const missing = await c.call(`/api/notifications/nope/action`, { method: "POST", body: { action: "done" } });
    expect(missing.status).toBe(404);
    // An insistent security alert can't be deleted or muted from the app.
    const security = await inAgent((agent) => {
      const n = agent.services.notifications.create({ title: "New sign-in", body: "b", category: "security", priority: "critical" });
      agent.services.notifications.setEscalation(n.id, "active", 1, new Date(Date.now() + 15 * MIN).toISOString());
      return n.id;
    });
    expect((await c.call(`/api/notifications/${security}`, { method: "DELETE" })).status).toBe(409);
    expect((await c.call(`/api/notifications/${security}/action`, { method: "POST", body: { action: "mute" } })).status).toBe(400);
    await inAgent((agent) => agent.services.notifications.delete(security));
    expect(isRemoteAllowed("POST", `/api/notifications/${id}/action`)).toBe(false);
  });
});

describe("insistent reminders end to end", () => {
  it("push carries the buttons and the try, and the alarm sends the next try", async () => {
    await inAgent(async (agent) => {
      const s = agent.services;
      const browser = await fakeBrowser();
      s.push.subscriptions.save({ endpoint: browser.endpoint, p256dh: b64url(browser.p256dh), auth: b64url(browser.auth), label: "Test", origin: "https://me.pages.dev" });
      const stub = pushServiceStub(201);
      s.push.fetcher = stub.fetcher;
      const a = await s.automations.create({ name: "Pill", kind: "reminder", message: "Take the pill", schedule: { type: "interval", minutes: 60 }, enabled: true, priority: "high" });
      expect(a.priority).toBe("high");
      await agent.runAutomationNow(a.id);
      await s.push.idle();
      const n = s.notifications.list({ limit: 1 })[0]!;
      expect(n).toMatchObject({ priority: "high", category: "reminder", escalation: "active", attempts: 1 });
      expect(await decryptAsBrowser(stub.sent[0]!.body, browser)).toEqual({
        title: "Reminder",
        body: "Take the pill",
        id: n.id,
        url: "/",
        sticky: true,
        actions: [
          { action: "done", title: "Done" },
          { action: "snooze", title: "Snooze 1 h" },
          { action: "mute", title: "Mute this alert" },
        ],
      });
      age(agent, n.id, 15);
      await agent.escalateAlert({ notificationId: n.id });
      await s.push.idle();
      expect(stub.sent).toHaveLength(2);
      expect(await decryptAsBrowser(stub.sent[1]!.body, browser)).toMatchObject({ title: "Reminder (2/3)", id: n.id });
      // A security alert stays on screen but has no buttons: only Telegram confirms it.
      s.alerts.raise({ title: "New sign-in", body: "b", category: "security", priority: "critical" });
      await s.push.idle();
      const security = (await decryptAsBrowser(stub.sent.at(-1)!.body, browser)) as Record<string, unknown>;
      expect(security).toMatchObject({ sticky: true });
      expect(security.actions).toBeUndefined();
      stub.sent.pop();
      // A normal reminder carries no buttons.
      await s.automations.update(a.id, { priority: "normal" });
      await agent.runAutomationNow(a.id);
      await s.push.idle();
      const plain = (await decryptAsBrowser(stub.sent[2]!.body, browser)) as Record<string, unknown>;
      expect(plain.actions).toBeUndefined();
      expect(s.notifications.list({ limit: 1 })[0]!.escalation).toBeNull();
      await s.automations.delete(a.id);
    });
  });

  it("keeps the priority through the API and a backup", async () => {
    const c = await loggedIn();
    const created = await c.call("/api/automations", {
      method: "POST",
      body: { name: "Insist", kind: "reminder", message: "Call", schedule: { type: "interval", minutes: 120 }, priority: "high" },
    });
    expect(created.status).toBe(201);
    const { automation } = (await created.json()) as { automation: { id: string; priority: string } };
    expect(automation.priority).toBe("high");
    const critical = await c.call(`/api/automations/${automation.id}`, { method: "PATCH", body: { priority: "critical" } });
    expect(critical.status).toBe(400);
    const lowered = await c.call(`/api/automations/${automation.id}`, { method: "PATCH", body: { priority: "low" } });
    expect(((await lowered.json()) as { automation: { priority: string } }).automation.priority).toBe("low");
    const plain = await c.call("/api/automations", {
      method: "POST",
      body: { name: "Plain", kind: "reminder", message: "Call", schedule: { type: "interval", minutes: 120 } },
    });
    expect(((await plain.json()) as { automation: { priority: string } }).automation.priority).toBe("normal");
    await inAgent(async (agent) => {
      for (const a of agent.services.automations.list()) await agent.services.automations.delete(a.id);
    });
  });
});
