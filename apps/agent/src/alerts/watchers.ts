import { type AlertCategory, getZonedParts, PUSH_INACTIVE_DAYS, TALORYS_VERSION, type Task, WATCH, zonedTimeToUtc } from "@talorys/shared";
import type { Services } from "../services/container";
import { checkForUpdate } from "../services/update-check";
import { agendaLines } from "../calendar/routines";
import { clip, defangLinks } from "../services/text";
import { formatLocal, localDayBounds, toLocalMinute } from "../services/time";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const SUMMARY_KEY = "alerts.digest.last";
/** When the owner last exported a backup; the activity log alone is pruned too soon to tell. */
export const BACKUP_KEY = "alerts.backup.last";
/** Most lines one section of the summary lists; the count says how many there are in all. */
const SECTION_LINES = 10;
const CATEGORY_NAMES: Record<AlertCategory, string> = {
  reminder: "Reminders", digest: "Digests", routine: "Routines", task: "Tasks", system: "System", security: "Security", event: "Events",
};

/** What one round of the watchers raised, by check, for the log and the tests. */
export interface WatchReport {
  raised: Record<string, number>;
  digest: boolean;
}

/** A task title as alert text: the owner's own words, but links never clickable. */
const taskName = (t: Task) => clip(defangLinks(t.title.replace(/\s+/g, " ").trim()), 120);

/**
 * One round of the watchers (every WATCH.everyMinutes, from a Durable Object alarm). Each check
 * is deterministic, uses no AI, and raises an alert only when something needs the owner; the
 * alert center's dedupe keys keep a repeat from going out again. The daily summary goes out from
 * here too, at its time. A check that fails never stops the others.
 */
export async function runWatchers(s: Services, now = new Date(), fetchFn: typeof fetch = fetch): Promise<WatchReport> {
  const prefs = s.alerts.preferences();
  const report: WatchReport = { raised: {}, digest: false };
  const count = (check: string, n: number | null | undefined) => {
    if (n) report.raised[check] = (report.raised[check] ?? 0) + n;
  };
  const guard = async (check: string, fn: () => number | Promise<number>) => {
    try {
      count(check, await fn());
    } catch (error) {
      console.warn("Watcher failed", check, error instanceof Error ? error.message : String(error));
    }
  };
  // A security rule, not a reminder: runs even with the watchers turned off.
  await guard("push-inactive", () => removeInactivePush(s, now));
  if (prefs.watchers) {
    await guard("tasks", () => watchTasks(s, now, prefs.digest.time));
    await guard("routines", () => watchRoutines(s));
    await guard("mcp", () => watchMcp(s));
    await guard("budget", () => watchBudget(s));
    await guard("push", () => watchPush(s));
    await guard("backup", () => watchBackup(s, now));
  }
  const digestDay = prefs.digest.enabled ? digestDue(s, prefs.digest.time, now) : null;
  if (digestDay) {
    try {
      // Once a day, with the summary: the update check calls npm, cached for a day.
      if (prefs.watchers) count("update", await watchUpdate(s, fetchFn));
      report.digest = sendDigest(s, now, digestDay, await agendaLines(s, now));
    } catch (error) {
      console.warn("Daily summary failed", error instanceof Error ? error.message : String(error));
    }
  }
  return report;
}

/**
 * Deadlines: due within the hour, overdue, due within 24 hours, and in progress with no change
 * for WATCH.stalledDays. An overdue task is told once a local day, after the summary's time (so
 * never at midnight), for its first WATCH.overdueDays: High on the first day, Normal after. At most
 * WATCH.maxTaskAlerts a round and WATCH.maxTaskAlertsPerDay a day, the most urgent first; the
 * keys end in the task's id, so finishing the task right after teaches the alert's priority.
 */
function watchTasks(s: Services, now: Date, dayStart: string): number {
  const tz = s.settings.get().timezone;
  const language = s.settings.language();
  const t = now.getTime();
  const local = toLocalMinute(now, tz);
  const day = local.slice(0, 10);
  const afterDayStart = minutesOf(local.slice(11)) >= minutesOf(dayStart);
  const since = new Date(t - DAY_MS).toISOString();
  const today = s.db.one<{ n: number }>(
    `SELECT count(*) AS n FROM tal_notifications WHERE category = 'task' AND dedupe_key LIKE 'task-%' AND created_at >= ?`,
    since,
  )?.n ?? 0;
  const room = Math.min(WATCH.maxTaskAlerts, WATCH.maxTaskAlertsPerDay - today);
  if (room <= 0) return 0;
  const open = s.tasks.list({ status: "open", limit: 500 });
  const when = (task: Task) => formatLocal(task.due_at, tz, language) ?? "";
  // rank: 0 due within the hour, 1 overdue (newest first), 2 due within 24 hours, 3 stalled.
  const candidates: { rank: number; order: number; raise: () => boolean }[] = [];
  const raise = (title: string, body: string, key: string, priority: "normal" | "high", cooldownMinutes: number) =>
    s.alerts.raise({ title, body, category: "task", priority, dedupeKey: key, cooldownMinutes }) !== null;
  for (const task of open) {
    const due = task.due_at ? Date.parse(task.due_at) : Number.NaN;
    if (!Number.isNaN(due)) {
      const name = taskName(task);
      if (due < t && t - due <= WATCH.overdueDays * DAY_MS) {
        if (afterDayStart) {
          const priority = t - due <= DAY_MS ? "high" : "normal";
          candidates.push({ rank: 1, order: t - due, raise: () => raise("Task overdue", `“${name}” was due ${when(task)}.`, `task-overdue:${day}:${task.id}`, priority, 24 * 60) });
        }
      } else if (due >= t && due - t <= WATCH.dueNowMinutes * MINUTE_MS) {
        candidates.push({ rank: 0, order: due - t, raise: () => raise("Task due within the hour", `“${name}” is due ${when(task)}.`, `task-due-1h:${task.id}`, "normal", 24 * 60) });
      } else if (due >= t && due - t <= WATCH.dueSoonHours * HOUR_MS) {
        candidates.push({ rank: 2, order: due - t, raise: () => raise("Task due in 24 hours", `“${name}” is due ${when(task)}.`, `task-due-24h:${task.id}`, "normal", 24 * 60) });
      }
    }
    if (task.status === "in_progress" && t - Date.parse(task.updated_at) >= WATCH.stalledDays * DAY_MS) {
      const days = Math.floor((t - Date.parse(task.updated_at)) / DAY_MS);
      candidates.push({
        rank: 3,
        order: -days,
        raise: () => raise("Task stalled", `“${taskName(task)}” has been in progress for ${days} days without changes.`, `task-stalled:${task.id}`, "normal", WATCH.stalledDays * 24 * 60),
      });
    }
  }
  candidates.sort((a, b) => a.rank - b.rank || a.order - b.order);
  let raised = 0;
  for (const c of candidates) {
    if (raised >= room) break;
    if (c.raise()) raised++;
  }
  return raised;
}

const minutesOf = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** A routine whose last two runs both failed. */
function watchRoutines(s: Services): number {
  let raised = 0;
  for (const a of s.automationsRepo.list()) {
    if (!a.enabled) continue;
    const runs = s.automationsRepo.runs({ automationId: a.id, limit: 2 });
    if (runs.length < 2 || !runs.every((r) => r.status === "error")) continue;
    const n = s.alerts.raise({
      title: "Routine failing",
      body: `“${clip(defangLinks(a.name), 120)}” failed its last 2 runs. See the error in Automations.`,
      category: "system",
      dedupeKey: `routine-failing:${a.id}`,
      cooldownMinutes: 24 * 60,
      automationId: a.id,
      profileKind: "routine-failing",
    });
    if (n) raised++;
  }
  return raised;
}

/** An MCP server that is turned on but lost its sign-in or keeps failing. */
function watchMcp(s: Services): number {
  if (!s.mcp.enabled) return 0;
  let raised = 0;
  for (const server of s.mcp.list()) {
    if (!server.enabled || (server.status !== "auth_required" && server.status !== "error")) continue;
    const name = clip(defangLinks(server.name), 80);
    const n = s.alerts.raise({
      title: "MCP server needs attention",
      body: server.status === "auth_required"
        ? `“${name}” needs you to sign in again. Open Settings → Integrations.`
        : `“${name}” is failing. Open Settings → Integrations to reconnect it.`,
      category: "system",
      dedupeKey: `mcp-down:${server.id}`,
      cooldownMinutes: 24 * 60,
    });
    if (n) raised++;
  }
  return raised;
}

/** The day's AI requests at WATCH.budgetWarnPercent, and used up (High). */
function watchBudget(s: Services): number {
  const max = s.settings.get().limits.maxAiRequestsPerDay;
  if (max <= 0) return 0;
  const used = s.usage.today().ai_requests;
  const day = s.usage.day();
  if (used >= max) {
    return s.alerts.raise({
      title: "AI budget used up",
      body: `Axis used all ${max} AI requests for today. Chat and AI routines resume tomorrow, or raise the limit in Settings → AI.`,
      category: "system",
      priority: "high",
      dedupeKey: `ai-budget-100:${day}`,
      cooldownMinutes: 24 * 60,
    }) ? 1 : 0;
  }
  if (used * 100 >= max * WATCH.budgetWarnPercent) {
    return s.alerts.raise({
      title: "AI budget almost used",
      body: `Axis used ${used} of today's ${max} AI requests.`,
      category: "system",
      dedupeKey: `ai-budget-80:${day}`,
      cooldownMinutes: 24 * 60,
    }) ? 1 : 0;
  }
  return 0;
}

/** Push is set up and every device keeps failing: alerts only reach Telegram and the app. */
function watchPush(s: Services): number {
  if (!s.push.configured()) return 0;
  const devices = s.push.subscriptions.devices();
  if (devices.length === 0 || !devices.every((d) => d.failures >= WATCH.pushFailures)) return 0;
  return s.alerts.raise({
    title: "Push notifications not arriving",
    body: "None of your devices received the last push notifications. Open Settings → Alerts and turn them on again on each device.",
    category: "system",
    dedupeKey: "push-broken",
    cooldownMinutes: 7 * 24 * 60,
  }) ? 1 : 0;
}

/**
 * Devices that have not opened Axis signed in for PUSH_INACTIVE_DAYS stop receiving push: a lost
 * or forgotten phone should not keep getting the owner's alerts. Each removal is logged, and the
 * owner is told (on the devices that remain, Telegram and the app) how to add it back.
 */
function removeInactivePush(s: Services, now: Date): number {
  const removed = s.push.subscriptions.removeUnseenSince(new Date(now.getTime() - PUSH_INACTIVE_DAYS * DAY_MS).toISOString());
  for (const d of removed) {
    const label = clip(defangLinks(d.label.replace(/\s+/g, " ").trim()), 100);
    s.activity.record("push.expired", `Removed ${label} from notifications after ${PUSH_INACTIVE_DAYS} days without use`);
    s.alerts.raise({
      title: "Push device removed for inactivity",
      body: `“${label}” had not opened Axis for ${PUSH_INACTIVE_DAYS} days and no longer receives push notifications. To get them again, open Axis on it and turn them on in Settings → Alerts.`,
      category: "system",
      dedupeKey: `push-inactive:${d.id}`,
      cooldownMinutes: 24 * 60,
    });
  }
  return removed.length;
}

/** No backup exported in WATCH.backupDays (counted from the first use when there was none). */
function watchBackup(s: Services, now: Date): number {
  const last = s.settings.getJson<string>(BACKUP_KEY)
    ?? s.db.one<{ at: string | null }>(`SELECT max(created_at) AS at FROM tal_activity WHERE type = 'data.exported'`)?.at
    ?? s.settings.getJson<string>("alerts.backup.since");
  if (!last) {
    // Never exported: start counting now, so a new install is not told on its first day.
    s.settings.setJson("alerts.backup.since", now.toISOString());
    return 0;
  }
  if (now.getTime() - Date.parse(last) < WATCH.backupDays * DAY_MS) return 0;
  return s.alerts.raise({
    title: "Time for a backup",
    body: `Your last backup is more than ${WATCH.backupDays} days old. Export one in Settings → Data.`,
    category: "system",
    priority: "low",
    dedupeKey: "backup-old",
    cooldownMinutes: WATCH.backupDays * 24 * 60,
  }) ? 1 : 0;
}

/** A newer Axis was published (only when the update check is on in Settings). */
async function watchUpdate(s: Services, fetchFn: typeof fetch): Promise<number> {
  const status = await checkForUpdate(s.settings, TALORYS_VERSION, fetchFn);
  if (!status.update_available || !status.latest) return 0;
  return s.alerts.raise({
    title: "Update available",
    body: `Axis ${status.latest} is available (you have ${status.current}). See how to update in the docs.`,
    category: "system",
    priority: "low",
    dedupeKey: `update:${status.latest}`,
    cooldownMinutes: 365 * 24 * 60,
  }) ? 1 : 0;
}

/**
 * The local day whose summary is due now, or null: its time (today's, or yesterday's for a time
 * just before midnight) has come within WATCH.digestGraceHours and that day's summary hasn't gone out.
 */
function digestDue(s: Services, time: string, now: Date): string | null {
  const tz = s.settings.get().timezone;
  const p = getZonedParts(now, tz);
  const last = s.settings.getJson<string>(SUMMARY_KEY);
  for (const back of [0, 1]) {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day - back));
    const target = zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), Number(time.slice(0, 2)), Number(time.slice(3, 5)), tz);
    const late = now.getTime() - target.getTime();
    const day = d.toISOString().slice(0, 10);
    if (late >= 0 && late <= WATCH.digestGraceHours * HOUR_MS) return last === day ? null : day;
  }
  return null;
}

/**
 * The daily summary: overdue tasks, tasks due today, today's events on the open Google calendars
 * (`agenda`), what is scheduled for today, the alerts that
 * stayed in the app (low priority) and, on Fridays, what the priority learned this week. Nothing
 * to tell, nothing sent. True when it went out.
 */
export function sendDigest(s: Services, now = new Date(), day = toLocalMinute(now, s.settings.get().timezone).slice(0, 10), agenda: string[] = []): boolean {
  const settings = s.settings.get();
  const tz = settings.timezone;
  const language = s.settings.language();
  s.settings.setJson(SUMMARY_KEY, day);
  const bounds = localDayBounds(tz, now);
  const line = (t: Task) => {
    const date = formatLocal(t.due_at, tz, language);
    const urgent = t.priority === "high" || t.priority === "urgent";
    const name = taskName(t);
    return date ? `- ${name} (due ${date})${urgent ? ` · ${t.priority}` : ""}` : `- ${name}${urgent ? ` · ${t.priority}` : ""}`;
  };
  const section = (header: string, lines: string[]) =>
    lines.length ? `**${header} (${lines.length})**\n${lines.slice(0, SECTION_LINES).join("\n")}${lines.length > SECTION_LINES ? `\n- …` : ""}` : "";
  // Compared as instants: a stored time may carry an offset instead of Z.
  const t = now.getTime();
  const end = Date.parse(bounds.end);
  const within = (iso: string | null) => {
    const at = iso ? Date.parse(iso) : Number.NaN;
    return at >= t && at < end;
  };
  // Sorted by due date, nearest first.
  const open = s.tasks.list({ status: "open", limit: 500 });
  const overdue = open.filter((task) => task.due_at !== null && Date.parse(task.due_at) < t);
  const today = open.filter((task) => within(task.due_at));
  const scheduled = s.automationsRepo
    .list()
    .filter((a) => a.enabled && within(a.next_run))
    .sort((a, b) => Date.parse(a.next_run!) - Date.parse(b.next_run!))
    .map((a) => `- ${toLocalMinute(new Date(a.next_run!), tz).slice(11)} · ${clip(defangLinks(a.name), 80)}`);
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const waiting = s.notifications
    .list({ unreadOnly: true, limit: 100 })
    .filter((n) => n.priority === "low" && n.created_at >= since)
    .map((n) => `- ${clip(n.title, 120)} (unread)`);
  const parts = [
    section("Overdue", overdue.map(line)),
    section("Due today", today.map(line)),
    section("Calendar today", agenda),
    section("Scheduled today", scheduled),
    section("Waiting in the app", waiting),
  ];
  // Friday: what the priority learned in the week.
  const p = getZonedParts(now, tz);
  if (new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() === 5) {
    const learned = s.alerts.learnedSince(new Date(now.getTime() - 7 * DAY_MS).toISOString()).map((profile) => {
      const name = profile.label ? `“${clip(profile.label, 80)}”` : CATEGORY_NAMES[profile.category];
      return profile.last_change === 1 ? `- ${name} one level louder` : `- ${name} one level quieter`;
    });
    parts.push(learned.length ? `**Priority learned this week**\n${learned.slice(0, SECTION_LINES).join("\n")}` : "");
  }
  const body = parts.filter(Boolean).join("\n\n");
  if (!body) return false;
  return s.alerts.raise({ title: "Daily summary", body, category: "digest", dedupeKey: `daily-digest:${day}`, cooldownMinutes: 20 * 60 }) !== null;
}
