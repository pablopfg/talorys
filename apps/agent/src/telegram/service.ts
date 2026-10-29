import {
  type AlertCategory,
  type AlertPriority,
  type Language,
  localizeServerText,
  type Notification,
  sha256Hex,
  TELEGRAM_LINK_TTL_MS,
  type TelegramLinkCode,
  type TelegramStatus,
  timingSafeEqual,
} from "@talorys/shared";
import type { NotificationRepository } from "../db/repositories/automations";
import type { SettingsService } from "../services/settings";
import type { ActivityLog } from "../services/usage";
import type { AutomationService } from "../agent/scheduling";
import { AppError } from "../api/errors";
import { clip } from "../services/text";
import { toLocalMinute } from "../services/time";
import { escapeHtml, TELEGRAM_WEBHOOK_PATH, TelegramClient, TelegramError, telegramWebhookSecret } from "./client";

/** What Talorys remembers about the linked bot. Ids are Telegram's numeric ids. */
export interface TelegramLink {
  bot: string | null;
  /** The owner's Telegram user: the only account the bot listens to. */
  userId: number | null;
  chatId: number | null;
  groupId: number | null;
  groupTitle: string | null;
  isForum: boolean;
  /** Topic (message_thread_id) per category in a forum group. */
  topics: Partial<Record<AlertCategory, number>>;
  /** Topics could not be created (the bot is not an admin): stop trying until the next link. */
  topicsUnavailable: boolean;
  /** The app's address, for the "Open Talorys" button. */
  appUrl: string | null;
  linkedAt: string | null;
  /**
   * Recent update ids already handled, so a redelivered update is ignored. Not a watermark:
   * Telegram may restart ids at random after a quiet week, and updates can arrive out of order.
   */
  seenUpdates: number[];
}

const LINK_KEY = "telegram.link";
const CODE_KEY = "telegram.code";
const EMPTY: TelegramLink = {
  bot: null, userId: null, chatId: null, groupId: null, groupTitle: null, isForum: false, topics: {},
  topicsUnavailable: false, appUrl: null, linkedAt: null, seenUpdates: [],
};
/** Unambiguous letters and digits for the link code. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const START = /^\/start(?:@\w+)?\s+([A-Z2-9]{8})\s*$/;
/** Longest alert body sent to Telegram (its limit is 4096 characters with markup). */
const MAX_BODY = 3000;
export const SNOOZE_MINUTES = 60;
const SEEN_UPDATES = 100;

/** English labels, translated with the server-text catalog like every other server text. */
const CATEGORY_TEXT: Record<AlertCategory, string> = {
  reminder: "Reminders", digest: "Digests", routine: "Routines", task: "Tasks", system: "System", security: "Security", event: "Events",
};
const PRIORITY_TEXT: Record<AlertPriority, string> = { low: "Low priority", normal: "Normal priority", high: "High priority", critical: "Critical" };
const ICON: Record<AlertPriority, string> = { low: "🔕", normal: "🔔", high: "⚠️", critical: "🚨" };

/** Minimal shapes of the Bot API objects Talorys reads. */
interface TgUser { id: number; is_bot?: boolean }
interface TgChat { id: number; type: string; title?: string; is_forum?: boolean }
interface TgMessage { message_id: number; from?: TgUser; chat: TgChat; text?: string; migrate_to_chat_id?: number }
interface TgCallback { id: string; from: TgUser; data?: string; message?: TgMessage }
export interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: TgCallback }

/**
 * The Telegram bot: links the owner's private chat and group with a one-time code, posts alerts
 * to the group (or the chat while no group is linked) and handles the buttons under them.
 * It listens to one Telegram account only, the owner's, fixed when the chat is linked.
 */
export class TelegramService {
  readonly client: TelegramClient | null;
  private readonly pending = new Set<Promise<unknown>>();
  private readonly creatingTopics = new Map<AlertCategory, Promise<number | null>>();

  constructor(
    token: string | undefined,
    private readonly sessionSecret: string | undefined,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationRepository,
    private readonly automations: AutomationService,
    private readonly activity: ActivityLog,
    private readonly background: (work: Promise<unknown>) => void,
    /** Whether a category's full text may go to Telegram (the owner's preferences). */
    private readonly fullText: (category: AlertCategory) => boolean = () => false,
  ) {
    this.client = token ? new TelegramClient(token) : null;
  }

  configured(): boolean {
    return !!this.client && !!this.sessionSecret;
  }

  link(): TelegramLink {
    return { ...EMPTY, ...(this.settings.getJson<Partial<TelegramLink>>(LINK_KEY) ?? {}) };
  }

  private save(patch: Partial<TelegramLink>): TelegramLink {
    const next = { ...this.link(), ...patch };
    this.settings.setJson(LINK_KEY, next);
    return next;
  }

  status(): TelegramStatus {
    const l = this.link();
    return {
      configured: this.configured(),
      bot: l.bot,
      chat: l.chatId !== null,
      group: l.groupId !== null ? (l.groupTitle ?? "") : null,
      topics: l.groupId !== null && l.isForum && !l.topicsUnavailable,
      linked_at: l.linkedAt,
    };
  }

  /** Where alerts go: the group when linked, otherwise the private chat. */
  target(): number | null {
    const l = this.link();
    return l.groupId ?? l.chatId;
  }

  private language(): Language {
    return this.settings.language();
  }

  private text(english: string): string {
    return localizeServerText(english, this.language());
  }

  private requireClient(): TelegramClient {
    if (!this.client || !this.sessionSecret) throw new AppError("NOT_CONFIGURED", "Telegram is not set up on this deployment. Add the TELEGRAM_BOT_TOKEN secret first.");
    return this.client;
  }

  /**
   * Points the bot's webhook at this deployment and issues a one-time link code. Telegram is told
   * to drop updates queued before now, and to send only messages and button presses.
   */
  async connect(origin: string): Promise<TelegramLinkCode> {
    const client = this.requireClient();
    let bot: string;
    try {
      const me = await client.call<{ username?: string }>("getMe");
      bot = me.username ?? "";
      await client.call("setWebhook", {
        url: `${origin}${TELEGRAM_WEBHOOK_PATH}`,
        secret_token: await telegramWebhookSecret(this.sessionSecret!),
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true,
        max_connections: 5,
      });
    } catch (error) {
      if (error instanceof TelegramError && (error.code === 401 || error.code === 404)) {
        throw new AppError("NOT_CONFIGURED", "Telegram refused the bot token. Check the TELEGRAM_BOT_TOKEN secret.");
      }
      throw new AppError("SERVICE_UNAVAILABLE", "Telegram could not be reached. Try again in a moment.");
    }
    const code = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    const expiresAt = Date.now() + TELEGRAM_LINK_TTL_MS;
    this.settings.setJson(CODE_KEY, { hash: await sha256Hex(code), expiresAt });
    this.save({ bot, appUrl: origin, topicsUnavailable: false, seenUpdates: [] });
    this.activity.record("telegram.connect", "Started linking Telegram");
    return {
      code,
      expires_at: new Date(expiresAt).toISOString(),
      chat_link: `https://t.me/${bot}?start=${code}`,
      group_link: `https://t.me/${bot}?startgroup=${code}`,
      status: this.status(),
    };
  }

  /** Forgets the chat and the group and removes the webhook. The bot token itself stays a secret of the Worker. */
  async disconnect(): Promise<TelegramStatus> {
    if (this.client) {
      try {
        await this.client.call("deleteWebhook", { drop_pending_updates: true });
      } catch {
        // Unlinking here must work even when Telegram is unreachable.
      }
    }
    this.settings.delete(LINK_KEY);
    this.settings.delete(CODE_KEY);
    this.activity.record("telegram.disconnect", "Unlinked Telegram");
    return this.status();
  }

  private async codeMatches(code: string): Promise<boolean> {
    const stored = this.settings.getJson<{ hash: string; expiresAt: number }>(CODE_KEY);
    if (!stored || stored.expiresAt < Date.now()) return false;
    const enc = new TextEncoder();
    return timingSafeEqual(enc.encode(await sha256Hex(code)), enc.encode(stored.hash));
  }

  /** Called by the webhook route; the work continues in the background so Telegram gets its 200 at once. */
  receive(update: TgUpdate): void {
    this.track(this.handle(update).catch((error) => console.warn("Telegram update failed", error instanceof Error ? error.message : String(error))));
  }

  /** The alert channel's send: runs in the background and always reports how many chats it reached. */
  deliver(n: Notification, fullText: boolean, done: (reached: number) => void): void {
    this.track(this.send(n, fullText).then(done, () => done(0)));
  }

  private track(work: Promise<unknown>): void {
    const tracked: Promise<unknown> = work.finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
    this.background(tracked);
  }

  /** Resolves when every background update and send started so far has finished (tests). */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  async handle(update: TgUpdate): Promise<void> {
    const link = this.link();
    if (!Number.isSafeInteger(update.update_id)) return;
    const message = update.message;
    const callback = update.callback_query;
    // Updates from strangers (other people's messages, groups that added the bot) cost no storage:
    // only the owner's, the linked chats' and link attempts are remembered.
    const relevant = callback
      ? link.userId !== null && callback.from.id === link.userId
      : !!message && (message.chat.id === link.chatId || message.chat.id === link.groupId || START.test(message.text ?? ""));
    if (relevant) {
      const seen = link.seenUpdates ?? [];
      if (seen.includes(update.update_id)) return;
      this.save({ seenUpdates: [...seen, update.update_id].slice(-SEEN_UPDATES) });
    }
    if (message) await this.onMessage(message);
    else if (callback) await this.onCallback(callback);
  }

  private async onMessage(m: TgMessage): Promise<void> {
    let link = this.link();
    const isGroup = m.chat.type === "group" || m.chat.type === "supergroup";
    // A group upgraded to a supergroup gets a new id; Telegram says so in the old group.
    if (isGroup && m.migrate_to_chat_id && m.chat.id === link.groupId) {
      this.save({ groupId: m.migrate_to_chat_id, topics: {} });
      return;
    }
    const from = m.from;
    if (!from || from.is_bot) return;
    const start = START.exec(m.text ?? "");
    const linking = !!start && (await this.codeMatches(start[1]!));
    // Read again after the await: another update may have linked meanwhile.
    link = this.link();
    if (linking) {
      if (m.chat.type === "private") {
        // The first chat linked fixes the owner's account; another account can never take over.
        if (link.userId !== null && link.userId !== from.id) return;
        this.save({ userId: from.id, chatId: m.chat.id, linkedAt: new Date().toISOString() });
        this.activity.record("telegram.linked_chat", "Linked the Telegram chat");
        await this.reply(m.chat.id, this.text("Talorys is linked to this chat. Alerts will arrive here until you link a group."));
        return;
      }
      if (isGroup) {
        if (link.userId === null || link.userId !== from.id) {
          await this.reply(m.chat.id, this.text("Link the private chat with this bot first, then add it to the group again."));
          return;
        }
        this.save({ groupId: m.chat.id, groupTitle: clip(m.chat.title ?? "", 120), isForum: !!m.chat.is_forum, topics: {}, topicsUnavailable: false });
        this.settings.delete(CODE_KEY);
        this.activity.record("telegram.linked_group", "Linked a Telegram group");
        await this.reply(m.chat.id, this.text("This group now receives Talorys alerts."));
        return;
      }
    }
    // Someone added the bot to a group that isn't the linked one: leave it.
    if (isGroup && m.chat.id !== link.groupId) {
      await this.client?.call("leaveChat", { chat_id: m.chat.id }).catch(() => undefined);
      return;
    }
    // Only the owner, only in the private chat. Talking to the agent arrives in a later version.
    if (m.chat.type === "private" && link.userId !== null && from.id === link.userId && m.chat.id === link.chatId) {
      await this.reply(m.chat.id, this.text("Talorys only sends alerts here for now. Use the app to talk to it."));
    }
  }

  private async onCallback(q: TgCallback): Promise<void> {
    const link = this.link();
    const client = this.client;
    if (!client) return;
    const answer = (text: string) => client.call("answerCallbackQuery", { callback_query_id: q.id, text }).catch(() => undefined);
    if (link.userId === null || q.from.id !== link.userId) {
      await answer(this.text("Only the owner can use these buttons."));
      return;
    }
    const match = /^n:(done|snooze):([\w-]{1,64})$/.exec(q.data ?? "");
    const n = match ? this.notifications.get(match[2]!) : null;
    if (!match || !n) {
      await answer(this.text("This alert no longer exists."));
      return;
    }
    // A second press (two quick taps, or the button in another chat) does nothing twice.
    if (n.read_at !== null) {
      await answer(this.text("This alert was already handled."));
      return;
    }
    this.notifications.markRead(n.id);
    let reply: string;
    if (match[1] === "snooze") {
      // The reminder is sent as a reminder: it carries the text only if the alert's own category may.
      const showText = n.category === "reminder" || this.fullText(n.category);
      await this.automations.create({
        name: clip(n.title, 120),
        kind: "reminder",
        message: showText ? n.body : "Snoozed alert. Its full text is in the notification center.",
        schedule: { type: "once", at: toLocalMinute(new Date(Date.now() + SNOOZE_MINUTES * 60_000 + 59_000), this.settings.get().timezone) },
        enabled: true,
      });
      reply = "Snoozed for 1 hour.";
    } else {
      reply = "Marked as done.";
    }
    await answer(this.text(reply));
    if (q.message) {
      await client.call("editMessageReplyMarkup", {
        chat_id: q.message.chat.id,
        message_id: q.message.message_id,
        reply_markup: this.keyboard(null),
      }).catch(() => undefined);
    }
  }

  private async reply(chatId: number, text: string): Promise<void> {
    await this.client?.call("sendMessage", { chat_id: chatId, text }).catch(() => undefined);
  }

  /** The buttons under an alert: Done and Snooze for loud alerts, and always a way to open the app. */
  private keyboard(n: Notification | null): { inline_keyboard: { text: string; callback_data?: string; url?: string }[][] } {
    const rows: { text: string; callback_data?: string; url?: string }[][] = [];
    if (n && (n.priority === "high" || n.priority === "critical")) {
      rows.push([
        { text: this.text("Done"), callback_data: `n:done:${n.id}` },
        { text: this.text("Snooze 1 h"), callback_data: `n:snooze:${n.id}` },
      ]);
    }
    const url = this.link().appUrl;
    if (url) rows.push([{ text: this.text("Open Talorys"), url }]);
    return { inline_keyboard: rows };
  }

  /** The alert as Telegram HTML. Discreet categories show the title only. */
  format(n: Notification, fullText: boolean): string {
    const title = escapeHtml(clip(this.text(n.title), 200));
    const body = fullText ? escapeHtml(clip(this.text(n.body), MAX_BODY)) : `<i>${escapeHtml(this.text("Open Talorys to read it."))}</i>`;
    const footer = `${this.text(CATEGORY_TEXT[n.category])} · ${this.text(PRIORITY_TEXT[n.priority])}`;
    return `${ICON[n.priority]} <b>${title}</b>\n${body}\n\n<i>${escapeHtml(footer)}</i>`;
  }

  /** Sends one alert. Resolves to the number of chats reached (0 or 1); never throws. */
  async send(n: Notification, fullText: boolean): Promise<number> {
    const client = this.client;
    const chatId = this.target();
    if (!client || chatId === null) return 0;
    const params: Record<string, unknown> = {
      chat_id: chatId,
      text: this.format(n, fullText),
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      // Low and normal alerts arrive without a sound; high and critical ones ring.
      disable_notification: n.priority === "low" || n.priority === "normal",
      reply_markup: this.keyboard(n),
    };
    const thread = await this.topic(n.category);
    try {
      await client.call("sendMessage", thread ? { ...params, message_thread_id: thread } : params);
      return 1;
    } catch (error) {
      // The topic was deleted: forget it and send to the group's general topic.
      if (thread && error instanceof TelegramError && error.code === 400 && /thread/i.test(error.description)) {
        const l = this.link();
        const topics = { ...l.topics };
        delete topics[n.category];
        this.save({ topics });
        try {
          await client.call("sendMessage", params);
          return 1;
        } catch {
          return 0;
        }
      }
      console.warn("Telegram send failed", error instanceof TelegramError ? error.code : "error");
      return 0;
    }
  }

  /** The forum topic for a category, created on first use when the bot may manage topics. */
  private topic(category: AlertCategory): Promise<number | null> {
    const l = this.link();
    if (l.groupId === null || !l.isForum || l.topicsUnavailable || !this.client) return Promise.resolve(null);
    const known = l.topics[category];
    if (known) return Promise.resolve(known);
    // Two alerts of a new category at once share one topic instead of creating two.
    let creating = this.creatingTopics.get(category);
    if (!creating) {
      creating = this.createTopic(l.groupId, category).finally(() => this.creatingTopics.delete(category));
      this.creatingTopics.set(category, creating);
    }
    return creating;
  }

  private async createTopic(groupId: number, category: AlertCategory): Promise<number | null> {
    try {
      const topic = await this.client!.call<{ message_thread_id: number }>("createForumTopic", {
        chat_id: groupId,
        name: this.text(CATEGORY_TEXT[category]),
      });
      // The group may have been unlinked or replaced meanwhile.
      if (this.link().groupId !== groupId) return null;
      this.save({ topics: { ...this.link().topics, [category]: topic.message_thread_id } });
      return topic.message_thread_id;
    } catch (error) {
      // Refused (the bot is not an admin, topics are off): stop trying until the group is linked
      // again. A network error or a rate limit only skips the topic this time.
      if (error instanceof TelegramError && (error.code === 400 || error.code === 403)) this.save({ topicsUnavailable: true });
      return null;
    }
  }

  /** A test message from Settings. */
  async test(): Promise<boolean> {
    const client = this.requireClient();
    const chatId = this.target();
    if (chatId === null) throw new AppError("NOT_CONFIGURED", "Link the Telegram chat first.");
    try {
      await client.call("sendMessage", { chat_id: chatId, text: this.text("Test message: Telegram alerts work.") });
      return true;
    } catch {
      return false;
    }
  }
}
