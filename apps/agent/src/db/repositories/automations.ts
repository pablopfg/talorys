import {
  type AlertCategory,
  type AlertEscalation,
  type AlertPriority,
  type AutomationPriority,
  type Automation,
  type AutomationKind,
  type AutomationRun,
  type Notification,
  type PriorityReason,
  type ScheduleSpec,
  describeSchedule,
} from "@talorys/shared";
import { type Database, newId, now } from "../database";
import { NotFoundError } from "../../api/errors";

interface AutomationRow extends Omit<Automation, "schedule" | "enabled" | "schedule_description" | "sentinel"> {
  schedule: string;
  enabled: number;
  sentinel: number;
}

function toAutomation(row: AutomationRow): Automation {
  const schedule = JSON.parse(row.schedule) as ScheduleSpec;
  return { ...row, schedule, enabled: row.enabled === 1, sentinel: row.sentinel === 1, schedule_description: describeSchedule(schedule) };
}

export class AutomationRepository {
  constructor(private readonly db: Database) {}

  list(): Automation[] {
    return this.db
      .all<AutomationRow>(`SELECT * FROM tal_automations ORDER BY enabled DESC, next_run IS NULL, next_run ASC, created_at DESC`)
      .map(toAutomation);
  }

  get(id: string): Automation | null {
    const row = this.db.one<AutomationRow>(`SELECT * FROM tal_automations WHERE id = ?`, id);
    return row ? toAutomation(row) : null;
  }

  require(id: string): Automation {
    const a = this.get(id);
    if (!a) throw new NotFoundError("Automation not found");
    return a;
  }

  create(input: { name: string; kind: AutomationKind; message: string; schedule: ScheduleSpec; enabled: boolean; priority?: AutomationPriority; sentinel?: boolean }): Automation {
    const ts = now();
    const id = newId();
    this.db.run(
      `INSERT INTO tal_automations (id, name, kind, message, schedule, enabled, priority, sentinel, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, input.name, input.kind, input.message, JSON.stringify(input.schedule), input.enabled ? 1 : 0,
      input.priority ?? "normal", input.sentinel ? 1 : 0, input.enabled ? "scheduled" : "paused", ts, ts,
    );
    return this.require(id);
  }

  update(id: string, patch: Partial<Omit<Automation, "id" | "created_at" | "schedule_description">>): Automation {
    const existing = this.require(id);
    const next = { ...existing, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as Automation;
    this.db.run(
      `UPDATE tal_automations SET name = ?, kind = ?, message = ?, schedule = ?, enabled = ?, priority = ?, sentinel = ?, status = ?, schedule_id = ?,
         next_run = ?, last_run = ?, last_result = ?, last_error = ?, run_count = ?, updated_at = ? WHERE id = ?`,
      next.name, next.kind, next.message, JSON.stringify(next.schedule), next.enabled ? 1 : 0, next.priority, next.sentinel ? 1 : 0, next.status,
      next.schedule_id, next.next_run, next.last_run, next.last_result, next.last_error, next.run_count, now(), id,
    );
    return this.require(id);
  }

  delete(id: string): void {
    this.db.run(`DELETE FROM tal_automations WHERE id = ?`, id);
  }

  startRun(automation: Automation): AutomationRun {
    const run: AutomationRun = {
      id: newId(),
      automation_id: automation.id,
      automation_name: automation.name,
      started_at: now(),
      finished_at: null,
      status: "running",
      result: null,
      error: null,
    };
    this.db.run(
      `INSERT INTO tal_automation_runs (id, automation_id, automation_name, started_at, status) VALUES (?, ?, ?, ?, ?)`,
      run.id, run.automation_id, run.automation_name, run.started_at, run.status,
    );
    return run;
  }

  finishRun(runId: string, status: AutomationRun["status"], result: string | null, error: string | null): void {
    this.db.run(
      `UPDATE tal_automation_runs SET finished_at = ?, status = ?, result = ?, error = ? WHERE id = ?`,
      now(), status, result, error, runId,
    );
  }

  /** Newest first. `before` pages backwards by `started_at`. */
  runs(opts: { limit?: number; status?: string; automationId?: string; before?: string } = {}): AutomationRun[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (opts.status) { where.push("status = ?"); args.push(opts.status); }
    if (opts.automationId) { where.push("automation_id = ?"); args.push(opts.automationId); }
    if (opts.before) { where.push("started_at < ?"); args.push(opts.before); }
    return this.db.all<AutomationRun>(
      `SELECT * FROM tal_automation_runs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY started_at DESC LIMIT ?`,
      ...args, opts.limit ?? 50,
    );
  }

  getRun(id: string): AutomationRun | null {
    return this.db.one<AutomationRun>(`SELECT * FROM tal_automation_runs WHERE id = ?`, id) ?? null;
  }

  /** Marks runs cut off by a restart as failed, except those still executing. */
  closeInterruptedRuns(activeAutomationIds: string[] = []): number {
    const runs = this.db.all<{ id: string; automation_id: string }>(
      `SELECT id, automation_id FROM tal_automation_runs WHERE status = 'running'`,
    ).filter((r) => !activeAutomationIds.includes(r.automation_id));
    for (const r of runs) this.finishRun(r.id, "error", null, "Interrupted before it finished.");
    return runs.length;
  }

  /** Keeps the run history bounded. */
  pruneRuns(keep = 500): void {
    this.db.run(
      `DELETE FROM tal_automation_runs WHERE id NOT IN (SELECT id FROM tal_automation_runs ORDER BY started_at DESC LIMIT ?)`,
      keep,
    );
  }
}

/** Everything the API returns; dedupe_key stays internal. */
const COLUMNS = "id, title, body, automation_id, priority, category, read_at, escalation, attempts, next_attempt_at, profile, priority_reason, created_at";

/** What the owner did with an alert, as one learning signal (see AlertLearning). */
export type AlertSignal = "fast" | "read" | "slow" | "snooze" | "mute" | "ignored" | "task";

/** Notifications kept: the newest ones, and the newest security alerts on top of those. */
export const MAX_NOTIFICATIONS = 500;
export const MAX_SECURITY_NOTIFICATIONS = 200;

export class NotificationRepository {
  constructor(private readonly db: Database) {}

  list(opts: { unreadOnly?: boolean; limit?: number } = {}): Notification[] {
    return this.db.all<Notification>(
      `SELECT ${COLUMNS} FROM tal_notifications ${opts.unreadOnly ? "WHERE read_at IS NULL" : ""} ORDER BY created_at DESC LIMIT ?`,
      opts.limit ?? 100,
    );
  }

  get(id: string): Notification | null {
    return this.db.one<Notification>(`SELECT ${COLUMNS} FROM tal_notifications WHERE id = ?`, id) ?? null;
  }

  unreadCount(): number {
    return this.db.one<{ n: number }>(`SELECT count(*) AS n FROM tal_notifications WHERE read_at IS NULL`)?.n ?? 0;
  }

  /**
   * Stores a notification. Only the alert center (AlertService.raise) calls this, so that every
   * notification also gets its priority, its channels and the anti-spam rules.
   */
  create(input: {
    title: string;
    body: string;
    automation_id?: string | null;
    priority?: AlertPriority;
    category?: AlertCategory;
    dedupe_key?: string | null;
    profile?: string | null;
    priority_reason?: PriorityReason | null;
  }): Notification {
    const n: Notification = {
      id: newId(),
      title: input.title,
      body: input.body,
      automation_id: input.automation_id ?? null,
      priority: input.priority ?? "normal",
      category: input.category ?? "system",
      read_at: null,
      escalation: null,
      attempts: 1,
      next_attempt_at: null,
      profile: input.profile ?? null,
      priority_reason: input.priority_reason ?? null,
      created_at: now(),
    };
    this.db.run(
      `INSERT INTO tal_notifications (id, title, body, automation_id, priority, category, dedupe_key, profile, priority_reason, read_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      n.id, n.title, n.body, n.automation_id, n.priority, n.category, input.dedupe_key ?? null, n.profile, n.priority_reason, n.created_at,
    );
    // Security alerts are kept apart, so a flood of other alerts can't push them out of the record.
    this.db.run(
      `DELETE FROM tal_notifications WHERE category != 'security'
         AND id NOT IN (SELECT id FROM tal_notifications WHERE category != 'security' ORDER BY created_at DESC LIMIT ?)`,
      MAX_NOTIFICATIONS,
    );
    this.db.run(
      `DELETE FROM tal_notifications WHERE category = 'security'
         AND id NOT IN (SELECT id FROM tal_notifications WHERE category = 'security' ORDER BY created_at DESC LIMIT ?)`,
      MAX_SECURITY_NOTIFICATIONS,
    );
    return n;
  }

  /** True when a notification with this key was created at or after `since` (ISO time). */
  raisedSince(dedupeKey: string, since: string): boolean {
    return !!this.db.one(`SELECT 1 AS x FROM tal_notifications WHERE dedupe_key = ? AND created_at >= ? LIMIT 1`, dedupeKey, since);
  }

  setPriority(id: string, priority: AlertPriority, reason: PriorityReason | null = null): Notification | null {
    this.db.run(`UPDATE tal_notifications SET priority = ?, priority_reason = coalesce(?, priority_reason) WHERE id = ?`, priority, reason, id);
    return this.get(id);
  }

  /** Records the one behaviour signal an alert gives; false when it already gave one. */
  claimSignal(id: string, signal: AlertSignal): boolean {
    return this.db.run(`UPDATE tal_notifications SET signal = ? WHERE id = ? AND signal IS NULL AND profile IS NOT NULL`, signal, id).changes > 0;
  }

  /** Alerts of a profile still unread and without a signal, raised before `before` (ISO time). */
  unanswered(profile: string, before: string, limit = 20): Notification[] {
    return this.db.all<Notification>(
      `SELECT ${COLUMNS} FROM tal_notifications
       WHERE profile = ? AND read_at IS NULL AND signal IS NULL AND created_at < ? ORDER BY created_at LIMIT ?`,
      profile, before, limit,
    );
  }

  /** The latest alert about a task (its dedupe key ends in `:<task id>`) raised at or after `since`. */
  latestForTask(taskId: string, since: string): Notification | null {
    return (
      this.db.one<Notification>(
        `SELECT ${COLUMNS} FROM tal_notifications
         WHERE dedupe_key LIKE 'task-%' AND substr(dedupe_key, -length(?) - 1) = ':' || ? AND created_at >= ?
         ORDER BY created_at DESC LIMIT 1`,
        taskId, taskId, since,
      ) ?? null
    );
  }

  /** Reading an alert confirms it: an alert still insisting stops. */
  markRead(id?: string): void {
    const ts = now();
    if (id) {
      this.db.run(`UPDATE tal_notifications SET read_at = ? WHERE id = ? AND read_at IS NULL`, ts, id);
      this.acknowledge(id);
    } else {
      this.db.run(`UPDATE tal_notifications SET read_at = ? WHERE read_at IS NULL`, ts);
      this.acknowledge();
    }
  }

  /**
   * Stops the insistence of one alert, or of every alert, as confirmed by the owner. Security
   * alerts stop only with `outOfBand` (an answer from Telegram). True if one stopped.
   */
  acknowledge(id?: string, opts: { outOfBand?: boolean } = {}): boolean {
    let sql = `UPDATE tal_notifications SET escalation = 'acknowledged', next_attempt_at = NULL WHERE escalation = 'active'`;
    if (!opts.outOfBand) sql += ` AND category != 'security'`;
    return (id ? this.db.run(`${sql} AND id = ?`, id) : this.db.run(sql)).changes > 0;
  }

  /** Alerts insisting right now, security alerts aside (or only those of `category`). */
  activeEscalations(category?: AlertCategory): number {
    return (category
      ? this.db.one<{ n: number }>(`SELECT count(*) AS n FROM tal_notifications WHERE escalation = 'active' AND category = ?`, category)?.n
      : this.db.one<{ n: number }>(`SELECT count(*) AS n FROM tal_notifications WHERE escalation = 'active' AND category != 'security'`)?.n) ?? 0;
  }

  /** Records the insistence state of an alert. */
  setEscalation(id: string, escalation: AlertEscalation | null, attempts: number, nextAttemptAt: string | null): void {
    this.db.run(
      `UPDATE tal_notifications SET escalation = ?, attempts = ?, next_attempt_at = ? WHERE id = ?`,
      escalation, attempts, nextAttemptAt, id,
    );
  }

  /** Alerts still insisting whose next step was due at or before `before` (ISO time). */
  dueEscalations(before: string, limit = 50): Notification[] {
    return this.db.all<Notification>(
      `SELECT ${COLUMNS} FROM tal_notifications WHERE escalation = 'active' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?`,
      before, limit,
    );
  }

  delete(id: string): void {
    this.db.run(`DELETE FROM tal_notifications WHERE id = ?`, id);
  }
}
