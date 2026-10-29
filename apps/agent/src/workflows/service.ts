import {
  computeNextRun,
  describeSchedule,
  type FeedRead,
  type SiteCheck,
  WORKFLOW_CONFIG_SCHEMAS,
  WORKFLOW_KEYS,
  WORKFLOW_LIMITS,
  type Workflow,
  type WorkflowConfig,
  type WorkflowKey,
  type WorkflowReport,
  type WorkflowRun,
  type WorkflowUpdate,
  workflowScheduleSchema,
} from "@talorys/shared";
import { AppError, ValidationError } from "../api/errors";
import type { AlertService } from "../alerts/service";
import type { SettingsService } from "../services/settings";
import { clip, unlinked } from "../services/text";
import { formatLocal } from "../services/time";
import type { ActivityLog } from "../services/usage";
import { workflowUrl } from "./network";
import type { WorkflowRepository, WorkflowRow } from "./repository";

/** Starts a workflow instance on Cloudflare. Unavailable when the deployment has no Workflows binding. */
export interface WorkflowLauncher {
  available(): boolean;
  start(key: WorkflowKey, runId: string, config: WorkflowConfig): Promise<void>;
  /** Drops the platform's tracking row of a finished run (the history lives in tal_workflow_runs). */
  forget(runId: string): void;
}

/** One pending alarm per enabled workflow, for its next run (Agents SDK schedule). */
export interface WorkflowTimer {
  schedule(at: Date, key: WorkflowKey): Promise<string>;
  cancel(scheduleId: string): Promise<void>;
  exists(scheduleId: string): Promise<boolean>;
}

export const WORKFLOW_NAMES: Record<WorkflowKey, string> = {
  site_monitor: "Site monitor",
  feed_digest: "Feed news",
};

const UNAVAILABLE = "Cloudflare Workflows is not set up in this deployment. Add the workflows binding and deploy again.";

interface SiteMemory {
  sites?: Record<string, { failures: number; down: boolean; since?: string }>;
}
interface FeedMemory {
  /** `primed` once a read succeeded: until then a read only learns what is there. */
  feeds?: Record<string, { seen: string[]; failures: number; primed?: boolean }>;
}

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * Turns workflows on and off, schedules their runs and turns what a run found into alerts.
 * The network work (checking sites, reading feeds) happens in the workflow itself, with
 * retries; it reports back here, where the memory between runs and the alerts live.
 */
export class WorkflowService {
  /** Last "Run now" per workflow, so tapping can't start runs back to back. */
  private readonly manualAt = new Map<WorkflowKey, number>();

  constructor(
    private readonly repo: WorkflowRepository,
    private readonly settings: SettingsService,
    private readonly activity: ActivityLog,
    private readonly alerts: Pick<AlertService, "raise">,
    private readonly timer: WorkflowTimer,
    private readonly launcher: WorkflowLauncher,
    private readonly development: boolean,
  ) {}

  available(): boolean {
    return this.launcher.available();
  }

  list(): Workflow[] {
    return WORKFLOW_KEYS.map((key) => this.view(this.repo.get(key)));
  }

  get(key: WorkflowKey): Workflow {
    return this.view(this.repo.get(key));
  }

  runs(key?: WorkflowKey, limit = 20): WorkflowRun[] {
    return this.repo.runs({ key, limit });
  }

  private view(row: WorkflowRow): Workflow {
    const { count, last } = this.repo.stats(row.key);
    return {
      key: row.key,
      enabled: row.enabled,
      schedule: row.schedule,
      schedule_description: describeSchedule(row.schedule),
      config: row.config,
      next_run: row.enabled ? row.next_run : null,
      last_run: last?.started_at ?? null,
      last_status: this.repo.running(row.key) ? "running" : (last?.status ?? null),
      last_result: last?.result ?? null,
      last_error: last?.error ?? null,
      run_count: count,
      updated_at: row.updated_at,
    };
  }

  /** The owner's settings for a workflow, checked against its own schema; addresses must be public https://. */
  private checkConfig(key: WorkflowKey, raw: unknown): WorkflowConfig {
    const parsed = WORKFLOW_CONFIG_SCHEMAS[key].safeParse(raw);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
    const config = parsed.data;
    const urls = "urls" in config ? config.urls : config.feeds;
    for (const url of urls) workflowUrl(url, { development: this.development });
    return config;
  }

  private checkReady(key: WorkflowKey, config: WorkflowConfig): void {
    const urls = "urls" in config ? config.urls : config.feeds;
    if (urls.length === 0) {
      throw new ValidationError(key === "site_monitor" ? "Add at least one site to monitor." : "Add at least one feed to read.");
    }
  }

  async update(key: WorkflowKey, patch: WorkflowUpdate): Promise<Workflow> {
    const existing = this.repo.get(key);
    const config = patch.config !== undefined ? this.checkConfig(key, patch.config) : existing.config;
    const schedule = patch.schedule !== undefined ? workflowScheduleSchema.parse(patch.schedule) : existing.schedule;
    const enabled = patch.enabled ?? existing.enabled;
    if (enabled) {
      this.checkReady(key, config);
      if (!this.available()) throw new AppError("NOT_CONFIGURED", UNAVAILABLE);
    }
    let row = this.repo.save(key, { config, schedule, enabled });
    const timing = patch.schedule !== undefined || enabled !== existing.enabled;
    if (timing || (enabled && !existing.schedule_id)) {
      if (existing.schedule_id) await this.timer.cancel(existing.schedule_id);
      row = enabled ? await this.arm(row) : this.repo.save(key, { schedule_id: null, next_run: null });
    }
    if (enabled !== existing.enabled) {
      this.activity.record(enabled ? "workflow.enabled" : "workflow.disabled", `${enabled ? "Turned on" : "Turned off"} workflow “${WORKFLOW_NAMES[key]}”`);
    } else if (patch.config !== undefined || patch.schedule !== undefined) {
      this.activity.record("workflow.updated", `Changed workflow “${WORKFLOW_NAMES[key]}”`);
    }
    return this.view(row);
  }

  private async arm(row: WorkflowRow, after = new Date()): Promise<WorkflowRow> {
    const next = computeNextRun(row.schedule, this.settings.get().timezone, after);
    if (!next) return this.repo.save(row.key, { schedule_id: null, next_run: null });
    const scheduleId = await this.timer.schedule(next, row.key);
    return this.repo.save(row.key, { schedule_id: scheduleId, next_run: next.toISOString() });
  }

  /** After a restart or a timezone change: one pending alarm per enabled workflow, and lost runs closed. */
  async reconcile(): Promise<number> {
    let repaired = 0;
    for (const row of this.repo.all()) {
      if (!row.enabled) continue;
      if (row.schedule_id && (await this.timer.exists(row.schedule_id))) continue;
      await this.arm(row);
      repaired++;
    }
    const before = new Date(Date.now() - WORKFLOW_LIMITS.runTimeoutMinutes * 60_000).toISOString();
    for (const run of this.repo.stale(before)) {
      this.repo.finishRun(run.id, "error", { error: "The run stopped answering and was given up." });
      this.launcher.forget(run.id);
    }
    return repaired;
  }

  /** Re-arms every enabled workflow from now, e.g. after the timezone changed. */
  async rearmAll(): Promise<void> {
    for (const row of this.repo.all()) {
      if (row.schedule_id) await this.timer.cancel(row.schedule_id);
      if (row.enabled) await this.arm(row);
      else if (row.schedule_id) this.repo.save(row.key, { schedule_id: null, next_run: null });
    }
  }

  /** The alarm for a workflow's next run. A stale alarm (the schedule changed since) is ignored. */
  async fire(key: WorkflowKey, scheduleId: string): Promise<void> {
    const row = this.repo.get(key);
    if (!row.enabled || row.schedule_id !== scheduleId) return;
    try {
      await this.launch(row, "schedule");
    } finally {
      // Unless it was turned off or rescheduled meanwhile: strictly after the run time that just
      // fired, so a fast clock never fires twice.
      const now = this.repo.get(key);
      if (now.enabled && now.schedule_id === scheduleId) {
        await this.arm(now, new Date(Math.max(Date.now(), Date.parse(row.next_run ?? "") || 0) + 1000));
      }
    }
  }

  /** "Run now" from the app; on or off, with the settings saved. */
  async runNow(key: WorkflowKey): Promise<WorkflowRun> {
    const row = this.repo.get(key);
    this.checkReady(key, row.config);
    const last = this.manualAt.get(key) ?? 0;
    const wait = Math.ceil((last + WORKFLOW_LIMITS.manualEverySeconds * 1000 - Date.now()) / 1000);
    if (wait > 0) {
      throw new AppError("RATE_LIMITED", `Wait ${wait} seconds before running this workflow again.`, { retry_after: wait }, { "retry-after": String(wait) });
    }
    this.manualAt.set(key, Date.now());
    return this.launch(row, "manual");
  }

  private async launch(row: WorkflowRow, trigger: WorkflowRun["trigger"]): Promise<WorkflowRun> {
    if (!this.available()) return this.repo.startRun(row.key, trigger, "error", { error: UNAVAILABLE });
    const running = this.repo.running(row.key);
    const before = new Date(Date.now() - WORKFLOW_LIMITS.runTimeoutMinutes * 60_000).toISOString();
    if (running && running.started_at >= before) {
      return this.repo.startRun(row.key, trigger, "skipped", { result: "The previous run is still going." });
    }
    if (running) this.repo.finishRun(running.id, "error", { error: "The run stopped answering and was given up." });
    const run = this.repo.startRun(row.key, trigger);
    try {
      await this.launcher.start(row.key, run.id, row.config);
    } catch (error) {
      console.error("Workflow start failed", error instanceof Error ? error.message : String(error));
      this.repo.finishRun(run.id, "error", { error: "Cloudflare could not start the workflow. Try again later." });
    }
    return this.repo.run(run.id) ?? run;
  }

  /** What a run found, sent by its last step. Repeated or late reports change nothing. */
  report(runId: string, report: WorkflowReport): void {
    const run = this.repo.run(runId);
    if (run?.status !== "running" || run.workflow_key !== report.key) return;
    const result = report.key === "site_monitor" ? this.sites(report.checks) : this.feeds(report.feeds);
    this.repo.finishRun(runId, "success", { result });
    this.launcher.forget(runId);
  }

  /** A run that failed on the platform (a step out of retries, a crash). */
  fail(runId: string, error: string): void {
    const run = this.repo.run(runId);
    if (!run || !this.repo.finishRun(runId, "error", { error: "The workflow failed on Cloudflare." })) return;
    console.warn("Workflow run failed", run.workflow_key, clip(error, 300));
    this.launcher.forget(runId);
    this.alerts.raise({
      title: `Workflow failed: ${WORKFLOW_NAMES[run.workflow_key]}`,
      body: "A run of this workflow failed on Cloudflare. See its history in Workflows.",
      category: "system",
      dedupeKey: `workflow-failed:${run.workflow_key}`,
      cooldownMinutes: 6 * 60,
    });
  }

  private sites(checks: SiteCheck[]): string {
    const row = this.repo.get("site_monitor");
    const configured = new Set("urls" in row.config ? row.config.urls : []);
    const before = (row.memory as SiteMemory).sites ?? {};
    const sites: NonNullable<SiteMemory["sites"]> = {};
    for (const [url, state] of Object.entries(before)) if (configured.has(url)) sites[url] = state;
    let up = 0;
    for (const check of checks.filter((c) => configured.has(c.url))) {
      const state = sites[check.url] ?? { failures: 0, down: false };
      if (check.ok) {
        up++;
        if (state.down) {
          this.alerts.raise({
            title: `Site back up: ${host(check.url)}`,
            body: state.since ? `It was down since ${formatLocal(state.since, this.settings.get().timezone, this.settings.language())}.` : "",
            category: "routine",
            profileLabel: WORKFLOW_NAMES.site_monitor,
            dedupeKey: `site-up:${check.url}`,
            cooldownMinutes: 5,
          });
        }
        sites[check.url] = { failures: 0, down: false };
        continue;
      }
      const failures = state.failures + 1;
      const down = state.down || failures >= WORKFLOW_LIMITS.failuresBeforeAlert;
      if (down && !state.down) {
        this.alerts.raise({
          title: `Site down: ${host(check.url)}`,
          body: clip(unlinked(check.reason ?? "No answer."), 300),
          category: "routine",
          priority: "high",
          profileLabel: WORKFLOW_NAMES.site_monitor,
          dedupeKey: `site-down:${check.url}`,
          cooldownMinutes: 30,
        });
      }
      sites[check.url] = { failures, down, since: state.since ?? new Date().toISOString() };
    }
    this.repo.save("site_monitor", { memory: { sites } });
    return `${up} of ${checks.length} sites up`;
  }

  private feeds(reads: FeedRead[]): string {
    const row = this.repo.get("feed_digest");
    const config = "feeds" in row.config ? row.config : { feeds: [], max_items: 10 };
    const configured = new Set(config.feeds);
    const before = (row.memory as FeedMemory).feeds ?? {};
    const feeds: NonNullable<FeedMemory["feeds"]> = {};
    for (const [url, state] of Object.entries(before)) if (configured.has(url)) feeds[url] = state;
    const fresh: string[] = [];
    let failed = 0;
    let learned = 0;
    for (const read of reads.filter((r) => configured.has(r.url))) {
      const state = feeds[read.url];
      if (!read.ok) {
        failed++;
        const failures = (state?.failures ?? 0) + 1;
        feeds[read.url] = { seen: state?.seen ?? [], failures, primed: state?.primed ?? false };
        if (failures === WORKFLOW_LIMITS.feedFailuresBeforeAlert) {
          this.alerts.raise({
            title: `Feed unavailable: ${host(read.url)}`,
            // Two lines, so each is translated on its own.
            body: [`It could not be read ${failures} times in a row.`, clip(unlinked(read.reason ?? "No answer."), 200)].join("\n"),
            category: "routine",
            profileLabel: WORKFLOW_NAMES.feed_digest,
            dedupeKey: `feed-down:${read.url}`,
            cooldownMinutes: 24 * 60,
          });
        }
        continue;
      }
      const seen = new Set(state?.seen ?? []);
      // The first read of a feed only learns what is there: announcing a whole archive is noise.
      if (state?.primed) {
        for (const item of read.items.filter((i) => !seen.has(i.id))) {
          const source = clip(read.title ?? host(read.url), 60);
          const link = item.link ? ` (${item.link})` : "";
          fresh.push(clip(unlinked(`- ${source}: ${item.title}${link}`).replace(/\s+/g, " "), 400));
        }
      } else {
        learned++;
      }
      const ids = [...read.items.map((i) => i.id), ...(state?.seen ?? [])];
      feeds[read.url] = { seen: [...new Set(ids)].slice(0, WORKFLOW_LIMITS.seenPerFeed), failures: 0, primed: true };
    }
    this.repo.save("feed_digest", { memory: { feeds } });
    if (fresh.length > 0) {
      const shown = fresh.slice(0, config.max_items);
      const more = fresh.length - shown.length;
      this.alerts.raise({
        title: "New in your feeds",
        body: [...shown, ...(more > 0 ? [`And ${more} more.`] : [])].join("\n"),
        category: "digest",
        profileLabel: WORKFLOW_NAMES.feed_digest,
      });
    }
    const parts = [`${fresh.length} new item(s)`];
    if (learned > 0) parts.push(`${learned} feed(s) read for the first time`);
    if (failed > 0) parts.push(`${failed} feed(s) could not be read`);
    return parts.join("\n");
  }
}
