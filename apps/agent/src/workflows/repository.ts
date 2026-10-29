import {
  WORKFLOW_DEFAULTS,
  WORKFLOW_KEYS,
  WORKFLOW_LIMITS,
  type ScheduleSpec,
  type WorkflowConfig,
  type WorkflowKey,
  type WorkflowRun,
  type WorkflowRunStatus,
} from "@talorys/shared";
import { type Database, newId, now } from "../db/database";

export interface WorkflowRow {
  key: WorkflowKey;
  enabled: boolean;
  schedule: ScheduleSpec;
  config: WorkflowConfig;
  memory: Record<string, unknown>;
  schedule_id: string | null;
  next_run: string | null;
  updated_at: string | null;
}

interface StoredRow {
  key: string;
  enabled: number;
  schedule: string;
  config: string;
  memory: string;
  schedule_id: string | null;
  next_run: string | null;
  updated_at: string;
}

const parse = <T>(text: string, fallback: T): T => {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};

/** Workflow settings and run history. A workflow the owner never touched reads as its catalog defaults. */
export class WorkflowRepository {
  constructor(private readonly db: Database) {}

  get(key: WorkflowKey): WorkflowRow {
    const row = this.db.one<StoredRow>(`SELECT * FROM tal_workflows WHERE key = ?`, key);
    const defaults = WORKFLOW_DEFAULTS[key];
    if (!row) return { key, enabled: false, schedule: defaults.schedule, config: defaults.config, memory: {}, schedule_id: null, next_run: null, updated_at: null };
    return {
      key,
      enabled: row.enabled === 1,
      schedule: parse(row.schedule, defaults.schedule),
      config: { ...defaults.config, ...parse<object>(row.config, {}) } as WorkflowConfig,
      memory: parse(row.memory, {}),
      schedule_id: row.schedule_id,
      next_run: row.next_run,
      updated_at: row.updated_at,
    };
  }

  all(): WorkflowRow[] {
    return WORKFLOW_KEYS.map((key) => this.get(key));
  }

  save(key: WorkflowKey, patch: Partial<Omit<WorkflowRow, "key" | "updated_at">>): WorkflowRow {
    const next = { ...this.get(key), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as WorkflowRow;
    this.db.run(
      `INSERT INTO tal_workflows (key, enabled, schedule, config, memory, schedule_id, next_run, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled, schedule = excluded.schedule, config = excluded.config, memory = excluded.memory,
         schedule_id = excluded.schedule_id, next_run = excluded.next_run, updated_at = excluded.updated_at`,
      key, next.enabled ? 1 : 0, JSON.stringify(next.schedule), JSON.stringify(next.config), JSON.stringify(next.memory),
      next.schedule_id, next.next_run, now(),
    );
    return this.get(key);
  }

  startRun(key: WorkflowKey, trigger: WorkflowRun["trigger"], status: WorkflowRunStatus = "running", text: { result?: string; error?: string } = {}): WorkflowRun {
    const run: WorkflowRun = {
      id: newId(),
      workflow_key: key,
      trigger,
      status,
      result: text.result ?? null,
      error: text.error ?? null,
      started_at: now(),
      finished_at: status === "running" ? null : now(),
    };
    this.db.run(
      `INSERT INTO tal_workflow_runs (id, workflow_key, trigger, status, result, error, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      run.id, run.workflow_key, run.trigger, run.status, run.result, run.error, run.started_at, run.finished_at,
    );
    this.prune(key);
    return run;
  }

  run(id: string): WorkflowRun | null {
    return this.db.one<WorkflowRun>(`SELECT * FROM tal_workflow_runs WHERE id = ?`, id);
  }

  /** Ends a run that is still running; false when it already ended (a late or repeated callback). */
  finishRun(id: string, status: Exclude<WorkflowRunStatus, "running">, text: { result?: string | null; error?: string | null }): boolean {
    return this.db.run(
      `UPDATE tal_workflow_runs SET status = ?, result = ?, error = ?, finished_at = ? WHERE id = ? AND status = 'running'`,
      status, text.result ?? null, text.error ?? null, now(), id,
    ).changes > 0;
  }

  runs(opts: { key?: WorkflowKey; limit: number }): WorkflowRun[] {
    return opts.key
      ? this.db.all<WorkflowRun>(`SELECT * FROM tal_workflow_runs WHERE workflow_key = ? ORDER BY started_at DESC, rowid DESC LIMIT ?`, opts.key, opts.limit)
      : this.db.all<WorkflowRun>(`SELECT * FROM tal_workflow_runs ORDER BY started_at DESC, rowid DESC LIMIT ?`, opts.limit);
  }

  running(key: WorkflowKey): WorkflowRun | null {
    return this.db.one<WorkflowRun>(`SELECT * FROM tal_workflow_runs WHERE workflow_key = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1`, key);
  }

  /** Runs still "running" that started before `before`: their workflow was lost. */
  stale(before: string): WorkflowRun[] {
    return this.db.all<WorkflowRun>(`SELECT * FROM tal_workflow_runs WHERE status = 'running' AND started_at < ?`, before);
  }

  stats(key: WorkflowKey): { count: number; last: WorkflowRun | null } {
    const count = this.db.one<{ n: number }>(`SELECT count(*) AS n FROM tal_workflow_runs WHERE workflow_key = ? AND status != 'running'`, key)?.n ?? 0;
    const last = this.db.one<WorkflowRun>(
      `SELECT * FROM tal_workflow_runs WHERE workflow_key = ? AND status != 'running' ORDER BY started_at DESC, rowid DESC LIMIT 1`, key,
    );
    return { count, last };
  }

  private prune(key: WorkflowKey): void {
    this.db.run(
      `DELETE FROM tal_workflow_runs WHERE workflow_key = ? AND id NOT IN (
         SELECT id FROM tal_workflow_runs WHERE workflow_key = ? ORDER BY started_at DESC, rowid DESC LIMIT ?)`,
      key, key, WORKFLOW_LIMITS.runsKept,
    );
  }
}
