import { EMAIL_ALERTS, ESCALATION, type Notification } from "@talorys/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TalorysAgent } from "../src/agent/talorys-agent";
import { emailChannel } from "../src/alerts/channels";
import { EmailAlerts, type EmailConfig, isEmailAddress, maskAddress } from "../src/alerts/email";
import { AlertDeliveryRepository } from "../src/alerts/repository";
import { SECURITY_EVENTS } from "../src/alerts/security";
import { type AlertAttempt, type AlertChannelAdapter, AlertService } from "../src/alerts/service";
import { MAX_NOTIFICATIONS } from "../src/db/repositories/automations";
import { inAgent, loggedIn, password } from "./helpers";
import { fakeBrowser, pushServiceStub } from "./push-helpers";

const MIN = 60_000;
const FROM = "talorys@exemplo.com.br";
const TO = "dono@exemplo.com.br";

beforeEach(async () => {
  await inAgent((agent) => {
    const db = agent.services.db;
    db.run(`DELETE FROM tal_notifications`);
    db.run(`DELETE FROM tal_alert_deliveries`);
    db.run(`DELETE FROM tal_alert_profiles`);
    db.run(`DELETE FROM tal_activity`);
    agent.services.settings.delete("alerts.preferences");
    agent.services.settings.delete("alerts.email.sent");
  });
});

afterEach(async () => {
  await inAgent((agent) => {
    agent.services.settings.update({ language: "en" });
    agent.services.settings.delete("auth.password_override");
    agent.services.remote.revokeAll();
    agent.services.remote.setEnabled(false);
    agent.services.telegram.setConversation(false);
  });
});

type Sent = { from: string; to: string; subject: string; text: string };

/** E-mail alerts over a fake binding that records each message (or throws). */
function fakeEmail(agent: TalorysAgent, config: Partial<EmailConfig> = {}, opts: { throws?: boolean } = {}) {
  const sent: Sent[] = [];
  const email = new EmailAlerts(
    {
      binding: {
        send: async (m) => {
          if (opts.throws) throw Object.assign(new Error(`rejected ${m.to}`), { code: "E_RECIPIENT_NOT_ALLOWED" });
          sent.push(m);
          return { messageId: "x" };
        },
      },
      from: FROM,
      to: TO,
      appUrl: "https://talorys.exemplo.com.br/",
      ...config,
    },
    agent.services.settings,
    () => {},
  );
  return { email, sent };
}

function notification(over: Partial<Notification> = {}): Notification {
  return {
    id: "n1", title: "New sign-in", body: "Someone signed in.", automation_id: null, priority: "critical", category: "security",
    read_at: null, created_at: new Date().toISOString(), escalation: null, attempts: 1, next_attempt_at: null, acknowledged_out_of_band: false,
    profile: null, priority_reason: null, ...over,
  } as Notification;
}

/** The alert center with a push channel that records its tries and the e-mail channel. */
function center(agent: TalorysAgent, email: EmailAlerts, opts: { push?: "no_device" | null } = {}) {
  const pushed: { n: Notification; attempt?: AlertAttempt }[] = [];
  const alarms: { id: string; step: number }[] = [];
  const push: AlertChannelAdapter = {
    id: "push",
    unavailable: () => opts.push ?? null,
    send: (n, done, attempt) => {
      pushed.push({ n, attempt });
      done(1);
    },
  };
  const s = agent.services;
  const fullText = (n: Notification) => (s.settings.getJson<{ fullText?: string[] }>("alerts.preferences")?.fullText ?? []).includes(n.category);
  const alerts = new AlertService(s.notifications, new AlertDeliveryRepository(s.db), s.settings, { push, email: emailChannel(email, fullText) }, {
    timers: { schedule: (_at, id, step) => alarms.push({ id, step }) },
    email,
  });
  return { alerts, pushed, alarms, deliveries: new AlertDeliveryRepository(s.db) };
}

describe("e-mail alerts", () => {
  it("accepts only plain addresses and masks the recipient", () => {
    expect(isEmailAddress(TO)).toBe(true);
    for (const bad of [undefined, "", "dono", "Dono <dono@exemplo.com.br>", "dono@exemplo", "a b@exemplo.com.br", "dono@exemplo.com.br\r\nBcc: x@y.z"]) {
      expect(isEmailAddress(bad)).toBe(false);
    }
    expect(maskAddress(TO)).toBe("d•••@exemplo.com.br");
  });

  it("is set up only with the binding, a valid sender and a valid recipient", async () => {
    await inAgent((agent) => {
      expect(fakeEmail(agent).email.configured()).toBe(true);
      expect(fakeEmail(agent).email.recipient()).toBe("d•••@exemplo.com.br");
      expect(fakeEmail(agent, { binding: undefined }).email.configured()).toBe(false);
      expect(fakeEmail(agent, { from: "talorys" }).email.configured()).toBe(false);
      expect(fakeEmail(agent, { to: undefined }).email.recipient()).toBeNull();
      // The deployment under test has no binding: the channel shows as not set up.
      expect(agent.services.alerts.overview().email).toEqual({ to: null, sentToday: 0 });
      expect(agent.services.alerts.overview().channels.email).toEqual({ available: false });
    });
  });

  it("sends the alert in the owner's language, discreet unless its category may show the text", async () => {
    await inAgent(async (agent) => {
      agent.services.settings.update({ language: "pt-BR" });
      const { email, sent } = fakeEmail(agent);
      email.deliver(notification(), false, () => {});
      email.deliver(notification({ title: "Pay rent", body: "Today, 300", category: "reminder", priority: "high" }), true, () => {});
      email.deliver(notification({ title: "Rent\r\nBcc: x@y.z\u2028more" }), false, () => {});
      await email.idle();
      expect(sent).toHaveLength(3);
      // Line breaks never reach the subject.
      expect(sent[2]!.subject).toBe("Talorys: Rent Bcc: x@y.z more");
      expect(sent[0]).toMatchObject({ from: FROM, to: TO });
      expect(sent[0]!.subject).toBe("Talorys: Novo login");
      expect(sent[0]!.text).toContain("Abra o Talorys para ler.");
      expect(sent[0]!.text).not.toContain("Someone signed in.");
      expect(sent[0]!.text).toContain("Segurança · Crítica");
      expect(sent[0]!.text).toContain("O Talorys nunca pede sua senha ou códigos por e-mail.");
      expect(sent[0]!.text).toContain("Abrir o Talorys: https://talorys.exemplo.com.br/");
      expect(sent[0]!.text).toContain("Escolha quais avisos chegam ao seu e-mail em Configurações → Avisos.");
      expect(sent[1]!.text).toContain("Today, 300");
      expect(sent[1]!.text).not.toContain("nunca pede");
    });
  });

  it(`sends at most ${EMAIL_ALERTS.perDay} a day, keeps ${EMAIL_ALERTS.reserved} for security and critical alerts, and never throws`, async () => {
    await inAgent(async (agent) => {
      const failing = fakeEmail(agent, {}, { throws: true });
      const reached: number[] = [];
      failing.email.deliver(notification(), true, (r) => reached.push(r));
      await failing.email.idle();
      expect(reached).toEqual([0]);
      const { email, sent } = fakeEmail(agent);
      const routine = (i: number) => notification({ id: `r${i}`, title: "Backup", category: "routine", priority: "high" });
      expect(email.full(routine(0))).toBe(false);
      // The failed send above counts: others get the rest of the shared part.
      for (let i = 0; i < 8; i++) email.deliver(routine(i), true, () => {});
      await email.idle();
      const shared = EMAIL_ALERTS.perDay - EMAIL_ALERTS.reserved;
      expect(sent).toHaveLength(shared - 1);
      expect(sent.at(-1)!.text).toContain("Other alerts stop going by e-mail for today; security and critical alerts still do.");
      expect(email.full(routine(9))).toBe(true);
      expect(email.canTest()).toBe(false);
      // Security and critical alerts still have the reserve, and the last one says it's the last.
      expect(email.full(notification())).toBe(false);
      for (let i = 0; i < EMAIL_ALERTS.reserved + 1; i++) email.deliver(notification({ id: `s${i}`, category: "system" }), true, () => {});
      await email.idle();
      expect(sent).toHaveLength(EMAIL_ALERTS.perDay - 1);
      expect(sent.at(-1)!.text).toContain("This is the last e-mail alert for today.");
      expect(email.full(notification())).toBe(true);
      expect(email.sentToday()).toBe(EMAIL_ALERTS.perDay);
      // A day later the room is back; tests are limited on their own.
      const old = new Date(Date.now() - 25 * 60 * MIN).toISOString();
      agent.services.settings.setJson("alerts.email.sent", Array.from({ length: EMAIL_ALERTS.perDay }, () => ({ t: old, k: "security" })));
      expect(email.full(notification())).toBe(false);
      for (let i = 0; i < EMAIL_ALERTS.testsPerDay; i++) expect(await email.test()).toBe(true);
      expect(email.canTest()).toBe(false);
      expect(await email.test()).toBe(false);
      expect(sent.at(-1)!.subject).toBe("Talorys: Test e-mail");
      // Entries in another shape are ignored.
      agent.services.settings.setJson("alerts.email.sent", ["2099-01-01T00:00:00.000Z", null, 3]);
      expect(email.sentToday()).toBe(0);
    });
  });

  it("sends the password recovery link to the verified address, never from the security reserve", async () => {
    await inAgent(async (agent) => {
      const { email, sent } = fakeEmail(agent);
      expect(email.address()).toBe(TO);
      expect(email.canSendRecovery()).toBe(true);
      email.sendRecovery("https://talorys.exemplo.com.br/recover#token");
      await email.idle();
      expect(sent).toHaveLength(1);
      expect(sent[0]!.to).toBe(TO);
      expect(sent[0]!.subject).toBe("Talorys: Reset your password");
      expect(sent[0]!.text).toContain("https://talorys.exemplo.com.br/recover#token");
      const now = new Date().toISOString();
      const shared = EMAIL_ALERTS.perDay - EMAIL_ALERTS.reserved;
      agent.services.settings.setJson("alerts.email.sent", Array.from({ length: shared }, () => ({ t: now, k: "routine" })));
      expect(email.canSendRecovery()).toBe(false);
      expect(email.full(notification())).toBe(false);
    });
  });

  it("gets every security and critical alert, other categories only when routed, and only the first try", async () => {
    await inAgent(async (agent) => {
      const { email, sent } = fakeEmail(agent);
      const { alerts, pushed, deliveries } = center(agent, email);
      const security = alerts.raise({ title: "New sign-in", body: "b", category: "security" })!;
      alerts.raise({ title: "Pay rent", body: "b", category: "reminder", priority: "high" });
      await email.idle();
      expect(sent.map((m) => m.subject)).toEqual(["Talorys: New sign-in"]);
      expect(deliveries.list().filter((d) => d.channel === "email").map((d) => d.status)).toEqual(["sent"]);
      // The owner turns e-mail on for reminders.
      agent.services.settings.setJson("alerts.preferences", { routes: { reminder: ["push", "email"] }, limits: { perHour: 6, perDay: 30 }, fullText: [] });
      alerts.raise({ title: "Water the plants", body: "b", category: "reminder" });
      await email.idle();
      expect(sent).toHaveLength(2);
      // The later tries of the security alert go to push only.
      agent.services.db.run(`UPDATE tal_notifications SET created_at = ?, next_attempt_at = ? WHERE id = ?`, new Date(Date.now() - 16 * MIN).toISOString(), new Date(Date.now() - MIN).toISOString(), security.id);
      alerts.escalate(security.id);
      await email.idle();
      expect(sent).toHaveLength(2);
      expect(pushed.at(-1)).toMatchObject({ n: { id: security.id }, attempt: { number: 2 } });
    });
  });

  it("holds back even security alerts once the daily cap is reached, and an e-mail alone never insists", async () => {
    await inAgent(async (agent) => {
      const { email, sent } = fakeEmail(agent);
      agent.services.settings.setJson("alerts.email.sent", Array.from({ length: EMAIL_ALERTS.perDay }, () => ({ t: new Date().toISOString(), k: "security" })));
      const { alerts, deliveries } = center(agent, email);
      alerts.raise({ title: "New sign-in", body: "b", category: "security" });
      expect(deliveries.list().find((d) => d.channel === "email")).toMatchObject({ status: "skipped", reason: "rate_limited" });
      expect(sent).toEqual([]);

      agent.services.settings.delete("alerts.email.sent");
      const offline = center(agent, email, { push: "no_device" });
      const n = offline.alerts.raise({ title: "Two-step sign-in off", body: "b", category: "security" })!;
      await email.idle();
      expect(sent).toHaveLength(1);
      // Nothing could carry try 2 of ESCALATION.attempts: it doesn't insist.
      expect(ESCALATION.attempts).toBeGreaterThan(1);
      expect(n.escalation).toBeNull();
      expect(offline.alarms).toEqual([]);
    });
  });

  it("shows the recipient and today's count in the overview", async () => {
    await inAgent(async (agent) => {
      const { email } = fakeEmail(agent);
      const { alerts } = center(agent, email);
      alerts.raise({ title: "New sign-in", body: "b", category: "security" });
      await email.idle();
      expect(alerts.overview().email).toEqual({ to: "d•••@exemplo.com.br", sentToday: 1 });
      expect(alerts.overview().channels.email).toEqual({ available: true });
    });
  });

  it("answers the test e-mail route with not configured on a deployment without e-mail, after the password", async () => {
    const c = await loggedIn();
    await inAgent((agent) => agent.services.db.run(`UPDATE tal_sessions SET confirmed_at = '2000-01-01T00:00:00.000Z'`));
    const stale = await c.call("/api/alerts/email/test", { method: "POST" });
    expect(stale.status).toBe(403);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe("REAUTH_REQUIRED");
    expect((await c.call("/api/auth/confirm", { method: "POST", body: { password: password() } })).status).toBe(200);
    const res = await c.call("/api/alerts/email/test", { method: "POST" });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NOT_CONFIGURED");
    const overview = await c.json("/api/alerts");
    expect(overview.email).toEqual({ to: null, sentToday: 0 });
    expect(Object.keys(overview.channels)).toEqual(["push", "telegram", "email"]);
  });
});

describe("security alerts out of band", () => {
  const securityTitles = () =>
    inAgent((agent) => agent.services.notifications.list().filter((n) => n.category === "security").map((n) => ({ title: n.title, priority: n.priority })));

  it("tell the owner when remote access is turned on and when a token is created", async () => {
    const c = await loggedIn();
    expect((await c.call("/api/remote/status", { method: "PATCH", body: { enabled: true } })).status).toBe(200);
    // Turning it on again changes nothing, and says nothing.
    await c.call("/api/remote/status", { method: "PATCH", body: { enabled: true } });
    expect((await c.call("/api/remote/tokens", { method: "POST", body: { name: "laptop" } })).status).toBe(201);
    const remote = [SECURITY_EVENTS.token_created.title, SECURITY_EVENTS.remote_enabled.title] as string[];
    expect((await securityTitles()).filter((x) => remote.includes(x.title))).toEqual([
      { title: SECURITY_EVENTS.token_created.title, priority: "critical" },
      { title: SECURITY_EVENTS.remote_enabled.title, priority: "critical" },
    ]);
  });

  it("tell the owner about a password change, a backup export or import and the Telegram conversation", async () => {
    const c = await loggedIn();
    expect((await c.call("/api/export")).status).toBe(200);
    const backup = await (await c.call("/api/export")).json();
    expect((await c.call("/api/import", { method: "POST", body: backup })).status).toBe(200);
    expect((await c.call("/api/telegram", { method: "PATCH", body: { conversation: true } })).status).toBe(200);
    expect((await c.call("/api/auth/password", { method: "POST", body: { current_password: password(), new_password: "Another-pass-99-zebra" } })).status).toBe(200);
    const titles = (await securityTitles()).map((x) => x.title);
    expect(titles).toEqual(expect.arrayContaining([
      SECURITY_EVENTS.data_exported.title,
      SECURITY_EVENTS.data_imported.title,
      SECURITY_EVENTS.telegram_conversation.title,
      SECURITY_EVENTS.password_changed.title,
    ]));
    // Every one reached for every channel (e-mail included), whatever the routes say.
    const channels = await inAgent((agent) => new Set(new AlertDeliveryRepository(agent.services.db).list().map((d) => d.channel)));
    expect([...channels].sort()).toEqual(["email", "push", "telegram"]);
  });

  it("tell the owner about a new or removed push device, a new MCP server and deleted sign-in activity", async () => {
    const stub = pushServiceStub(201);
    await inAgent((agent) => {
      agent.services.db.run(`DELETE FROM tal_push_subscriptions`);
      agent.services.push.fetcher = stub.fetcher;
    });
    const c = await loggedIn();
    const browser = await fakeBrowser();
    const first = await c.json("/api/push/subscriptions", { method: "POST", body: browser.json });
    expect(first.device).toBeDefined();
    // The warning about a new device goes to the owner's other devices, never to the new one.
    await inAgent((agent) => agent.services.push.idle());
    expect(stub.sent.filter((m) => m.url === browser.json.endpoint)).toEqual([]);
    // The same browser renewing its subscription is not a new device, and needs no password.
    await inAgent((agent) => agent.services.db.run(`UPDATE tal_sessions SET confirmed_at = '2000-01-01T00:00:00.000Z'`));
    const renew = await c.call("/api/push/subscriptions", { method: "POST", body: browser.json });
    expect(renew.status, await renew.clone().text()).toBe(200);
    const other = await fakeBrowser();
    const refused = await c.call("/api/push/subscriptions", { method: "POST", body: other.json });
    expect(refused.status).toBe(403);
    expect((await c.call("/api/auth/confirm", { method: "POST", body: { password: password() } })).status).toBe(200);
    expect((await c.call(`/api/push/subscriptions/${first.device.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await c.call("/api/mcp/servers", { method: "POST", body: { name: "Docs", url: "https://mcp.example.com/mcp" } })).status).toBe(201);
    expect((await c.call("/api/auth/activity/delete", { method: "POST" })).status).toBe(200);
    const titles = (await securityTitles()).map((x) => x.title);
    expect(titles.filter((t) => t === SECURITY_EVENTS.push_added.title)).toHaveLength(1);
    expect(titles).toEqual(expect.arrayContaining([SECURITY_EVENTS.push_removed.title, SECURITY_EVENTS.mcp_added.title, SECURITY_EVENTS.activity_deleted.title]));
    await inAgent(async (agent) => {
      for (const s of agent.services.mcp.list()) await agent.services.mcp.remove(s.id);
      agent.services.db.run(`DELETE FROM tal_push_subscriptions`);
    });
  });

  it("can't be deleted without the password typed recently; other alerts can", async () => {
    const c = await loggedIn();
    const [security, other] = await inAgent((agent) => [
      agent.services.alerts.raise({ title: "New sign-in", body: "b", category: "security" })!,
      agent.services.alerts.raise({ title: "FYI", body: "b", category: "system" })!,
    ]);
    await inAgent((agent) => {
      agent.services.notifications.acknowledge(security.id, { outOfBand: true });
      agent.services.db.run(`UPDATE tal_notifications SET escalation = 'acknowledged' WHERE id = ?`, security.id);
      agent.services.db.run(`UPDATE tal_sessions SET confirmed_at = '2000-01-01T00:00:00.000Z'`);
    });
    const refused = await c.call(`/api/notifications/${security.id}`, { method: "DELETE" });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("REAUTH_REQUIRED");
    expect((await c.call(`/api/notifications/${other.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await c.call("/api/auth/confirm", { method: "POST", body: { password: password() } })).status).toBe(200);
    expect((await c.call(`/api/notifications/${security.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await inAgent((agent) => agent.services.notifications.get(security.id))).toBeNull();
  });

  it("are never pushed out of the record by a flood of other alerts", async () => {
    await inAgent((agent) => {
      const s = agent.services;
      const kept = s.notifications.create({ title: "New sign-in", body: "b", automation_id: null, priority: "critical", category: "security" });
      for (let i = 0; i < MAX_NOTIFICATIONS + 5; i++) s.notifications.create({ title: `Routine ${i}`, body: "b", automation_id: null, priority: "low", category: "routine" });
      expect(s.notifications.get(kept.id)).not.toBeNull();
      const count = s.db.one<{ n: number }>(`SELECT count(*) AS n FROM tal_notifications WHERE category != 'security'`)!.n;
      expect(count).toBe(MAX_NOTIFICATIONS);
    });
  });
});
