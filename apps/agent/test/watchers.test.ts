import { localizeServerText, PUSH_INACTIVE_DAYS, WATCH } from "@talorys/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TalorysAgent } from "../src/agent/talorys-agent";
import { runWatchers, sendDigest } from "../src/alerts/watchers";
import { inAgent, loggedIn } from "./helpers";
import { fakeBrowser, pushServiceStub } from "./push-helpers";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** A Friday, 07:30 UTC. */
const FRIDAY_0730 = new Date("2026-10-30T07:30:00.000Z");
const offline = (async () => new Response("no", { status: 503 })) as unknown as typeof fetch;

beforeEach(async () => {
  await inAgent(async (agent) => {
    const s = agent.services;
    for (const table of ["tal_notifications", "tal_alert_deliveries", "tal_alert_profiles", "tal_alert_corrections", "tal_tasks", "tal_activity"]) s.db.run(`DELETE FROM ${table}`);
    for (const a of s.automations.list()) await s.automations.delete(a.id);
    for (const key of ["alerts.preferences", "alerts.digest.last", "alerts.backup.since", "update.latest"]) s.settings.delete(key);
    s.settings.update({ timezone: "UTC", updateCheck: false });
    // A recent backup, so the backup check stays quiet unless a test wants it.
    s.activity.record("data.exported", "Exported a backup");
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const alerts = (agent: TalorysAgent) => agent.services.notifications.list({ limit: 100 });
const task = (agent: TalorysAgent, title: string, dueInMs: number | null, extra: { status?: "todo" | "in_progress" | "done" } = {}) =>
  agent.services.tasks.create({ title, due_at: dueInMs === null ? null : new Date(Date.now() + dueInMs).toISOString(), ...extra });
/** Runs a round now without the daily summary; its time (00:00) has passed, so overdue tasks are told. */
const round = (agent: TalorysAgent, now = new Date()) => {
  agent.services.alerts.updatePreferences({ ...agent.services.alerts.preferences(), digest: { enabled: false, time: "00:00" } });
  return runWatchers(agent.services, now, offline);
};
const today = () => new Date().toISOString().slice(0, 10);

describe("deadline watcher", () => {
  it("warns of tasks due in 24 hours and within the hour, insists on overdue ones, and spots stalled work", async () => {
    await inAgent(async (agent) => {
      const overdue = task(agent, "Pay rent", -2 * HOUR);
      const soon = task(agent, "Call the bank", 30 * MIN);
      const tomorrow = task(agent, "Send the report", 10 * HOUR);
      task(agent, "Next week", 3 * DAY);
      task(agent, "Long forgotten", -10 * DAY);
      task(agent, "Already done", -HOUR, { status: "done" });
      const stalled = task(agent, "Write the book", null, { status: "in_progress" });
      agent.services.db.run(`UPDATE tal_tasks SET updated_at = ? WHERE id = ?`, new Date(Date.now() - 8 * DAY).toISOString(), stalled.id);

      const report = await round(agent);
      expect(report.raised).toEqual({ tasks: 4 });
      const byTitle = Object.fromEntries(alerts(agent).map((n) => [n.title, n]));
      expect(byTitle["Task overdue"]).toMatchObject({ priority: "high", category: "task", profile: "task:task-overdue" });
      expect(byTitle["Task overdue"]!.body).toMatch(/^“Pay rent” was due /);
      expect(byTitle["Task due within the hour"]!.body).toMatch(/^“Call the bank” is due /);
      expect(byTitle["Task due in 24 hours"]).toMatchObject({ priority: "normal" });
      expect(byTitle["Task stalled"]!.body).toBe("“Write the book” has been in progress for 8 days without changes.");
      const keys = agent.services.db.all<{ dedupe_key: string }>(`SELECT dedupe_key FROM tal_notifications`).map((r) => r.dedupe_key).sort();
      expect(keys).toEqual([`task-due-1h:${soon.id}`, `task-due-24h:${tomorrow.id}`, `task-overdue:${today()}:${overdue.id}`, `task-stalled:${stalled.id}`].sort());

      // The next round finds the same tasks and says nothing again.
      expect((await round(agent)).raised).toEqual({});
      // Finishing the overdue task right after its alert teaches its priority.
      agent.services.tasks.complete(overdue.id);
      expect(agent.services.db.one<{ signal: string }>(`SELECT signal FROM tal_notifications WHERE dedupe_key = ?`, `task-overdue:${today()}:${overdue.id}`)!.signal).toBe("task");
    });
  });

  it("raises at most WATCH.maxTaskAlerts per round, the next deadline first, then the newest overdue", async () => {
    await inAgent(async (agent) => {
      for (let i = 0; i < WATCH.maxTaskAlerts + 2; i++) task(agent, `Late ${i}`, -(i + 1) * HOUR);
      task(agent, "Soon", 20 * MIN);
      expect((await round(agent)).raised.tasks).toBe(WATCH.maxTaskAlerts);
      const first = alerts(agent).map((n) => n.body.slice(0, 8));
      expect(first).toContain("“Soon” i");
      expect(first).toContain("“Late 0”");
      expect(first).not.toContain("“Late 6”");
      expect((await round(agent)).raised.tasks).toBe(3);
    });
  });

  it("keeps to WATCH.maxTaskAlertsPerDay however many tasks are late", async () => {
    await inAgent(async (agent) => {
      for (let i = 0; i < WATCH.maxTaskAlertsPerDay + 5; i++) task(agent, `Late ${i}`, -(i + 1) * MIN);
      let total = 0;
      for (let r = 0; r < 8; r++) total += (await round(agent)).raised.tasks ?? 0;
      expect(total).toBe(WATCH.maxTaskAlertsPerDay);
    });
  });

  it("tells an overdue task once a local day after the summary's time, High only on the first day", async () => {
    await inAgent(async (agent) => {
      const s = agent.services;
      const now = new Date("2026-10-29T12:00:00.000Z");
      const late = s.tasks.create({ title: "Pay rent", due_at: "2026-10-28T23:59:00.000Z" });
      const older = s.tasks.create({ title: "Old bill", due_at: "2026-10-26T12:00:00.000Z" });
      s.alerts.updatePreferences({ ...s.alerts.preferences(), digest: { enabled: false, time: "07:30" } });
      // Just after midnight: not yet, whatever the cooldown says.
      expect((await runWatchers(s, new Date("2026-10-29T00:05:00.000Z"), offline)).raised).toEqual({});
      expect((await runWatchers(s, now, offline)).raised).toEqual({ tasks: 2 });
      const byKey = Object.fromEntries(s.db.all<{ dedupe_key: string; priority: string }>(`SELECT dedupe_key, priority FROM tal_notifications`).map((r) => [r.dedupe_key, r.priority]));
      expect(byKey).toEqual({ [`task-overdue:2026-10-29:${late.id}`]: "high", [`task-overdue:2026-10-29:${older.id}`]: "normal" });
      expect((await runWatchers(s, new Date(now.getTime() + 6 * HOUR), offline)).raised).toEqual({});
      // The next day, after 07:30: once more.
      expect((await runWatchers(s, new Date("2026-10-30T08:00:00.000Z"), offline)).raised).toEqual({ tasks: 2 });
    });
  });

  it("links never become clickable in the alert", async () => {
    await inAgent(async (agent) => {
      task(agent, "[Sign in](https://evil.example/login)", -HOUR);
      await round(agent);
      expect(alerts(agent)[0]!.body).not.toContain("](");
    });
  });
});

describe("system watchers", () => {
  it("tells about a routine that failed twice in a row, once a day", async () => {
    await inAgent(async (agent) => {
      const s = agent.services;
      const a = await s.automations.create({ name: "Morning news", kind: "reminder", message: "m", schedule: { type: "daily", time: "09:00" }, enabled: true });
      const fail = () => s.automationsRepo.finishRun(s.automationsRepo.startRun(a).id, "error", null, "boom");
      fail();
      expect((await round(agent)).raised).toEqual({});
      fail();
      expect((await round(agent)).raised).toEqual({ routines: 1 });
      expect(alerts(agent)[0]).toMatchObject({
        title: "Routine failing",
        body: "“Morning news” failed its last 2 runs. See the error in Automations.",
        category: "system",
        profile: "system:routine-failing",
      });
      fail();
      expect((await round(agent)).raised).toEqual({});
      // Paused: not watched.
      s.db.run(`DELETE FROM tal_notifications`);
      await s.automations.update(a.id, { enabled: false });
      expect((await round(agent)).raised).toEqual({});
    });
  });

  it("warns at 80% of the AI budget and insists when it is used up", async () => {
    await inAgent(async (agent) => {
      const s = agent.services;
      const before = s.settings.get().limits;
      s.settings.update({ limits: { maxAiRequestsPerDay: 10 } });
      try {
        const used = s.usage.today().ai_requests;
        s.usage.increment({ ai_requests: Math.max(0, 8 - used) });
        expect((await round(agent)).raised).toEqual({ budget: 1 });
        expect(alerts(agent)[0]).toMatchObject({ title: "AI budget almost used", priority: "normal" });
        s.usage.increment({ ai_requests: 2 });
        expect((await round(agent)).raised).toEqual({ budget: 1 });
        expect(alerts(agent)[0]).toMatchObject({ title: "AI budget used up", priority: "high" });
        expect((await round(agent)).raised).toEqual({});
      } finally {
        s.settings.update({ limits: before });
      }
    });
  });

  it("tells when every push device stopped receiving, and about MCP servers that need a sign-in", async () => {
    await inAgent(async (agent) => {
      const s = agent.services;
      vi.spyOn(s.push, "configured").mockReturnValue(true);
      const devices = vi.spyOn(s.push.subscriptions, "devices").mockReturnValue([
        { failures: WATCH.pushFailures } as never,
        { failures: 0 } as never,
      ]);
      expect((await round(agent)).raised).toEqual({});
      devices.mockReturnValue([{ failures: WATCH.pushFailures } as never]);
      vi.spyOn(s.mcp, "enabled", "get").mockReturnValue(true);
      vi.spyOn(s.mcp, "list").mockReturnValue([
        { id: "m1", name: "Calendar", enabled: true, status: "auth_required" } as never,
        { id: "m2", name: "CRM", enabled: true, status: "error" } as never,
        { id: "m3", name: "Off", enabled: false, status: "error" } as never,
        { id: "m4", name: "Fine", enabled: true, status: "connected" } as never,
      ]);
      expect((await round(agent)).raised).toEqual({ push: 1, mcp: 2 });
      const bodies = alerts(agent).map((n) => n.body);
      expect(bodies).toContain("“Calendar” needs you to sign in again. Open Settings → Integrations.");
      expect(bodies).toContain("“CRM” is failing. Open Settings → Integrations to reconnect it.");
    });
  });

  it("reminds of a backup after 30 days, counting from the first round when there was none", async () => {
    await inAgent(async (agent) => {
      const s = agent.services;
      s.db.run(`DELETE FROM tal_activity`);
      s.settings.delete("alerts.backup.last");
      expect((await round(agent)).raised).toEqual({});
      expect(s.settings.getJson<string>("alerts.backup.since")).toBeTruthy();
      s.settings.setJson("alerts.backup.since", new Date(Date.now() - (WATCH.backupDays * DAY + MIN)).toISOString());
      expect((await round(agent)).raised).toEqual({ backup: 1 });
      expect(alerts(agent)[0]).toMatchObject({ title: "Time for a backup", priority: "low" });
      // A recent export counts, even once the activity log has dropped it.
      s.db.run(`DELETE FROM tal_notifications`);
      const c = await loggedIn();
      expect((await c.call("/api/export")).status).toBe(200);
      s.db.run(`DELETE FROM tal_activity`);
      expect((await round(agent)).raised).toEqual({});
    });
  });

  it(`removes push devices that have not opened Axis for ${PUSH_INACTIVE_DAYS} days, even with the watchers off`, async () => {
    await inAgent(async (agent) => {
      const s = agent.services;
      s.db.run(`DELETE FROM tal_push_subscriptions`);
      s.push.fetcher = pushServiceStub(201).fetcher;
      const add = async (label: string, endpoint: string) => {
        const { keys } = (await fakeBrowser(endpoint)).json;
        return s.push.subscriptions.save({ endpoint, p256dh: keys.p256dh, auth: keys.auth, label, origin: "https://exemplo.com.br" });
      };
      const lost = await add("Lost https://evil.example phone", "https://fcm.googleapis.com/fcm/send/lost");
      const kept = await add("Laptop", "https://fcm.googleapis.com/fcm/send/kept");
      const now = Date.now();
      s.db.run(`UPDATE tal_push_subscriptions SET last_seen_at = ? WHERE id = ?`, new Date(now - PUSH_INACTIVE_DAYS * DAY - MIN).toISOString(), lost.id);
      // Just inside the limit: kept.
      s.db.run(`UPDATE tal_push_subscriptions SET last_seen_at = ? WHERE id = ?`, new Date(now - PUSH_INACTIVE_DAYS * DAY + HOUR).toISOString(), kept.id);
      s.alerts.updatePreferences({ ...s.alerts.preferences(), watchers: false, digest: { enabled: false, time: "00:00" } });

      expect((await runWatchers(s, new Date(now), offline)).raised).toEqual({ "push-inactive": 1 });
      expect(s.push.subscriptions.devices().map((d) => d.id)).toEqual([kept.id]);
      const [alert] = alerts(agent);
      expect(alert).toMatchObject({ title: "Push device removed for inactivity", category: "system" });
      expect(alert!.body).toContain(`had not opened Axis for ${PUSH_INACTIVE_DAYS} days`);
      // The label is the owner's (or a browser's) text: links in it never become clickable.
      expect(alert!.body).toContain("“Lost `https://evil.example` phone”");
      expect(localizeServerText(alert!.body, "pt-BR")).toContain(`não abria o Axis havia ${PUSH_INACTIVE_DAYS} dias`);
      expect(s.activity.list(10).some((a) => a.type === "push.expired")).toBe(true);

      // Opening the app keeps a device: the next round removes nothing.
      expect(s.push.subscriptions.markSeen("https://fcm.googleapis.com/fcm/send/kept", new Date(now).toISOString())).toBe(true);
      expect((await runWatchers(s, new Date(now + 2 * HOUR), offline)).raised).toEqual({});
      expect(s.push.subscriptions.devices()).toHaveLength(1);
      await s.push.idle();
      s.db.run(`DELETE FROM tal_push_subscriptions`);
    });
  });

  it("does nothing with the watchers off, and a failing check never stops the others", async () => {
    await inAgent(async (agent) => {
      const s = agent.services;
      task(agent, "Pay rent", -HOUR);
      s.alerts.updatePreferences({ ...s.alerts.preferences(), watchers: false, digest: { enabled: false, time: "00:00" } });
      expect((await runWatchers(s, new Date(), offline)).raised).toEqual({});
      s.alerts.updatePreferences({ ...s.alerts.preferences(), watchers: true });
      vi.spyOn(s.automationsRepo, "list").mockImplementation(() => {
        throw new Error("broken");
      });
      vi.spyOn(console, "warn").mockImplementation(() => {});
      expect((await runWatchers(s, new Date(), offline)).raised).toEqual({ tasks: 1 });
    });
  });
});

describe("daily summary", () => {
  it("goes out once at its time, with what matters today, and nothing when there is nothing", async () => {
    await inAgent(async (agent) => {
      const s = agent.services;
      const now = FRIDAY_0730;
      s.tasks.create({ title: "Pay rent", due_at: new Date(now.getTime() - DAY).toISOString(), priority: "high" });
      s.tasks.create({ title: "Lunch with Ana", due_at: new Date(now.getTime() + 5 * HOUR).toISOString() });
      s.tasks.create({ title: "Tomorrow", due_at: new Date(now.getTime() + 20 * HOUR).toISOString() });
      vi.spyOn(s.automationsRepo, "list").mockReturnValue([
        { id: "a", name: "Water the plants", enabled: true, next_run: new Date(now.getTime() + 2 * HOUR).toISOString() } as never,
        { id: "b", name: "Paused", enabled: false, next_run: new Date(now.getTime() + 2 * HOUR).toISOString() } as never,
      ]);
      const low = s.alerts.raise({ title: "Update available", body: "b", category: "system", priority: "low" })!;
      s.db.run(`UPDATE tal_notifications SET created_at = ? WHERE id = ?`, new Date(now.getTime() - HOUR).toISOString(), low.id);
      s.db.run(
        `INSERT INTO tal_alert_profiles (id, key, category, label, shift, changed_at, last_change, created_at, updated_at)
         VALUES ('p', 'routine:automation:x', 'routine', 'Weekly report', 1, ?, 1, ?, ?)`,
        new Date(now.getTime() - DAY).toISOString(), now.toISOString(), now.toISOString(),
      );

      // Before its time: nothing.
      expect((await runWatchers(s, new Date(now.getTime() - 15 * MIN), offline)).digest).toBe(false);
      const report = await runWatchers(s, now, offline);
      expect(report.digest).toBe(true);
      const digest = s.notifications.list().find((n) => n.title === "Daily summary")!;
      expect(digest).toMatchObject({ category: "digest", priority: "normal" });
      expect(digest.body).toContain("**Overdue (1)**\n- Pay rent (due ");
      expect(digest.body).toContain(") · high");
      expect(digest.body).toContain("**Due today (1)**\n- Lunch with Ana (due ");
      expect(digest.body).not.toContain("Tomorrow");
      expect(digest.body).toContain("**Scheduled today (1)**\n- 09:30 · Water the plants");
      expect(digest.body).toContain("**Waiting in the app (1)**\n- Update available (unread)");
      expect(digest.body).toContain("**Priority learned this week**\n- “Weekly report” one level louder");
      // Once a day.
      expect((await runWatchers(s, new Date(now.getTime() + 15 * MIN), offline)).digest).toBe(false);
      // Translated line by line.
      const pt = localizeServerText(digest.body, "pt-BR");
      expect(pt).toContain("**Atrasadas (1)**");
      expect(pt).toContain("**Agendado para hoje (1)**");
      expect(pt).toContain("**Esperando no app (1)**\n- Atualização disponível (não lido)");
      // Only the summary's own lines: a bullet in someone's text stays as written.
      expect(localizeServerText("- Tasks", "pt-BR")).toBe("- Tasks");
      expect(pt).toContain("**Prioridade aprendida nesta semana**\n- “Weekly report” um nível acima");

      // The next day with nothing to tell: nothing is sent, and it is not tried again that day.
      s.db.run(`DELETE FROM tal_tasks`);
      s.db.run(`DELETE FROM tal_notifications`);
      vi.mocked(s.automationsRepo.list).mockReturnValue([]);
      const saturday = new Date(now.getTime() + DAY);
      expect((await runWatchers(s, saturday, offline)).digest).toBe(false);
      expect(s.settings.getJson("alerts.digest.last")).toBe("2026-10-31");
      expect(s.notifications.list()).toEqual([]);
    });
  });

  it("follows its time in the owner's timezone, waits at most a few hours, and can be turned off", async () => {
    await inAgent(async (agent) => {
      const s = agent.services;
      s.tasks.create({ title: "Pay rent", due_at: new Date(FRIDAY_0730.getTime() - DAY).toISOString() });
      s.settings.update({ timezone: "America/Sao_Paulo" });
      s.alerts.updatePreferences({ ...s.alerts.preferences(), digest: { enabled: true, time: "07:30" } });
      // 07:30 UTC is 04:30 in São Paulo.
      expect((await runWatchers(s, FRIDAY_0730, offline)).digest).toBe(false);
      // 07:30 there.
      expect((await runWatchers(s, new Date("2026-10-30T10:30:00.000Z"), offline)).digest).toBe(true);
      // Too late the next day (more than WATCH.digestGraceHours after its time).
      expect((await runWatchers(s, new Date(`2026-10-31T${String(10 + WATCH.digestGraceHours + 1)}:00:00.000Z`), offline)).digest).toBe(false);
      s.alerts.updatePreferences({ ...s.alerts.preferences(), digest: { enabled: false, time: "07:30" } });
      expect((await runWatchers(s, new Date("2026-11-01T10:30:00.000Z"), offline)).digest).toBe(false);
    });
  });

  it("goes out for a time just before midnight, after the date changed", async () => {
    await inAgent(async (agent) => {
      const s = agent.services;
      s.tasks.create({ title: "Pay rent", due_at: "2026-10-28T12:00:00.000Z" });
      s.alerts.updatePreferences({ ...s.alerts.preferences(), digest: { enabled: true, time: "23:50" } });
      expect((await runWatchers(s, new Date("2026-10-29T23:45:00.000Z"), offline)).digest).toBe(false);
      expect((await runWatchers(s, new Date("2026-10-30T00:00:00.000Z"), offline)).digest).toBe(true);
      expect(s.settings.getJson("alerts.digest.last")).toBe("2026-10-29");
      expect((await runWatchers(s, new Date("2026-10-30T00:15:00.000Z"), offline)).digest).toBe(false);
    });
  });

  it("checks for an update once a day with the summary, when the update check is on", async () => {
    await inAgent(async (agent) => {
      const s = agent.services;
      s.settings.update({ updateCheck: true });
      const fetchFn = vi.fn(async () => Response.json({ version: "99.0.0" })) as unknown as typeof fetch;
      await runWatchers(s, FRIDAY_0730, fetchFn);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      const n = s.notifications.list().find((x) => x.title === "Update available")!;
      expect(n).toMatchObject({ priority: "low", category: "system" });
      expect(n.body).toMatch(/^Axis 99\.0\.0 is available \(you have /);
      // Outside the summary's time, no call to npm.
      await runWatchers(s, new Date(FRIDAY_0730.getTime() + 15 * MIN), fetchFn);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });

  it("sendDigest stands alone for tests and tools", async () => {
    await inAgent((agent) => {
      expect(sendDigest(agent.services, FRIDAY_0730)).toBe(false);
    });
  });
});

describe("settings and scheduling", () => {
  it("saves the summary time and the watchers switch, with defaults for older preferences", async () => {
    const c = await loggedIn();
    await inAgent((agent) => agent.services.settings.setJson("alerts.preferences", { routes: { reminder: ["push"] }, limits: { perHour: 6, perDay: 30 }, fullText: [] }));
    const before = await (await c.call("/api/alerts")).json<{ preferences: { digest: unknown; watchers: boolean } }>();
    expect(before.preferences).toMatchObject({ digest: { enabled: true, time: "07:30" }, watchers: true });
    const prefs = { ...before.preferences, digest: { enabled: true, time: "06:45" }, watchers: false };
    const saved = await c.call("/api/alerts/preferences", { method: "PUT", body: prefs });
    expect(await saved.json()).toMatchObject({ preferences: { digest: { time: "06:45" }, watchers: false } });
    const bad = await c.call("/api/alerts/preferences", { method: "PUT", body: { ...prefs, digest: { enabled: true, time: "25:00" } } });
    expect(bad.status).toBe(400);
  });

  it("schedules the watchers every 15 minutes, once however often the agent starts", async () => {
    await inAgent(async (agent) => {
      await agent.onStart();
      await agent.onStart();
      const watch = (await agent.listSchedules()).filter((x) => x.callback === "watch");
      expect(watch).toHaveLength(1);
      expect(watch[0]).toMatchObject({ type: "cron", cron: "*/15 * * * *" });
    });
  });
});
