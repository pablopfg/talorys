import { z } from "zod";
import { scheduleSpecSchema, type ScheduleSpec } from "./recurrence";

/**
 * Workflows: routines that used to run in n8n, now run by Cloudflare Workflows (durable steps,
 * retries and waits, on the Workers Free plan). Each one is written in code and has a fixed
 * catalog entry; the owner only turns it on or off, picks when it runs and fills in its settings.
 */
export const WORKFLOW_KEYS = ["site_monitor", "feed_digest"] as const;
export type WorkflowKey = (typeof WORKFLOW_KEYS)[number];
export const workflowKeySchema = z.enum(WORKFLOW_KEYS);

export const WORKFLOW_LIMITS = {
  /** Most addresses one workflow checks or reads per run. */
  maxUrls: 10,
  /** A site alerts only after this many failed runs in a row, so one hiccup stays quiet. */
  failuresBeforeAlert: 2,
  /** A feed that can't be read this many runs in a row raises one alert. */
  feedFailuresBeforeAlert: 3,
  /** Most new feed items in one alert. */
  maxItemsPerAlert: 20,
  /** Feed items remembered per feed, so an item is announced once. */
  seenPerFeed: 200,
  /** Most of a feed that is read, in bytes: parsing stays within the Free plan's 10 ms of CPU per step. */
  feedBytes: 256 * 1024,
  /** Runs kept per workflow in the history. */
  runsKept: 50,
  /** A run still "running" after this long was lost (the platform keeps state 3 days on Free). */
  runTimeoutMinutes: 30,
  /** "Run now" at most this often per workflow, so the free daily limits can't be spent by tapping. */
  manualEverySeconds: 60,
} as const;

/** A public https:// address, at most 500 characters. The server also refuses private networks. */
const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => {
    try {
      return new URL(v).protocol === "https:";
    } catch {
      return false;
    }
  }, "Use a full https:// address.");

const urlList = z
  .array(httpsUrl)
  .max(WORKFLOW_LIMITS.maxUrls, `At most ${WORKFLOW_LIMITS.maxUrls} addresses.`)
  .refine((list) => new Set(list).size === list.length, "Each address only once.");

export const siteMonitorConfigSchema = z.object({ urls: urlList }).strict();
export const feedDigestConfigSchema = z
  .object({ feeds: urlList, max_items: z.number().int().min(1).max(WORKFLOW_LIMITS.maxItemsPerAlert) })
  .strict();

export type SiteMonitorConfig = z.infer<typeof siteMonitorConfigSchema>;
export type FeedDigestConfig = z.infer<typeof feedDigestConfigSchema>;

export interface WorkflowConfigs {
  site_monitor: SiteMonitorConfig;
  feed_digest: FeedDigestConfig;
}
export type WorkflowConfig = WorkflowConfigs[WorkflowKey];

export const WORKFLOW_CONFIG_SCHEMAS: { [K in WorkflowKey]: z.ZodType<WorkflowConfigs[K]> } = {
  site_monitor: siteMonitorConfigSchema,
  feed_digest: feedDigestConfigSchema,
};

/** A workflow repeats: a one-time run is what "Run now" is for. */
export const workflowScheduleSchema = scheduleSpecSchema.refine((s) => s.type !== "once", "A workflow needs a repeating schedule.");

export const WORKFLOW_DEFAULTS: { [K in WorkflowKey]: { schedule: ScheduleSpec; config: WorkflowConfigs[K] } } = {
  site_monitor: { schedule: { type: "interval", minutes: 15 }, config: { urls: [] } },
  feed_digest: { schedule: { type: "daily", time: "08:00" }, config: { feeds: [], max_items: 10 } },
};

export const workflowUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    schedule: workflowScheduleSchema.optional(),
    /** Checked against the workflow's own schema on the server. */
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type WorkflowUpdate = z.infer<typeof workflowUpdateSchema>;

export const WORKFLOW_RUN_STATUSES = ["running", "success", "error", "skipped"] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export interface Workflow<K extends WorkflowKey = WorkflowKey> {
  key: K;
  enabled: boolean;
  schedule: ScheduleSpec;
  schedule_description: string;
  config: WorkflowConfigs[K];
  next_run: string | null;
  last_run: string | null;
  last_status: WorkflowRunStatus | null;
  last_result: string | null;
  last_error: string | null;
  run_count: number;
  updated_at: string | null;
}

export interface WorkflowRun {
  id: string;
  workflow_key: WorkflowKey;
  trigger: "schedule" | "manual";
  status: WorkflowRunStatus;
  result: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

/** One site check, as a workflow step returns it. */
export interface SiteCheck {
  url: string;
  ok: boolean;
  /** HTTP status, when there was an answer. */
  status: number | null;
  /** Why it failed, in the server's English text. */
  reason: string | null;
  ms: number | null;
}

/** One feed read, as a workflow step returns it. Item ids are short hashes. */
export interface FeedRead {
  url: string;
  ok: boolean;
  title: string | null;
  items: { id: string; title: string; link: string | null }[];
  reason: string | null;
}

export type WorkflowReport = { key: "site_monitor"; checks: SiteCheck[] } | { key: "feed_digest"; feeds: FeedRead[] };
