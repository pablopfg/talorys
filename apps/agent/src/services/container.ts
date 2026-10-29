import { type AlertCategory, isBreachedPassword, languagePreferenceSchema, type Settings } from "@talorys/shared";
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
import { turnstile } from "../auth/turnstile";
import { allowedHosts } from "../hosts";
import { AutomationService, type Scheduler } from "../agent/scheduling";
import { MemoryHistoryService, type MemoryHistoryHooks } from "../memory";
import { PushSubscriptionRepository } from "../push/repository";
import { PushService } from "../push/service";
import { RemoteEvents } from "../remote/events";
import { RemoteTokenService } from "../remote/tokens";
import { TaskPlanService } from "./task-plans";
import { McpService } from "../mcp/service";
import { CalendarService } from "../calendar/service";
import { AlertService } from "../alerts/service";
import { AlertDeliveryRepository } from "../alerts/repository";
import { AlertLearning } from "../alerts/learning";
import { emailChannel, pushChannel, telegramChannel } from "../alerts/channels";
import { EmailAlerts } from "../alerts/email";
import { raiseSecurityAlert } from "../alerts/security";
import { TelegramService } from "../telegram/service";
import { WorkflowRepository } from "../workflows/repository";
import { WorkflowService } from "../workflows/service";
import { StorageService } from "./storage";
import { RetentionService } from "./retention";
import { deleteVector } from "../semantic/vectorStore";

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
  telegram: TelegramService;
  email: EmailAlerts;
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
  /** Events from outside systems (n8n), sent with an `events` access token. */
  remoteEvents: RemoteEvents;
  taskPlans: TaskPlanService;
  mcp: McpService;
  calendar: CalendarService;
  /** Routines run by Cloudflare Workflows (the Workflows menu). */
  workflows: WorkflowService;
  /** Storage limits and the trash. */
  storage: StorageService;
  /** The weekly cleanup and the memory compaction. */
  retention: RetentionService;
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
  const store = new StorageService(db);
  const settings = new SettingsService(db, {
    ...(env.TALORYS_DEFAULT_TIMEZONE ? { timezone: env.TALORYS_DEFAULT_TIMEZONE } : {}),
    ...(env.TALORYS_AGENT_NAME ? { agentName: env.TALORYS_AGENT_NAME } : {}),
    ...(languagePreferenceSchema.safeParse(env.TALORYS_DEFAULT_LANGUAGE).success ? { language: env.TALORYS_DEFAULT_LANGUAGE as Settings["language"] } : {}),
  });
  const automationsRepo = new AutomationRepository(db, store);
  const push = new PushService(new PushSubscriptionRepository(db), env, background, () => settings.language());
  const notifications = new NotificationRepository(db);
  const activity = new ActivityLog(db);
  const calendar = new CalendarService(db, env, settings, activity);
  const automations = new AutomationService(automationsRepo, settings, activity, scheduler, (id) => (calendar.calendar(id)?.mode ?? "off") !== "off");
  const alertTimers = scheduler.scheduleAlert
    ? {
        schedule: (at: Date, id: string, step: number) =>
          background(scheduler.scheduleAlert!(at, id, step).catch((error) => console.warn("Alert retry not scheduled", error instanceof Error ? error.message : String(error)))),
      }
    : undefined;
  const fullText = (category: AlertCategory) => alerts.preferences().fullText.includes(category);
  const telegram = new TelegramService(env.TELEGRAM_BOT_TOKEN, env.SESSION_SECRET, settings, {
    respond: (id, action, opts) => alerts.respond(id, action, opts),
    acknowledgeAll: () => alerts.acknowledgeAll(),
    setPriority: (id, priority) => alerts.setPriority(id, priority),
    get: (id) => notifications.get(id),
    security: (event) => raiseSecurityAlert(alerts, event),
  }, activity, background);
  const appHost = env.TALORYS_ALLOWED_HOSTS?.split(",")[0]?.trim();
  // The app's own address, from the deploy's configuration only (never from a request's Host header).
  const appUrl = appHost && /^[a-z0-9.-]{1,253}$/i.test(appHost) ? `https://${appHost}/` : undefined;
  const email = new EmailAlerts({
    binding: env.SEND_EMAIL,
    from: env.ALERT_EMAIL_FROM?.trim(),
    // An empty ALERT_EMAIL_TO falls back too.
    to: env.ALERT_EMAIL_TO?.trim() || env.OWNER_EMAIL?.trim(),
    appUrl,
  }, settings, background);
  const channels = {
    push: pushChannel(push),
    telegram: telegramChannel(telegram, (n) => fullText(n.category)),
    email: emailChannel(email, (n) => fullText(n.category)),
  };
  const alerts: AlertService = new AlertService(notifications, new AlertDeliveryRepository(db), settings, channels, {
    timers: alertTimers,
    automations,
    activity,
    learning: new AlertLearning(db, notifications, activity),
    email,
  });
  const memories = new MemoryRepository(db, store);
  const usage = new UsageService(db, () => settings.get().timezone);
  const tasks = new TaskRepository(db, (id) => alerts.taskCompleted(id), store);
  const projects = new ProjectRepository(db, store);
  const notes = new NoteRepository(db, store);
  const authLog = new AuthLog(db, settings, () => env.SESSION_SECRET);
  return {
    db,
    tasks,
    memories,
    notes,
    projects,
    conversations: new ConversationRepository(db, store),
    automationsRepo,
    notifications,
    alerts,
    telegram,
    email,
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
    {
      breached: env.TALORYS_HIBP === "off" && env.TALORYS_ENV === "development" ? undefined : (password) => isBreachedPassword(password),
      human: turnstile(env.TURNSTILE_SITE_KEY, env.TURNSTILE_SECRET_KEY, [...(allowedHosts(env) ?? [])]),
      recovery:
        appUrl && email.configured()
          ? {
              appUrl,
              address: env.OWNER_EMAIL?.trim() || email.address()!,
              room: () => email.canSendRecovery(),
              send: (link) => email.sendRecovery(link),
            }
          : undefined,
    },
    ),
    authLog,
    automations,
    memoryHistory: new MemoryHistoryService(db, memories, settings, usage, activity, memoryHooks),
    push,
    remote: new RemoteTokenService(db, settings, env.SESSION_SECRET),
    remoteEvents: new RemoteEvents(alerts, settings, db),
    taskPlans: new TaskPlanService(db, tasks, projects, activity),
    mcp: new McpService(db, env, activity),
    calendar,
    workflows: new WorkflowService(
      new WorkflowRepository(db),
      settings,
      activity,
      alerts,
      scheduler.workflows?.timer ?? { schedule: async () => "", cancel: async () => {}, exists: async () => false },
      scheduler.workflows?.launcher ?? { available: () => false, start: async () => {}, forget: () => {} },
      env.TALORYS_ENV === "development",
    ),
    storage: store,
    retention: new RetentionService(db, settings, store, tasks, notes, memories, alerts, activity, (id) => deleteVector(db, id)),
  };
}
