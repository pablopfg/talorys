import { isBreachedPassword, languagePreferenceSchema, type Settings } from "@talorys/shared";
import type { Env } from "../env";
import { Database } from "../db/database";
import { AuthLog } from "../auth/auth-log";
import { TaskRepository } from "../db/repositories/tasks";
import { MemoryRepository } from "../db/repositories/memories";
import { NoteRepository, ProjectRepository } from "../db/repositories/notes";
import { ConversationRepository } from "../db/repositories/conversations";
import { AutomationRepository, NotificationRepository } from "../db/repositories/automations";
import { PendingActionRepository } from "../db/repositories/pending-actions";
import { SettingsService } from "./settings";
import { ActivityLog, UsageService } from "./usage";
import { AuthService } from "../auth/auth-service";
import { AutomationService, type Scheduler } from "../agent/scheduling";
import { MemoryHistoryService, type MemoryHistoryHooks } from "../memory";
import { PushSubscriptionRepository } from "../push/repository";
import { PushService } from "../push/service";
import { RemoteTokenService } from "../remote/tokens";
import { TaskPlanService } from "./task-plans";
import { McpService } from "../mcp/service";
import { AlertService } from "../alerts/service";
import { AlertDeliveryRepository } from "../alerts/repository";
import { pushChannel } from "../alerts/channels";

/** All data services for the single owner, bound to one Durable Object's storage. */
export interface Services {
  db: Database;
  tasks: TaskRepository;
  memories: MemoryRepository;
  notes: NoteRepository;
  projects: ProjectRepository;
  conversations: ConversationRepository;
  automationsRepo: AutomationRepository;
  notifications: NotificationRepository;
  alerts: AlertService;
  pendingActions: PendingActionRepository;
  settings: SettingsService;
  usage: UsageService;
  activity: ActivityLog;
  auth: AuthService;
  authLog: AuthLog;
  automations: AutomationService;
  memoryHistory: MemoryHistoryService;
  push: PushService;
  remote: RemoteTokenService;
  taskPlans: TaskPlanService;
  mcp: McpService;
}

/** `background` keeps work alive after the request or alarm that started it (the Durable Object's waitUntil). */
export function createServices(
  storage: DurableObjectStorage,
  env: Env,
  scheduler: Scheduler,
  memoryHooks: MemoryHistoryHooks = {},
  background: (work: Promise<unknown>) => void = () => {},
): Services {
  const db = new Database(storage);
  const settings = new SettingsService(db, {
    ...(env.TALORYS_DEFAULT_TIMEZONE ? { timezone: env.TALORYS_DEFAULT_TIMEZONE } : {}),
    ...(env.TALORYS_AGENT_NAME ? { agentName: env.TALORYS_AGENT_NAME } : {}),
    ...(languagePreferenceSchema.safeParse(env.TALORYS_DEFAULT_LANGUAGE).success ? { language: env.TALORYS_DEFAULT_LANGUAGE as Settings["language"] } : {}),
  });
  const automationsRepo = new AutomationRepository(db);
  const push = new PushService(new PushSubscriptionRepository(db), env, background, () => settings.language());
  const notifications = new NotificationRepository(db);
  const alerts = new AlertService(notifications, new AlertDeliveryRepository(db), settings, { push: pushChannel(push) });
  const activity = new ActivityLog(db);
  const memories = new MemoryRepository(db);
  const usage = new UsageService(db, () => settings.get().timezone);
  const tasks = new TaskRepository(db);
  const projects = new ProjectRepository(db);
  const authLog = new AuthLog(db, settings, () => env.SESSION_SECRET);
  return {
    db,
    tasks,
    memories,
    notes: new NoteRepository(db),
    projects,
    conversations: new ConversationRepository(db),
    automationsRepo,
    notifications,
    alerts,
    pendingActions: new PendingActionRepository(db),
    settings,
    usage,
    activity,
    auth: new AuthService(db, settings, {
      passwordHash: env.OWNER_PASSWORD_HASH,
      password: env.OWNER_PASSWORD,
      sessionSecret: env.SESSION_SECRET,
      pepper: env.PASSWORD_PEPPER,
      ownerEmail: env.OWNER_EMAIL,
    }, (title, body) => alerts.raise({ title, body, category: "security", priority: "critical" }), (reason) => {
      activity.record("auth.session_ended", reason === "idle" ? "Signed out: no use" : reason === "presence" ? "Signed out: no open tab" : "Signed out: maximum session length");
      authLog.record("session_ended", null, { reason });
    },
    // Only local development may skip the breach check; a deploy never accepts an unchecked password.
    { breached: env.TALORYS_HIBP === "off" && env.TALORYS_ENV === "development" ? undefined : (password) => isBreachedPassword(password) },
    ),
    authLog,
    automations: new AutomationService(automationsRepo, settings, activity, scheduler),
    memoryHistory: new MemoryHistoryService(db, memories, settings, usage, activity, memoryHooks),
    push,
    remote: new RemoteTokenService(db, settings, env.SESSION_SECRET),
    taskPlans: new TaskPlanService(db, tasks, projects, activity),
    mcp: new McpService(db, env, activity),
  };
}
