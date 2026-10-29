import {
  type AlertCategory,
  type AlertEscalation,
  type AlertPriority,
  type AutomationPriority,
  type Automation,
  type AutomationKind,
  type AutomationRun,
  type Notification,
  type ScheduleSpec,
  describeSchedule,
} from "@talorys/shared";
import { type Database, newId, now } from "../database";
import { NotFoundError } from "../../api/errors";

interface AutomationRow extends Omit<Automation, "schedule" | "enabled" | "schedule_description"> {
  schedule: string;
  enabled: number;
}

function toAutomation(row: AutomationRow): Automation {
  const schedule = JSON.parse(row.schedule) as ScheduleSpec;
  return { ...row, schedule, enabled: row.enabled === 1, schedule_description: describeSchedule(schedule) };
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

  create(input: { name: string; kind: AutomationKind; message: string; schedule: ScheduleSpec; enabled: boolean; priority?: AutomationPriority }): Automation {
    const ts = now();
    const id = newId();
    this.db.run(
      `INSERT INTO tal_automations (id, name, kind, message, schedule, enabled, priority, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, input.name, input.kind, input.message, JSON.stringify(input.schedule), input.enabled ? 1 : 0,
      input.priority ?? "normal", input.enabled ? "scheduled" : "paused", ts, ts,
    );
    return this.require(id);
  }

  update(id: string, patch: Partial<Omit<Automation, "id" | "created_at" | "schedule_description">>): Automation {
    const existing = this.require(id);
    const next = { ...existing, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as Automation;
    this.db.run(
      `UPDATE tal_automations SET name = ?, kind = ?, message = ?, schedule = ?, enabled = ?, priority = ?, status = ?, schedule_id = ?,
         next_run = ?, last_run = ?, last_result = ?, last_error = ?, run_count = ?, updated_at = ? WHERE id = ?`,
      next.name, next.kind, next.message, JSON.stringify(next.schedule), next.enabled ? 1 : 0, next.priority, next.status,
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
const COLUMNS = "id, title, body, automation_id, priority, category, read_at, escalation, attempts, next_attempt_at, created_at";

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
      created_at: now(),
    };
    this.db.run(
      `INSERT INTO tal_notifications (id, title, body, automation_id, priority, category, dedupe_key, read_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      n.id, n.title, n.body, n.automation_id, n.priority, n.category, input.dedupe_key ?? null, n.created_at,
    );
    this.db.run(
      `DELETE FROM tal_notifications WHERE id NOT IN (SELECT id FROM tal_notifications ORDER BY created_at DESC LIMIT 500)`,
    );
    return n;
  }

  /** True when a notification with this key was created at or after `since` (ISO time). */
  raisedSince(dedupeKey: string, since: string): boolean {
    return !!this.db.one(`SELECT 1 AS x FROM tal_notifications WHERE dedupe_key = ? AND created_at >= ? LIMIT 1`, dedupeKey, since);
  }

  setPriority(id: string, priority: AlertPriority): Notification | null {
    this.db.run(`UPDATE tal_notifications SET priority = ? WHERE id = ?`, priority, id);
    return this.get(id);
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

  /** Alerts insisting right now, security alerts aside. */
  activeEscalations(): number {
    return this.db.one<{ n: number }>(`SELECT count(*) AS n FROM tal_notifications WHERE escalation = 'active' AND category != 'security'`)?.n ?? 0;
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
