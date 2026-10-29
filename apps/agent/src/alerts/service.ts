import {
  ALERT_CATEGORIES,
  ALERT_CHANNELS,
  type AlertCategory,
  type AlertChannel,
  type AlertDeliveryReason,
  type AlertPreferences,
  type AlertPriority,
  type AlertsOverview,
  alertPreferencesSchema,
  DEFAULT_ALERT_PREFERENCES,
  type Notification,
} from "@talorys/shared";
import type { NotificationRepository } from "../db/repositories/automations";
import type { SettingsService } from "../services/settings";
import { ValidationError } from "../api/errors";
import type { AlertDeliveryRepository } from "./repository";

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

/** A way to reach the owner outside the app. Sending runs in the background and reports how many it reached. */
export interface AlertChannelAdapter {
  readonly id: AlertChannel;
  /** Why the channel can't send right now, or null when it can. */
  unavailable(): Extract<AlertDeliveryReason, "not_configured" | "no_device"> | null;
  send(n: Notification, done: (reached: number) => void): void;
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
}

export const DEFAULT_COOLDOWN_MINUTES = 6 * 60;
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
    private readonly channels: Record<AlertChannel, AlertChannelAdapter>,
  ) {}

  /** Returns the stored notification, or null when the same alert was raised within its cooldown. */
  raise(input: RaiseInput): Notification | null {
    if (input.dedupeKey) {
      const minutes = input.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES;
      const since = new Date(Date.now() - minutes * 60_000).toISOString();
      if (this.notifications.raisedSince(input.dedupeKey, since)) return null;
    }
    const n = this.notifications.create({
      title: input.title,
      body: input.body,
      automation_id: input.automationId ?? null,
      priority: input.priority ?? "normal",
      category: input.category,
      dedupe_key: input.dedupeKey ?? null,
    });
    this.dispatch(n);
    return n;
  }

  private dispatch(n: Notification): void {
    const prefs = this.preferences();
    // Security and critical alerts always reach every channel: someone in the owner's session must
    // not be able to switch off the warnings about what they do next.
    const channels = isAlwaysSent(n) ? ALERT_CHANNELS : prefs.routes[n.category];
    for (const channel of channels) {
      // A broken channel must never stop the others or the work that raised the alert.
      try {
        this.deliver(n, this.channels[channel], prefs);
      } catch (error) {
        console.warn("Alert delivery failed", channel, error instanceof Error ? error.message : String(error));
      }
    }
    this.deliveries.prune();
  }

  private deliver(n: Notification, channel: AlertChannelAdapter, prefs: AlertPreferences): void {
    if (n.priority === "low") {
      this.deliveries.record(n, channel.id, "skipped", "low_priority");
      return;
    }
    const unavailable = channel.unavailable();
    if (unavailable) {
      this.deliveries.record(n, channel.id, "skipped", unavailable);
      return;
    }
    if (!isUnlimited(n) && this.overLimit(channel.id, prefs)) {
      this.deliveries.record(n, channel.id, "skipped", "rate_limited");
      return;
    }
    const row = this.deliveries.record(n, channel.id, "pending");
    channel.send(n, (reached) => {
      this.deliveries.finish(row.id, reached > 0 ? "sent" : "failed", reached > 0 ? null : "unreachable", reached);
    });
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
    const merged = {
      routes: Object.fromEntries(
        ALERT_CATEGORIES.map((c) => [c, stored.routes?.[c] ?? DEFAULT_ALERT_PREFERENCES.routes[c]]),
      ),
      limits: { ...DEFAULT_ALERT_PREFERENCES.limits, ...(stored.limits ?? {}) },
    };
    const parsed = alertPreferencesSchema.safeParse(merged);
    return parsed.success ? parsed.data : structuredClone(DEFAULT_ALERT_PREFERENCES);
  }

  updatePreferences(input: unknown): AlertPreferences {
    const parsed = alertPreferencesSchema.safeParse(input);
    if (!parsed.success) throw ValidationError.fromZod(parsed.error);
    // A channel listed twice would send twice.
    const routes = Object.fromEntries(ALERT_CATEGORIES.map((c) => [c, [...new Set(parsed.data.routes[c])]]));
    const next = { routes, limits: parsed.data.limits } as AlertPreferences;
    this.settings.setJson(PREFERENCES_KEY, next);
    return next;
  }

  setPriority(id: string, priority: AlertPriority): Notification | null {
    return this.notifications.setPriority(id, priority);
  }

  overview(): AlertsOverview {
    return {
      preferences: this.preferences(),
      deliveries: this.deliveries.list(100),
      channels: Object.fromEntries(
        Object.values(this.channels).map((c) => [c.id, { available: c.unavailable() !== "not_configured" }]),
      ) as AlertsOverview["channels"],
    };
  }
}
