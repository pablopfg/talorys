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
  /**
   * The daily summary: what is overdue, due and scheduled today, the low alerts that stayed in the
   * app, and on Fridays what the priority learned. Local time, HH:MM.
   */
  digest: z.object({ enabled: z.boolean(), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).default({ enabled: true, time: "07:30" }),
  /** The watchers: deadlines, failing routines, MCP servers, AI budget, push, backup and updates. */
  watchers: z.boolean().default(true),
});
export type AlertPreferences = z.infer<typeof alertPreferencesSchema>;

export const DEFAULT_ALERT_PREFERENCES: AlertPreferences = {
  routes: Object.fromEntries(ALERT_CATEGORIES.map((c) => [c, ["push", "telegram"]])) as AlertPreferences["routes"],
  limits: { perHour: 6, perDay: 30 },
  fullText: [],
  digest: { enabled: true, time: "07:30" },
  watchers: true,
};

/**
 * The watchers run every WATCH.everyMinutes and raise an alert only when something needs the
 * owner; finding nothing sends nothing.
 */
export const WATCH = {
  everyMinutes: 15,
  /** Open tasks due within this many hours get a heads-up, and again within dueNowMinutes. */
  dueSoonHours: 24,
  dueNowMinutes: 60,
  /**
   * Overdue tasks are alerted once a local day (after the summary's time) for this many days, High
   * on the first; after that only the summary lists them.
   */
  overdueDays: 7,
  /** A task in progress with no change for this many days is stalled. */
  stalledDays: 7,
  /** Most task alerts one round raises; the rest wait for the next round and the summary. */
  maxTaskAlerts: 5,
  /** Most task alerts in 24 hours, however many tasks are late: the summary lists the rest. */
  maxTaskAlertsPerDay: 20,
  /** Share of the daily AI requests that warns first. */
  budgetWarnPercent: 80,
  /** Days without a backup export before a reminder. */
  backupDays: 30,
  /** Failed sends in a row after which a push device counts as not working. */
  pushFailures: 3,
  /** The summary still goes out this many hours after its time (the Worker was busy, or the time just changed). */
  digestGraceHours: 3,
} as const;

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

/**
 * Insistence: a high or critical alert nobody confirmed is sent again. active: still insisting;
 * acknowledged: the owner confirmed it (Done, Snooze, read in the app, a reply in the bot's chat);
 * muted: the owner silenced it; unacknowledged: every try went out and nobody confirmed it.
 */
export const ALERT_ESCALATION_STATES = ["active", "acknowledged", "muted", "unacknowledged"] as const;
export type AlertEscalation = (typeof ALERT_ESCALATION_STATES)[number];

/**
 * Tries in total, and when each later try goes out, in minutes after the first. The last entry
 * is when an alert still unconfirmed after every try is recorded as unacknowledged.
 */
export const ESCALATION = { attempts: 3, afterMinutes: [15, 60], giveUpAfterMinutes: 75 } as const;

/**
 * Security alerts stop insisting only from outside the app (Telegram): someone in the owner's
 * session must not be able to read, mute, lower or delete the warning about what they just did.
 */
export function confirmedOnlyOutOfBand(n: { category: AlertCategory }): boolean {
  return n.category === "security";
}

/** Most alerts insisting at once (security aside), so a flood of high alerts can't ring forever. */
export const MAX_ACTIVE_ESCALATIONS = 20;

/** Whether an alert of this priority insists until the owner confirms it. */
export function isInsistent(priority: AlertPriority): boolean {
  return priority === "high" || priority === "critical";
}

/** Answers to an alert from its buttons (Telegram, push) or the notification center. */
export const NOTIFICATION_ACTIONS = ["done", "snooze", "mute"] as const;
export type NotificationAction = (typeof NOTIFICATION_ACTIONS)[number];
export const notificationActionSchema = z.object({ action: z.enum(NOTIFICATION_ACTIONS) });
/** What an answer did: already = the alert was handled before; the rest name the action taken. */
export type NotificationActionResult = "done" | "snoozed" | "muted" | "already";

/** Priorities an automation may give its alerts; critical is kept for security alerts. */
export const AUTOMATION_PRIORITIES = ["low", "normal", "high"] as const;
export type AutomationPriority = (typeof AUTOMATION_PRIORITIES)[number];

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
  /** The owner may talk to the agent in the private chat. */
  conversation: boolean;
  /** The app conversation the private chat continues, or null before the first message (or after /new). */
  conversation_id: string | null;
}

export const telegramUpdateSchema = z.object({ conversation: z.boolean() });

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

/**
 * Why an alert has its priority, as the app and Telegram explain it ("why this priority"):
 * default: what the reminder, routine or event asked for; rule: a fixed rule (security is always
 * critical, external events at most high); raised / lowered: the learned profile moved it one or
 * more levels; pinned: the owner fixed this kind of alert at a priority; corrected: the owner
 * changed this alert's priority.
 */
export const PRIORITY_REASONS = ["default", "rule", "raised", "lowered", "pinned", "corrected"] as const;
export type PriorityReason = (typeof PRIORITY_REASONS)[number];

/**
 * How the learned priority behaves. Each alert of a profile adds one signal from what the owner
 * did with it (a correction adds its own, stronger one); a moving average of the signals moves
 * the profile one level up or down, at most once a week.
 */
export const LEARNING = {
  /** Read or answered within this many minutes: the owner cares about these. */
  fastMinutes: 15,
  /** Read only after this many hours: they could wait. */
  slowHours: 4,
  /** Still unread after this many hours: ignored. */
  ignoredHours: 24,
  /** A task finished this many minutes after its alert counts as acted upon. */
  taskMinutes: 60,
  /** Signals a profile needs before its level moves; a correction counts on its own. */
  minSamples: 3,
  /** Moving-average value (from -1 to 1) that moves the level. */
  threshold: 0.5,
  /** Furthest a profile moves from the priority its alerts ask for, in levels. */
  maxShift: 2,
  /** Days between two moves of the same profile. */
  lockDays: 7,
} as const;

/**
 * What the alert center learned about one kind of alert (category + origin, e.g. one routine).
 * shift: levels added to the priority its alerts ask for; pinned: the owner fixed it at a
 * priority, and the learning stops for it.
 */
export interface AlertProfile {
  id: string;
  key: string;
  category: AlertCategory;
  /** The routine's or reminder's name when the profile is one automation, else null. */
  label: string | null;
  shift: number;
  pinned: AutomationPriority | null;
  /** Moving average of the signals since the last move, from -1 (quieter) to 1 (louder). */
  score: number;
  samples: number;
  /** When the level last moved, and which way (1 up, -1 down). */
  changed_at: string | null;
  last_change: number | null;
  updated_at: string;
}

/** Fix a profile at a priority (null lets it learn again). Critical stays for security alerts. */
export const alertProfileUpdateSchema = z.object({ pinned: z.enum(AUTOMATION_PRIORITIES).nullable() });
