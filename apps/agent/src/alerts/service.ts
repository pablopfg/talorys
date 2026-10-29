import {
  ALERT_CATEGORIES,
  ALERT_CHANNELS,
  type AlertCategory,
  type AlertChannel,
  type AlertDeliveryReason,
  type AlertPreferences,
  type AlertPriority,
  type AlertsOverview,
  type AlertProfile,
  type AutomationPriority,
  alertPreferencesSchema,
  DEFAULT_ALERT_PREFERENCES,
  confirmedOnlyOutOfBand,
  ESCALATION,
  isInsistent,
  MAX_ACTIVE_ESCALATIONS,
  type Notification,
  type NotificationAction,
  type NotificationActionResult,
} from "@talorys/shared";
import type { NotificationRepository } from "../db/repositories/automations";
import type { SettingsService } from "../services/settings";
import type { ActivityLog } from "../services/usage";
import type { AutomationService } from "../agent/scheduling";
import { AppError, NotFoundError, ValidationError } from "../api/errors";
import { clip } from "../services/text";
import { toLocalMinute } from "../services/time";
import type { AlertDeliveryRepository } from "./repository";
import { type AlertCorrection, AlertLearning } from "./learning";

/** Alerts no route setting can keep in the app. */
export function isAlwaysSent(n: Pick<Notification, "category" | "priority">): boolean {
  return n.category === "security" || n.priority === "critical";
}

/**
 * Alerts the channel limits never hold back: the always-sent ones, and reminders, which the owner
 * scheduled for a moment and which a busy routine must not crowd out.
 */
export function isUnlimited(n: Pick<Notification, "category" | "priority">): boolean {
  return isAlwaysSent(n) || n.category === "reminder";
}

/** A later try of an insistent alert: which one, and whether it goes to the owner directly. */
export interface AlertAttempt {
  /** 2 or 3 of ESCALATION.attempts. */
  number: number;
  /** The last try goes to the owner's private chat instead of the group. */
  direct: boolean;
}

/** A way to reach the owner outside the app. Sending runs in the background and reports how many it reached. */
export interface AlertChannelAdapter {
  readonly id: AlertChannel;
  /** Why the channel can't send right now, or null when it can. */
  unavailable(): Extract<AlertDeliveryReason, "not_configured" | "no_device"> | null;
  send(n: Notification, done: (reached: number) => void, attempt?: AlertAttempt): void;
}

/** Wakes the alert center for an insistent alert's next step (a Durable Object alarm). */
export interface AlertTimers {
  /** `step` is the try (or 4 for the give-up check) the alarm is for, so one alarm per step is kept. */
  schedule(at: Date, notificationId: string, step: number): void;
}

/** What the alert center needs besides storage: the clock for retries, and snoozes and the log. */
export interface AlertServiceDeps {
  timers?: AlertTimers;
  automations?: AutomationService;
  activity?: ActivityLog;
  /** The priority that learns from the owner's use; without it alerts keep what they ask for. */
  learning?: AlertLearning;
}

export interface RaiseInput {
  title: string;
  body: string;
  category: AlertCategory;
  priority?: AlertPriority;
  automationId?: string | null;
  /** Alerts with the same key are raised at most once per cooldown (e.g. `task-overdue:<id>`). */
  dedupeKey?: string;
  /** Minutes the dedupe key blocks a repeat. Defaults to 6 hours. */
  cooldownMinutes?: number;
  /** A name for the alert's learned profile in the app (the routine's or reminder's name). */
  profileLabel?: string;
  /**
   * Groups the alert's profile by this kind instead of by its automation, e.g. "once" for one-time
   * reminders, which each have their own automation and would never learn alone.
   */
  profileKind?: string;
}

export const DEFAULT_COOLDOWN_MINUTES = 6 * 60;
export const SNOOZE_MINUTES = 60;
const MINUTE_MS = 60_000;
const PREFERENCES_KEY = "alerts.preferences";
const HOUR_MS = 3_600_000;

/**
 * The alert center. Everything that wants the owner's attention calls raise(): it stores the
 * notification (the app always gets it), drops repeats, and sends it to the channels the
 * owner chose for its category, within each channel's hourly and daily limits.
 */
export class AlertService {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly deliveries: AlertDeliveryRepository,
    private readonly settings: SettingsService,
    /** A channel left out (in tests, or one this deployment lacks) is simply not used. */
    private readonly channels: Partial<Record<AlertChannel, AlertChannelAdapter>>,
    private readonly deps: AlertServiceDeps = {},
  ) {}

  /** Returns the stored notification, or null when the same alert was raised within its cooldown. */
  raise(input: RaiseInput): Notification | null {
    if (input.dedupeKey) {
      const minutes = input.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES;
      const since = new Date(Date.now() - minutes * 60_000).toISOString();
      if (this.notifications.raisedSince(input.dedupeKey, since)) return null;
    }
    const learning = this.deps.learning;
    // Security alerts have no profile: nothing the owner does may make them quieter.
    const profile = learning && input.category !== "security" ? AlertLearning.profileKey(input) : null;
    const asked = input.priority ?? "normal";
    const decided = learning
      ? learning.decide(input.category, asked, profile, input.profileLabel ?? null)
      : { priority: input.category === "security" ? ("critical" as const) : asked, reason: null };
    const n = this.notifications.create({
      title: input.title,
      body: input.body,
      automation_id: input.automationId ?? null,
      priority: decided.priority,
      category: input.category,
      dedupe_key: input.dedupeKey ?? null,
      profile,
      priority_reason: decided.reason,
    });
    if (profile) learning!.sweepIgnored(profile);
    const sending = this.dispatch(n);
    // Only an alert that left the app can insist: with every channel off there is nobody to remind.
    const security = confirmedOnlyOutOfBand(n);
    if (sending > 0 && isInsistent(n.priority) && this.deps.timers && (security || this.notifications.activeEscalations() < MAX_ACTIVE_ESCALATIONS)) {
      const next = this.stepTime(n, 2);
      this.notifications.setEscalation(n.id, "active", 1, next.toISOString());
      this.deps.timers.schedule(next, n.id, 2);
      return this.notifications.get(n.id) ?? n;
    }
    return n;
  }

  /** The channels an alert goes to. Returns how many sends were started. */
  private dispatch(n: Notification, attempt?: AlertAttempt): number {
    const prefs = this.preferences();
    // Security and critical alerts always reach every channel: someone in the owner's session must
    // not be able to switch off the warnings about what they do next.
    const channels = isAlwaysSent(n) ? ALERT_CHANNELS : prefs.routes[n.category];
    let sending = 0;
    for (const channel of channels) {
      const adapter = this.channels[channel];
      if (!adapter) continue;
      // A broken channel must never stop the others or the work that raised the alert.
      try {
        if (this.deliver(n, adapter, prefs, attempt)) sending++;
      } catch (error) {
        console.warn("Alert delivery failed", channel, error instanceof Error ? error.message : String(error));
      }
    }
    this.deliveries.prune();
    return sending;
  }

  private deliver(n: Notification, channel: AlertChannelAdapter, prefs: AlertPreferences, attempt?: AlertAttempt): boolean {
    if (n.priority === "low") {
      this.deliveries.record(n, channel.id, "skipped", "low_priority");
      return false;
    }
    const unavailable = channel.unavailable();
    if (unavailable) {
      this.deliveries.record(n, channel.id, "skipped", unavailable);
      return false;
    }
    // A later try is never held back: the owner asked to be reminded until they confirm.
    if (!attempt && !isUnlimited(n) && this.overLimit(channel.id, prefs)) {
      this.deliveries.record(n, channel.id, "skipped", "rate_limited");
      return false;
    }
    // "{alert} (2/3)": the catalog translates the alert's title inside it.
    const row = this.deliveries.record(attempt ? { ...n, title: `${n.title} (${attempt.number}/${ESCALATION.attempts})` } : n, channel.id, "pending");
    channel.send(n, (reached) => {
      this.deliveries.finish(row.id, reached > 0 ? "sent" : "failed", reached > 0 ? null : "unreachable", reached);
    }, attempt);
    return true;
  }

  /**
   * When an insistent alert's next step is due: try 2 and 3 at ESCALATION.afterMinutes after the
   * first, and the give-up check after the last try. Counted from the first send, so a late alarm
   * never pushes the whole ladder back.
   */
  private stepTime(n: Pick<Notification, "created_at">, step: number): Date {
    const minutes = step <= ESCALATION.attempts ? ESCALATION.afterMinutes[step - 2]! : ESCALATION.giveUpAfterMinutes;
    return new Date(Date.parse(n.created_at) + minutes * MINUTE_MS);
  }

  /**
   * The alarm for an insistent alert went off: send the next try, or record it as unacknowledged
   * after the last one. Does nothing once the owner confirmed, muted, read or deleted the alert, or
   * lowered its priority, so a stale alarm is harmless.
   */
  escalate(id: string): void {
    const n = this.notifications.get(id);
    if (n?.escalation !== "active") return;
    // A security alert keeps insisting even when read or lowered in the app; only Telegram stops it.
    const security = confirmedOnlyOutOfBand(n);
    if (n.read_at !== null && !security) {
      this.notifications.acknowledge(n.id);
      return;
    }
    if (!isInsistent(n.priority) && !security) {
      this.notifications.setEscalation(n.id, null, n.attempts, null);
      return;
    }
    // An early alarm (a reconcile that ran ahead) waits for its time.
    if (n.next_attempt_at && Date.parse(n.next_attempt_at) > Date.now() + MINUTE_MS) {
      this.deps.timers?.schedule(new Date(n.next_attempt_at), n.id, n.attempts + 1);
      return;
    }
    if (n.attempts >= ESCALATION.attempts) {
      this.notifications.setEscalation(n.id, "unacknowledged", n.attempts, null);
      this.deps.activity?.record("alert.unacknowledged", `Alert not confirmed after ${ESCALATION.attempts} tries: “${clip(n.title, 80)}”`);
      return;
    }
    const number = n.attempts + 1;
    const next = this.stepTime(n, number + 1);
    // Saved before sending, so a send that throws can't make the same try go out twice.
    this.notifications.setEscalation(n.id, "active", number, next.toISOString());
    // Lowered in the app or not, a security alert's tries go out as critical.
    this.dispatch(security ? { ...n, priority: "critical" } : n, { number, direct: number === ESCALATION.attempts });
    this.deps.timers?.schedule(next, n.id, number + 1);
  }

  /**
   * Runs the steps whose alarm was lost (a restart in the middle). Each alert moves one step at a
   * time, so an outage never fires a burst of tries at once.
   */
  reconcile(): number {
    const due = this.notifications.dueEscalations(new Date(Date.now() - MINUTE_MS).toISOString());
    for (const n of due) this.escalate(n.id);
    return due.length;
  }

  /**
   * The owner answered an alert: Done (read), Snooze (read, and a one-off reminder in an hour) or
   * Mute (stop insisting, keep it unread). A second answer does nothing twice. `outOfBand` is an
   * answer from Telegram, the only place a security alert stops insisting.
   */
  async respond(id: string, action: NotificationAction, opts: { outOfBand?: boolean } = {}): Promise<NotificationActionResult> {
    const n = this.notifications.get(id);
    if (!n) throw new NotFoundError("This alert no longer exists.");
    const outOfBand = !!opts.outOfBand;
    const locked = confirmedOnlyOutOfBand(n) && !outOfBand;
    if (action === "mute") {
      if (n.escalation !== "active") return "already";
      if (locked) throw new ValidationError("Security alerts stop insisting only from Telegram.");
      this.notifications.setEscalation(n.id, "muted", n.attempts, null);
      this.deps.learning?.observe(n, "mute");
      return "muted";
    }
    // A security alert read in the app is still waiting for Telegram: the answer there confirms it.
    const pending = n.escalation === "active" && outOfBand;
    if (n.read_at !== null && !pending) return "already";
    if (action === "done") this.deps.learning?.read(n);
    else this.deps.learning?.observe(n, "snooze");
    this.notifications.markRead(n.id);
    if (outOfBand) this.notifications.acknowledge(n.id, { outOfBand });
    if (action === "done") return "done";
    const automations = this.deps.automations;
    if (!automations) return "done";
    // The reminder is sent as a reminder: it carries the text only if the alert's own category may.
    const showText = n.category === "reminder" || this.preferences().fullText.includes(n.category);
    await automations.create({
      name: clip(n.title, 120),
      kind: "reminder",
      message: showText ? n.body : "Snoozed alert. Its full text is in the notification center.",
      schedule: { type: "once", at: toLocalMinute(new Date(Date.now() + SNOOZE_MINUTES * MINUTE_MS + 59_000), this.settings.get().timezone) },
      enabled: true,
      // A snoozed insistent alert insists again when it comes back.
      priority: isInsistent(n.priority) ? "high" : "normal",
    });
    return "snoozed";
  }

  /**
   * The owner read one alert in the app (how fast teaches the priority), or every alert at once
   * (clearing the list says nothing about any one of them).
   */
  markRead(id?: string): void {
    if (id) {
      const n = this.notifications.get(id);
      if (n && n.read_at === null) this.deps.learning?.read(n);
    }
    this.notifications.markRead(id);
  }

  /** A task was finished: an alert about it shortly before was worth sending. */
  taskCompleted(taskId: string): void {
    this.deps.learning?.taskCompleted(taskId);
  }

  /** The owner wrote to the bot: every alert still insisting counts as seen, security ones too. */
  acknowledgeAll(): boolean {
    return this.notifications.acknowledge(undefined, { outOfBand: true });
  }

  /** Deleting a security alert that is still insisting would silence it; it waits for Telegram. */
  delete(id: string): void {
    const n = this.notifications.get(id);
    if (n && n.escalation === "active" && confirmedOnlyOutOfBand(n)) {
      throw new AppError("CONFLICT", "This security alert is still waiting for your confirmation on Telegram.");
    }
    this.notifications.delete(id);
  }

  private overLimit(channel: AlertChannel, prefs: AlertPreferences): boolean {
    const now = Date.now();
    return (
      this.deliveries.sentSince(channel, new Date(now - HOUR_MS).toISOString()) >= prefs.limits.perHour ||
      this.deliveries.sentSince(channel, new Date(now - 24 * HOUR_MS).toISOString()) >= prefs.limits.perDay
    );
  }

  /** The owner's preferences; categories added in later versions get their defaults. */
  preferences(): AlertPreferences {
    const stored = this.settings.getJson<Partial<AlertPreferences>>(PREFERENCES_KEY) ?? {};
    // Saved before the Telegram channel existed (no fullText yet): Telegram joins every category that
    // was going out of the app, as on a new install; a category the owner kept in the app stays there.
    const beforeTelegram = stored.routes !== undefined && stored.fullText === undefined;
    const route = (c: AlertCategory): AlertChannel[] => {
      const saved = stored.routes?.[c];
      if (!saved) return DEFAULT_ALERT_PREFERENCES.routes[c];
      return beforeTelegram && saved.length > 0 && !saved.includes("telegram") ? [...saved, "telegram"] : saved;
    };
    const merged = {
      routes: Object.fromEntries(ALERT_CATEGORIES.map((c) => [c, route(c)])),
      limits: { ...DEFAULT_ALERT_PREFERENCES.limits, ...(stored.limits ?? {}) },
      fullText: stored.fullText ?? DEFAULT_ALERT_PREFERENCES.fullText,
    };
    const parsed = alertPreferencesSchema.safeParse(merged);
    return parsed.success ? parsed.data : structuredClone(DEFAULT_ALERT_PREFERENCES);
  }

  updatePreferences(input: unknown): AlertPreferences {
    const parsed = alertPreferencesSchema.safeParse(input);
    if (!parsed.success) throw ValidationError.fromZod(parsed.error);
    // A channel listed twice would send twice.
    const routes = Object.fromEntries(ALERT_CATEGORIES.map((c) => [c, [...new Set(parsed.data.routes[c])]]));
    const next = { routes, limits: parsed.data.limits, fullText: [...new Set(parsed.data.fullText)] } as AlertPreferences;
    this.settings.setJson(PREFERENCES_KEY, next);
    return next;
  }

  /**
   * The owner corrects how loud an alert is: the alert's profile learns from it, and lowering it
   * below high stops its insistence. Security alerts are always critical.
   */
  setPriority(id: string, priority: AlertPriority): Notification | null {
    const before = this.notifications.get(id);
    if (!before) return null;
    if (before.category === "security") {
      if (priority === "critical") return before;
      throw new ValidationError("Security alerts are always critical.");
    }
    if (before.priority === priority) return before;
    this.deps.learning?.corrected(before, priority);
    const n = this.notifications.setPriority(id, priority, "corrected");
    if (n?.escalation === "active" && !isInsistent(priority)) {
      this.notifications.setEscalation(n.id, null, n.attempts, null);
      return this.notifications.get(n.id);
    }
    return n;
  }

  /** The owner's latest corrections of reminder priorities, for the agent. */
  reminderCorrections(): AlertCorrection[] {
    return this.deps.learning?.reminderCorrections() ?? [];
  }

  /** What the priority learned, per kind of alert (empty without learning). */
  profiles(): AlertProfile[] {
    return this.deps.learning?.list() ?? [];
  }

  /** Fixes a learned profile at a priority, or lets it learn again (null). */
  pinProfile(id: string, pinned: AutomationPriority | null): AlertProfile {
    const learning = this.deps.learning;
    const p = learning?.get(id);
    if (!learning || !p) throw new NotFoundError("This alert profile no longer exists.");
    const next = learning.pin(id, pinned)!;
    this.deps.activity?.record("alerts.profile", pinned ? "Fixed the priority of a kind of alert" : "Let a kind of alert learn its priority again");
    return next;
  }

  /** Forgets what one profile learned. */
  resetProfile(id: string): AlertProfile {
    const learning = this.deps.learning;
    if (!learning?.get(id)) throw new NotFoundError("This alert profile no longer exists.");
    const next = learning.reset(id)!;
    this.deps.activity?.record("alerts.profile", "Reset what Talorys learned about a kind of alert");
    return next;
  }

  overview(): AlertsOverview {
    return {
      preferences: this.preferences(),
      deliveries: this.deliveries.list(100),
      channels: Object.fromEntries(
        ALERT_CHANNELS.map((id) => {
          const c = this.channels[id];
          return [id, { available: !!c && c.unavailable() !== "not_configured" }];
        }),
      ) as AlertsOverview["channels"],
    };
  }
}
