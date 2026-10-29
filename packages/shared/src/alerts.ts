import { z } from "zod";

/**
 * Alerts: every notification the owner gets goes through one alert center, which decides how
 * loud it is (priority), which channels carry it outside the app (routes) and how many messages a
 * channel may send (limits). The in-app notification center always keeps every alert.
 */

/** From quietest to loudest. Low stays in the app; critical skips the channel limits. */
export const ALERT_PRIORITIES = ["low", "normal", "high", "critical"] as const;
export type AlertPriority = (typeof ALERT_PRIORITIES)[number];
export const alertPrioritySchema = z.enum(ALERT_PRIORITIES);

/** What an alert is about. Each category picks its channels in the owner's preferences. */
export const ALERT_CATEGORIES = ["reminder", "digest", "routine", "task", "system", "security", "event"] as const;
export type AlertCategory = (typeof ALERT_CATEGORIES)[number];
export const alertCategorySchema = z.enum(ALERT_CATEGORIES);

/**
 * Channels outside the app. The app's notification center is not a channel: it always gets everything.
 * telegram: the owner's Telegram group (or the private chat with the bot while no group is linked).
 */
export const ALERT_CHANNELS = ["push", "telegram"] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];
export const alertChannelSchema = z.enum(ALERT_CHANNELS);

export function priorityRank(priority: AlertPriority): number {
  return ALERT_PRIORITIES.indexOf(priority);
}

/** Highest per-channel caps the owner can set; they keep a runaway routine from flooding a phone. */
export const ALERT_LIMIT_BOUNDS = { perHour: { min: 1, max: 60 }, perDay: { min: 1, max: 500 } } as const;

export const alertPreferencesSchema = z.object({
  /** Channels each category is sent to, besides the app. An empty list keeps the category in the app only. */
  routes: z.object(
    Object.fromEntries(ALERT_CATEGORIES.map((c) => [c, z.array(alertChannelSchema).max(10)])) as Record<
      AlertCategory,
      z.ZodArray<typeof alertChannelSchema>
    >,
  ),
  /** Messages each channel may send per rolling hour and day. Critical alerts are never held back. */
  limits: z.object({
    perHour: z.number().int().min(ALERT_LIMIT_BOUNDS.perHour.min).max(ALERT_LIMIT_BOUNDS.perHour.max),
    perDay: z.number().int().min(ALERT_LIMIT_BOUNDS.perDay.min).max(ALERT_LIMIT_BOUNDS.perDay.max),
  }),
  /**
   * Categories whose full text goes to chat channels (Telegram). The others are sent discreetly:
   * the title and category only, with the full text kept in the app.
   */
  fullText: z.array(alertCategorySchema).max(ALERT_CATEGORIES.length).default([]),
});
export type AlertPreferences = z.infer<typeof alertPreferencesSchema>;

export const DEFAULT_ALERT_PREFERENCES: AlertPreferences = {
  routes: Object.fromEntries(ALERT_CATEGORIES.map((c) => [c, ["push", "telegram"]])) as AlertPreferences["routes"],
  limits: { perHour: 6, perDay: 30 },
  fullText: [],
};

/** What happened when an alert met a channel. Pending: the send is still running in the background. */
export const ALERT_DELIVERY_STATUSES = ["pending", "sent", "failed", "skipped"] as const;
export type AlertDeliveryStatus = (typeof ALERT_DELIVERY_STATUSES)[number];

/**
 * Why a delivery was skipped or failed, as a code the app translates:
 * low_priority (low alerts stay in the app), rate_limited (the channel's hourly or daily cap),
 * not_configured (the channel has no keys), no_device (nobody subscribed), unreachable (every send failed).
 */
export const ALERT_DELIVERY_REASONS = ["low_priority", "rate_limited", "not_configured", "no_device", "unreachable"] as const;
export type AlertDeliveryReason = (typeof ALERT_DELIVERY_REASONS)[number];

export interface AlertDelivery {
  id: string;
  notification_id: string;
  /** The alert's title when it was sent; the notification itself may have been deleted since. */
  title: string;
  channel: AlertChannel;
  priority: AlertPriority;
  category: AlertCategory;
  status: AlertDeliveryStatus;
  reason: AlertDeliveryReason | null;
  /** Devices or chats reached, for channels that fan out. */
  reached: number;
  created_at: string;
}

export interface AlertsOverview {
  preferences: AlertPreferences;
  /** Newest first. */
  deliveries: AlertDelivery[];
  channels: Record<AlertChannel, { available: boolean }>;
}

export const notificationPriorityUpdateSchema = z.object({ priority: alertPrioritySchema });

/** The Telegram bot as the app shows it in Settings → Alerts. Ids stay on the server. */
export interface TelegramStatus {
  /** False until the Worker has the TELEGRAM_BOT_TOKEN secret. */
  configured: boolean;
  /** The bot's @username, once Talorys has reached Telegram with the token. */
  bot: string | null;
  /** The private chat with the bot is linked. */
  chat: boolean;
  /** Title of the linked group, or null. */
  group: string | null;
  /** The group is a forum: alerts go to one topic per category. */
  topics: boolean;
  linked_at: string | null;
}

/** A one-time code that links the chat and the group; valid for TELEGRAM_LINK_TTL_MS. */
export interface TelegramLinkCode {
  code: string;
  expires_at: string;
  /** Opens the private chat with the bot and sends /start <code>. */
  chat_link: string;
  /** Lets the owner pick a group to add the bot to; Telegram then sends /start <code> there. */
  group_link: string;
  status: TelegramStatus;
}

export const TELEGRAM_LINK_TTL_MS = 10 * 60_000;
