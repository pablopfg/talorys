import { z } from "zod";
import { BACKUP_FORMAT, LANGUAGES, LIMIT_CEILINGS, SESSION_TIMEOUT_RANGES, TASK_PRIORITIES, TRANSCRIPTION_LIMITS } from "./constants";
import { isValidTimeZone, scheduleSpecSchema } from "./recurrence";
import { type TaskPlanDraft, taskPlanDraftSchema } from "./plans";
import { AUTOMATION_PRIORITIES, type AlertCategory, type AlertEscalation, type AlertPriority, type AutomationPriority, type PriorityReason } from "./alerts";

// ---------- Primitives ----------

const id = z.string().min(1).max(64);
const isoDate = z.string().datetime({ offset: true });
const shortText = (max: number) => z.string().trim().min(1).max(max);

// ---------- Entities ----------

export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
export const MEMORY_CATEGORIES = ["preference", "fact", "goal", "project", "habit", "person", "other"] as const;
export const PROJECT_STATUSES = ["active", "paused", "completed", "archived"] as const;
export const AUTOMATION_KINDS = ["reminder", "task_digest", "agent_prompt"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];
export type AutomationKind = (typeof AUTOMATION_KINDS)[number];

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: string | null;
  project_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export const MEMORY_STATUSES = ["active", "historical", "uncertain"] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export interface Memory {
  id: string;
  content: string;
  category: MemoryCategory;
  source: "manual" | "agent" | "import" | "remote";
  /** Lifecycle: current fact, past fact kept as history, or flagged as possibly outdated. */
  status: MemoryStatus;
  /** The newer memory that replaced this one, if any. */
  superseded_by: string | null;
  /** When the fact became / stopped being true, only if explicitly stated (YYYY, YYYY-MM or YYYY-MM-DD). */
  valid_from: string | null;
  valid_until: string | null;
  created_at: string;
  updated_at: string;
}

export const MEMORY_REVIEW_RELATIONSHIPS = ["contradiction", "possible_update"] as const;
export const MEMORY_REVIEW_ACTIONS = ["keep_both", "mark_historical", "replace", "cancel"] as const;
export type MemoryReviewAction = (typeof MEMORY_REVIEW_ACTIONS)[number];

/** A possible conflict between a new memory and an older one, waiting for the owner's decision. */
export interface MemoryReview {
  id: string;
  /** The newer memory. */
  memory: Memory;
  /** The older memory it may conflict with. */
  other: Memory;
  relationship: (typeof MEMORY_REVIEW_RELATIONSHIPS)[number];
  reason: string;
  created_at: string;
}

/** Older and newer versions of a fact, oldest first. */
export interface MemoryHistory {
  memory: Memory;
  previous: Memory[];
  next: Memory[];
}

export interface Note {
  id: string;
  title: string;
  content: string;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: (typeof PROJECT_STATUSES)[number];
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
}

export type PendingActionStatus = "pending" | "approved" | "cancelled" | "expired" | "failed";

/** A destructive action the agent proposed. It runs only when the owner approves it in the UI. */
export interface PendingAction {
  id: string;
  /** Server-written description of the exact target, e.g. `Delete task “Buy milk”`. */
  summary: string;
  status: PendingActionStatus;
  error: string | null;
  expires_at: string;
  /** Exact text the action will write (e.g. a note's replacement), shown in full on the approval card. */
  preview?: string;
  /** "external": a call to a connected MCP server, whose `preview` is the arguments it will receive. */
  kind?: "external";
  /** What an approved external call returned, shortened. Untrusted third-party content. */
  result?: string;
}

export interface ToolActivity {
  id: string;
  name: string;
  label: string;
  status: "running" | "success" | "error";
  error?: string;
  /** Set when a destructive tool call is waiting for (or got) the owner's approval. */
  approval?: PendingAction;
  /** Set when the agent proposed a task plan; tasks exist only after the owner confirms it. */
  plan?: TaskPlanDraft;
}

/** Shape check for tool activity stored with a message. Entries that fail it (e.g. from a hostile backup) are dropped on read. */
export const toolActivitySchema = z.object({
  id: z.string(),
  name: z.string(),
  label: z.string(),
  status: z.enum(["running", "success", "error"]),
  error: z.string().optional(),
  approval: z
    .object({
      id: z.string(),
      summary: z.string(),
      status: z.enum(["pending", "approved", "cancelled", "expired", "failed"]),
      error: z.string().nullable(),
      expires_at: z.string(),
      preview: z.string().optional(),
      kind: z.literal("external").optional(),
      result: z.string().optional(),
    })
    .optional(),
  plan: taskPlanDraftSchema.optional(),
}) satisfies z.ZodType<ToolActivity, unknown>;

export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  tools: ToolActivity[];
  status: "complete" | "error" | "cancelled";
  error: string | null;
  created_at: string;
  /** "import" for messages restored from a backup; they never count as live owner input. */
  source?: "chat" | "import";
}

export type AutomationStatus = "scheduled" | "running" | "paused" | "completed" | "failed";

export interface Automation {
  id: string;
  name: string;
  kind: AutomationKind;
  message: string;
  schedule: z.infer<typeof scheduleSpecSchema>;
  schedule_description: string;
  enabled: boolean;
  /** Priority of the alerts this automation raises; a high reminder insists until confirmed. */
  priority: AutomationPriority;
  status: AutomationStatus;
  schedule_id: string | null;
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  last_error: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
}

export interface AutomationRun {
  id: string;
  automation_id: string;
  automation_name: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "error" | "skipped";
  result: string | null;
  error: string | null;
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  automation_id: string | null;
  /** How loud the alert is; see ALERT_PRIORITIES. */
  priority: AlertPriority;
  /** What the alert is about; see ALERT_CATEGORIES. */
  category: AlertCategory;
  read_at: string | null;
  /** Insistence of a high or critical alert; null for alerts that never insist. */
  escalation: AlertEscalation | null;
  /** Tries sent so far (1 = only the first). */
  attempts: number;
  /** When the next try goes out (or the alert is recorded as unacknowledged), while insisting. */
  next_attempt_at: string | null;
  /** The learned profile this alert belongs to (category + origin); null for security alerts. */
  profile: string | null;
  /** Why it has this priority; null for alerts raised before the priority learned. */
  priority_reason: PriorityReason | null;
  created_at: string;
}

export interface SessionInfo {
  id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  user_agent: string;
  current: boolean;
}

// ---------- Input schemas ----------

export const taskCreateSchema = z.object({
  title: shortText(300),
  description: z.string().max(10_000).optional().default(""),
  status: z.enum(TASK_STATUSES).optional().default("todo"),
  priority: z.enum(TASK_PRIORITIES).optional().default("medium"),
  due_at: isoDate.nullable().optional(),
  project_id: id.nullable().optional(),
});
export const taskUpdateSchema = z
  .object({
    title: shortText(300),
    description: z.string().max(10_000),
    status: z.enum(TASK_STATUSES),
    priority: z.enum(TASK_PRIORITIES),
    due_at: isoDate.nullable(),
    project_id: id.nullable(),
  })
  .partial();
export const taskListQuerySchema = z.object({
  status: z.enum([...TASK_STATUSES, "open", "all"]).optional().default("all"),
  view: z.enum(["today", "upcoming", "overdue", "completed", "all"]).optional().default("all"),
  project_id: id.optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(200),
});

export const memoryCreateSchema = z.object({
  content: shortText(2000),
  category: z.enum(MEMORY_CATEGORIES).optional().default("other"),
});
// Update schemas are declared without defaults: `.partial()` on a schema with
// `.default()` would fill omitted fields and silently overwrite stored values.
export const memoryUpdateSchema = z.object({ content: shortText(2000), category: z.enum(MEMORY_CATEGORIES) }).partial();
export const memoryListQuerySchema = z.object({
  q: z.string().max(200).optional(),
  category: z.enum(MEMORY_CATEGORIES).optional(),
  status: z.enum(["all", "active", "historical", "review"]).optional(),
});
export const memoryStatusSchema = z.object({ status: z.enum(MEMORY_STATUSES) });
/** Records a newer version of a fact; the old memory is kept as history. */
export const memoryCorrectSchema = z.object({ content: shortText(2000), category: z.enum(MEMORY_CATEGORIES).optional() });
export const memoryReviewResolveSchema = z.object({ action: z.enum(MEMORY_REVIEW_ACTIONS) });


export const noteCreateSchema = z.object({
  title: shortText(300),
  content: z.string().max(200_000).optional().default(""),
  project_id: id.nullable().optional(),
});
export const noteUpdateSchema = z
  .object({ title: shortText(300), content: z.string().max(200_000), project_id: id.nullable() })
  .partial();

export const projectCreateSchema = z.object({
  name: shortText(200),
  description: z.string().max(5000).optional().default(""),
  status: z.enum(PROJECT_STATUSES).optional().default("active"),
});
export const projectUpdateSchema = z
  .object({ name: shortText(200), description: z.string().max(5000), status: z.enum(PROJECT_STATUSES) })
  .partial();

export const conversationCreateSchema = z.object({ title: z.string().trim().max(200).optional() });
export const conversationUpdateSchema = z.object({ title: shortText(200) });

export const chatRequestSchema = z.object({
  conversation_id: id.optional(),
  message: shortText(16_000),
  retry: z.boolean().optional(),
});

export const transcribeRequestSchema = z.object({
  /** A recorded clip (WebM/Opus, Ogg or MP4/AAC, as the browser records it) as base64, at most TRANSCRIPTION_LIMITS.maxClipBytes once decoded. */
  audio: z.string().min(1).max(Math.ceil(TRANSCRIPTION_LIMITS.maxClipBytes / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/, "Audio must be base64."),
  /** Text already dictated, so a clip that continues a sentence keeps its spelling and context. */
  context: z.string().max(1000).optional(),
});

export const automationCreateSchema = z.object({
  name: shortText(200),
  kind: z.enum(AUTOMATION_KINDS),
  message: z.string().trim().max(4000).optional().default(""),
  schedule: scheduleSpecSchema,
  enabled: z.boolean().optional().default(true),
  priority: z.enum(AUTOMATION_PRIORITIES).optional().default("normal"),
});
export const automationUpdateSchema = z
  .object({
    name: shortText(200),
    message: z.string().trim().max(4000),
    schedule: scheduleSpecSchema,
    enabled: z.boolean(),
    priority: z.enum(AUTOMATION_PRIORITIES),
  })
  .partial();

export const limitsSchema = z.object({
  maxOutputTokens: z.number().int().min(64).max(LIMIT_CEILINGS.maxOutputTokens),
  maxToolCalls: z.number().int().min(0).max(LIMIT_CEILINGS.maxToolCalls),
  maxAgentIterations: z.number().int().min(1).max(LIMIT_CEILINGS.maxAgentIterations),
  maxContextTokens: z.number().int().min(1000).max(LIMIT_CEILINGS.maxContextTokens),
  maxScheduledAiRunsPerDay: z.number().int().min(0).max(LIMIT_CEILINGS.maxScheduledAiRunsPerDay),
  maxAiRequestsPerDay: z.number().int().min(1).max(LIMIT_CEILINGS.maxAiRequestsPerDay),
});
export type Limits = z.infer<typeof limitsSchema>;

export const memoryHistorySettingsSchema = z.object({
  /** Detect when a new memory replaces or may contradict an older one (rule-based, no AI). */
  conflictReview: z.boolean(),
  /** Let Clef (Workers AI decision model) decide conflicts that rules or semantic recall nominate (one AI request per check). */
  aiConflictCheck: z.boolean(),
});
export type MemoryHistorySettings = z.infer<typeof memoryHistorySettingsSchema>;

const timeoutIn = ([min, max]: readonly [number, number]) => z.number().int().min(min).max(max);
export const sessionTimeoutsSchema = z.object({
  idleMinutes: timeoutIn(SESSION_TIMEOUT_RANGES.idleMinutes),
  presenceMinutes: timeoutIn(SESSION_TIMEOUT_RANGES.presenceMinutes),
  maxHours: timeoutIn(SESSION_TIMEOUT_RANGES.maxHours),
});
export type SessionTimeouts = z.infer<typeof sessionTimeoutsSchema>;

/** Longest owner-written instructions added to the agent's prompt (characters). */
export const MAX_CUSTOM_INSTRUCTIONS = 2000;
/** Owner-written instructions for tone and style; they sit below the agent's safety rules and can't override them. */
export const customInstructionsSchema = z.string().trim().max(MAX_CUSTOM_INSTRUCTIONS);

/** UI language. "system" follows the browser and falls back to DEFAULT_LANGUAGE. */
export const languagePreferenceSchema = z.enum(["system", ...LANGUAGES]);

export const settingsSchema = z.object({
  agentName: shortText(60),
  timezone: z.string().refine(isValidTimeZone, "Unknown IANA timezone"),
  theme: z.enum(["system", "light", "dark"]),
  /**
   * Reads an unknown language (saved by a newer version, before a rollback) as "system",
   * so it can't fail validation and reset every other setting.
   */
  language: languagePreferenceSchema.catch("system"),
  model: z.string().regex(/^@(cf|hf)\/[\w.\-/]+$/, "Must be a Workers AI model id"),
  temperature: z.number().min(0).max(1.5),
  limits: limitsSchema,
  autoMemory: z.boolean(),
  /** Reads a value the current limit rejects (saved before a rollback) as empty, so it can't reset every other setting. */
  customInstructions: customInstructionsSchema.catch(""),
  /** Documented demo mode: uses the deterministic mock provider instead of Workers AI. */
  demoMode: z.boolean(),
  memoryHistory: memoryHistorySettingsSchema,
  /** Check the npm registry once a day for a newer Talorys release. */
  updateCheck: z.boolean(),
  session: sessionTimeoutsSchema,
});
export type Settings = z.infer<typeof settingsSchema>;
export const settingsUpdateSchema = settingsSchema
  .omit({ limits: true, memoryHistory: true, session: true })
  .partial()
  .extend({
    // Changes are still validated strictly; only reading stored settings is lenient.
    language: languagePreferenceSchema.optional(),
    customInstructions: customInstructionsSchema.optional(),
    limits: limitsSchema.partial().optional(),
    memoryHistory: memoryHistorySettingsSchema.partial().optional(),
    session: sessionTimeoutsSchema.partial().optional(),
  });

export const loginSchema = z.object({ password: z.string().min(1).max(256) });
/** Signing in: the e-mail address is asked for only when OWNER_EMAIL is set. */
export const signInSchema = loginSchema.extend({
  email: z.string().max(254).optional(),
  /** The Turnstile widget's answer, when the sign-in form showed it (GET /api/auth/session says when). */
  turnstile_token: z.string().max(2048).optional(),
});
/** Step-up: the password, or with two-step sign-in on, a current authenticator code. */
export const confirmSchema = z
  .object({ password: z.string().min(1).max(256).optional(), code: z.string().min(1).max(40).optional() })
  .refine((v) => (v.password === undefined) !== (v.code === undefined), { message: "Send the password or a code." });
export const heartbeatSchema = z.object({ active: z.boolean() });
export const changePasswordSchema = z.object({
  current_password: z.string().min(1).max(256),
  new_password: z.string().min(1).max(256),
});

// ---------- Backup ----------

const backupEntity = <T extends z.ZodRawShape>(shape: T) => z.object(shape).passthrough();

export const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.number().int().min(1),
  exported_at: z.string(),
  app_version: z.string().optional(),
  data: z.object({
    settings: z.record(z.string(), z.unknown()).optional().default({}),
    conversations: z.array(backupEntity({ id, title: z.string(), created_at: z.string(), updated_at: z.string() })).default([]),
    messages: z
      .array(
        backupEntity({
          id,
          conversation_id: id,
          role: z.enum(["user", "assistant"]),
          content: z.string(),
          created_at: z.string(),
        }),
      )
      .default([]),
    memories: z.array(backupEntity({ id, content: z.string(), category: z.string(), created_at: z.string(), updated_at: z.string() })).default([]),
    tasks: z.array(backupEntity({ id, title: z.string(), status: z.string(), created_at: z.string(), updated_at: z.string() })).default([]),
    notes: z.array(backupEntity({ id, title: z.string(), content: z.string(), created_at: z.string(), updated_at: z.string() })).default([]),
    projects: z.array(backupEntity({ id, name: z.string(), created_at: z.string(), updated_at: z.string() })).default([]),
    automations: z.array(backupEntity({ id, name: z.string(), kind: z.string(), schedule: z.unknown() })).default([]),
    /** Connection details only: no credentials, sessions or tool choices. Imported servers arrive disabled. */
    mcp_servers: z.array(backupEntity({ id, name: z.string(), url: z.string(), auth_type: z.string() })).default([]),
  }),
});
export type Backup = z.infer<typeof backupSchema>;

// ---------- API contract ----------

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "AI_QUOTA_EXHAUSTED"
  | "AI_UNAVAILABLE"
  | "AI_LIMIT_REACHED"
  | "CONFLICT"
  | "NOT_CONFIGURED"
  /** A sensitive action needs the password again (POST /api/auth/confirm), then a retry. */
  | "REAUTH_REQUIRED"
  /** The password in use fails the current rules: only changing it (POST /api/auth/password) works. */
  | "PASSWORD_CHANGE_REQUIRED"
  /** The sign-in looks risky: solve the Turnstile check (details.site_key) and send its token. */
  | "HUMAN_CHECK_REQUIRED"
  /** A service the request depends on (such as the breach check) did not answer; retry later. */
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; details?: unknown };
}

/** Server-sent events emitted by POST /api/chat. */
export type ChatStreamEvent =
  | { type: "start"; conversation_id: string; user_message_id: string; assistant_message_id: string }
  | { type: "text"; delta: string }
  | { type: "tool"; tool: ToolActivity }
  | { type: "title"; conversation_id: string; title: string }
  | { type: "error"; code: ApiErrorCode; message: string }
  | { type: "done"; message: ChatMessage };

export interface HealthReport {
  ok: boolean;
  version: string;
  storage: "ok" | "error";
  schema_version: number;
  configured: { password: boolean; session_secret: boolean };
  ai_binding: boolean;
  /** Web Push keys are set; push is optional and does not affect `ok`. */
  push: boolean;
  time: string;
}

export interface UsageReport {
  day: string;
  today: UsageCounters;
  last_7_days: UsageCounters;
  limits: Limits;
  model: string;
  note: string;
  dashboard_url: string;
  pricing: { as_of: string; source_url: string; usd_per_1000_neurons: number };
}

export interface UsageCounters {
  ai_requests: number;
  input_tokens_reported: number;
  output_tokens_reported: number;
  input_tokens_estimated: number;
  output_tokens_estimated: number;
  /** Historical mixed counts: neither provenance nor model is recoverable. */
  input_tokens_legacy: number;
  output_tokens_legacy: number;
  tool_calls: number;
  scheduled_ai_runs: number;
  ai_errors: number;
  embedding_requests: number;
  /** Seconds of chat voice input transcribed. */
  transcription_seconds: number;
  /** Priced-call subtotal, before free allocation; null when nothing could be priced. */
  neurons_estimate: number | null;
  cost_usd_estimate: number | null;
  priced_calls: number;
  unpriced_calls: number;
  mock_calls: number;
}
