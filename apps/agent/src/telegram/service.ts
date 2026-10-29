import {
  type AlertCategory,
  type ChatStreamEvent,
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
import { bytesToBase64, escapeHtml, TELEGRAM_WEBHOOK_PATH, TelegramClient, TelegramError, telegramWebhookSecret } from "./client";
import { markdownToTelegramHtml, splitMessage } from "./format";

/** One agent turn, as the app's chat runs it (AgentRunner.chat). */
export type ChatTurn = (input: { conversationId?: string; message: string; signal: AbortSignal }) => AsyncGenerator<ChatStreamEvent>;

/** What the bot needs from the agent to hold a conversation; attached by the Durable Object. */
export interface TelegramChat {
  turn: ChatTurn;
  /** The agent's in-flight turns by conversation, shared with the app so both see a busy conversation. */
  active: Map<string, AbortController>;
  /** Whether a conversation still exists (the owner may delete it in the app). */
  exists: (conversationId: string) => boolean;
  /** Keeps the Durable Object alive while a turn runs: work after the webhook's response is not enough. */
  keepAliveWhile: <T>(work: () => Promise<T>) => Promise<T>;
  /** Transcribes a voice message within the app's voice-input limits (TalorysAgent.transcribeClip). */
  transcribe: (audio: string, opts: { seconds?: number; signal?: AbortSignal }) => Promise<{ text: string; seconds: number }>;
}

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
  /** The owner may talk to the agent in the private chat (Settings → Alerts → Telegram). */
  conversation: boolean;
  /** The app conversation the private chat continues; /new starts another. */
  conversationId: string | null;
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
  topicsUnavailable: false, appUrl: null, conversation: false, conversationId: null, linkedAt: null, seenUpdates: [],
};
/** Unambiguous letters and digits for the link code. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const START = /^\/start(?:@\w+)?\s+([A-Z2-9]{8})\s*$/;
/** Longest alert body sent to Telegram (its limit is 4096 characters with markup). */
const MAX_BODY = 3000;
export const SNOOZE_MINUTES = 60;
const SEEN_UPDATES = 100;
/** Longest owner message passed to the agent, as in the app's chat. */
const MAX_CHAT_MESSAGE = 16_000;
/** A turn still running after this long is stopped, so the chat never waits forever. */
export const CHAT_TURN_TIMEOUT_MS = 3 * 60_000;
/** Telegram shows "typing…" for 5 seconds per sendChatAction; a long turn stops showing it after a minute. */
const TYPING_EVERY_MS = 5_000;
const MAX_TYPING = 12;
/** A turn that ignores the abort (a stuck tool) is given up this long after it, so the chat is never locked. */
const ABORT_GRACE_MS = 10_000;
const COMMAND = /^\/(new|help|start)(?:@\w+)?\s*$/i;
/** Longest voice message transcribed, in seconds. */
export const MAX_VOICE_SECONDS = 5 * 60;
/** Largest voice or audio file downloaded: five minutes of a typical recording, with room to spare. */
export const MAX_VOICE_BYTES = 5 * 1024 * 1024;
/** Size-based length estimate for a clip Telegram gave no length for: 32 kbit/s, as for app clips. */
const VOICE_BYTES_PER_SECOND = 4000;
/** Transcription errors whose message is shown to the owner as is (they are catalog texts). */
const VOICE_ERRORS = new Set<string>(["AI_LIMIT_REACHED", "AI_QUOTA_EXHAUSTED", "AI_UNAVAILABLE", "CONFLICT"]);
/** Longest transcript echoed back, so the echo is always a single message. */
const MAX_ECHO = 3500;

/** English labels, translated with the server-text catalog like every other server text. */
const CATEGORY_TEXT: Record<AlertCategory, string> = {
  reminder: "Reminders", digest: "Digests", routine: "Routines", task: "Tasks", system: "System", security: "Security", event: "Events",
};
const PRIORITY_TEXT: Record<AlertPriority, string> = { low: "Low priority", normal: "Normal priority", high: "High priority", critical: "Critical" };
const ICON: Record<AlertPriority, string> = { low: "🔕", normal: "🔔", high: "⚠️", critical: "🚨" };

/** Minimal shapes of the Bot API objects Talorys reads. */
interface TgUser { id: number; is_bot?: boolean }
interface TgChat { id: number; type: string; title?: string; is_forum?: boolean }
interface TgAudio { file_id: string; duration?: number; file_size?: number }
interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  migrate_to_chat_id?: number;
  /** A voice message recorded in Telegram, or an audio file sent to the chat. */
  voice?: TgAudio;
  audio?: TgAudio;
}
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
  private chat: TelegramChat | null = null;
  /** A turn from the private chat is running (also before its conversation exists). */
  private chatting = false;
  /** A voice message from the private chat is being downloaded or transcribed. */
  private listening = false;

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

  /** Called once by the Durable Object, which owns the agent runner. */
  attachChat(chat: TelegramChat): void {
    this.chat = chat;
  }

  /** Turns the conversation in the private chat on or off. */
  setConversation(on: boolean): TelegramStatus {
    this.save({ conversation: on });
    this.activity.record("telegram.conversation", on ? "Turned on the Telegram conversation" : "Turned off the Telegram conversation");
    return this.status();
  }

  status(): TelegramStatus {
    const l = this.link();
    return {
      conversation: l.conversation,
      conversation_id: l.conversationId,
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
      // The menu of commands in the private chat. Not essential: a failure changes nothing else.
      await client.call("setMyCommands", {
        commands: [
          { command: "new", description: clip(this.text("Start a new conversation"), 256) },
          { command: "help", description: clip(this.text("What this bot does"), 256) },
        ],
        scope: { type: "all_private_chats" },
      }).catch(() => undefined);
    } catch (error) {
      if (error instanceof TelegramError && (error.code === 401 || error.code === 404)) {
        throw new AppError("NOT_CONFIGURED", "Telegram refused the bot token. Check the TELEGRAM_BOT_TOKEN secret.");
      }
      throw new AppError("SERVICE_UNAVAILABLE", "Telegram could not be reached. Try again in a moment.");
    }
    const code = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    const expiresAt = Date.now() + TELEGRAM_LINK_TTL_MS;
    this.settings.setJson(CODE_KEY, { hash: await sha256Hex(code), expiresAt });
    // Connecting (which asks for the password) turns the conversation on; a link made before the
    // conversation existed keeps it off until the owner turns it on.
    this.save({ bot, appUrl: origin, topicsUnavailable: false, seenUpdates: [], conversation: true });
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
    // Only the owner, only in the private chat.
    if (m.chat.type === "private" && link.userId !== null && from.id === link.userId && m.chat.id === link.chatId) {
      await this.onOwnerMessage(m, link);
    }
  }

  /** The owner wrote in the private chat: a command, or a message for the agent. */
  private async onOwnerMessage(m: TgMessage, link: TelegramLink): Promise<void> {
    const text = (m.text ?? "").trim();
    const command = COMMAND.exec(text)?.[1]?.toLowerCase();
    if (command === "new") {
      this.save({ conversationId: null });
      await this.reply(m.chat.id, this.text("Started a new conversation. Your next message begins it."));
      return;
    }
    if (command === "help" || command === "start") {
      await this.reply(m.chat.id, this.text(link.conversation ? "Write or send a voice message to talk to Talorys, as in the app's chat. /new starts a new conversation. Alerts arrive in the group, or here while no group is linked." : "Alerts arrive in the group, or here while no group is linked. The conversation through Telegram is off; turn it on in Settings → Alerts → Telegram."));
      return;
    }
    if (!link.conversation || !this.chat) {
      await this.reply(m.chat.id, this.text("The conversation through Telegram is off. Turn it on in Settings → Alerts → Telegram."));
      return;
    }
    const clipFile = m.voice ?? m.audio;
    if (!text && clipFile) {
      await this.onVoice(m.chat.id, clipFile);
      return;
    }
    if (!text) {
      await this.reply(m.chat.id, this.text("Talorys reads text and voice messages here."));
      return;
    }
    await this.converse(m.chat.id, clip(text, MAX_CHAT_MESSAGE));
  }

  /** Whether the private chat is waiting on Talorys: a turn or a voice message in progress. */
  private busy(conversationId: string | null): boolean {
    return this.chatting || this.listening || (!!conversationId && !!this.chat?.active.has(conversationId));
  }

  /**
   * A voice message (or audio file): transcribed with the app's voice-input model and limits, shown
   * back to the owner, then answered like a written message. The audio is never stored.
   */
  private async onVoice(chatId: number, file: TgAudio): Promise<void> {
    const chat = this.chat!;
    const client = this.client;
    if (!client) return;
    const duration = Number.isFinite(file.duration) && file.duration! > 0 ? file.duration! : undefined;
    if ((duration ?? 0) > MAX_VOICE_SECONDS || (file.file_size ?? 0) > MAX_VOICE_BYTES) {
      await this.reply(chatId, `⚠️ ${this.text("This voice message is too long. Send up to 5 minutes, or write it.")}`);
      return;
    }
    if (this.busy(this.link().conversationId)) {
      await this.reply(chatId, this.text("Talorys is still answering your last message. Wait for it, then write again."));
      return;
    }
    // Held until the reply's turn starts, so no other message slips in between.
    this.listening = true;
    let handedOver = false;
    try {
      let text = "";
      let failure: string | null = null;
      try {
        void client.call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => undefined);
        text = await chat.keepAliveWhile(async () => {
          const info = await client.call<{ file_path?: string; file_size?: number }>("getFile", { file_id: file.file_id });
          if (!info.file_path || (info.file_size ?? 0) > MAX_VOICE_BYTES) throw new TelegramError(413, "file too large");
          const bytes = await client.download(info.file_path, MAX_VOICE_BYTES);
          // Without a length from Telegram, estimate one from the size (no 60 s clip cap here),
          // so the daily cap is checked before the model runs and never undercounted.
          const seconds = duration ?? Math.min(MAX_VOICE_SECONDS, Math.max(1, Math.ceil(bytes.byteLength / VOICE_BYTES_PER_SECOND)));
          const result = await chat.transcribe(bytesToBase64(bytes), { seconds, signal: AbortSignal.timeout(CHAT_TURN_TIMEOUT_MS) });
          return result.text.trim();
        });
      } catch (error) {
        if (error instanceof TelegramError && error.code === 413) failure = "This voice message is too long. Send up to 5 minutes, or write it.";
        else if (error instanceof AppError && VOICE_ERRORS.has(error.code)) failure = error.message;
        else {
          console.warn("Telegram voice message failed", error instanceof TelegramError ? error.code : error instanceof AppError ? error.code : "error");
          failure = "Talorys couldn't transcribe this voice message. Try again, or write it.";
        }
      }
      if (failure) {
        await this.reply(chatId, `⚠️ ${this.text(failure)}`);
        return;
      }
      if (!text) {
        await this.reply(chatId, this.text("Talorys couldn't make out any words in this voice message. Try again, or write it."));
        return;
      }
      await this.reply(chatId, `🎙️ ${clip(text, MAX_ECHO)}`);
      // converse() claims the chat before its first await, so the hand-over leaves no gap.
      this.listening = false;
      handedOver = true;
      await this.converse(chatId, clip(text, MAX_CHAT_MESSAGE));
    } finally {
      // After the hand-over the flag may belong to a later voice message.
      if (!handedOver) this.listening = false;
    }
  }

  /**
   * Runs one agent turn, exactly as the app's chat does (same tools, limits and approvals), and
   * sends the reply. The conversation is an ordinary app conversation, so it also shows in the app.
   */
  private async converse(chatId: number, message: string): Promise<void> {
    const chat = this.chat!;
    let conversationId = this.link().conversationId ?? undefined;
    if (conversationId && !chat.exists(conversationId)) {
      conversationId = undefined;
      this.save({ conversationId: null });
    }
    if (this.busy(conversationId ?? null)) {
      await this.reply(chatId, this.text("Talorys is still answering your last message. Wait for it, then write again."));
      return;
    }
    this.chatting = true;
    const controller = new AbortController();
    if (conversationId) chat.active.set(conversationId, controller);
    let timedOut = false;
    let giveUp: () => void = () => {};
    const abandoned = new Promise<void>((resolve) => (giveUp = resolve));
    let grace: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      grace = setTimeout(giveUp, ABORT_GRACE_MS);
    }, CHAT_TURN_TIMEOUT_MS);
    let pings = 0;
    const typing = () => {
      if (pings++ < MAX_TYPING) void this.client?.call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => undefined);
    };
    typing();
    const ticker = setInterval(typing, TYPING_EVERY_MS);
    let reply = "";
    let failure: string | null = null;
    let needsApp = false;
    const run = async () => {
      for await (const event of chat.turn({ conversationId, message, signal: controller.signal })) {
        if (event.type === "start") {
          if (conversationId !== event.conversation_id) {
            conversationId = event.conversation_id;
            this.save({ conversationId });
            chat.active.set(conversationId, controller);
          }
        } else if (event.type === "error") {
          failure = event.message;
        } else if (event.type === "done") {
          reply = event.message.content;
          // Approvals and plans are confirmed in the app, never from Telegram.
          needsApp = event.message.tools.some((t) => t.approval?.status === "pending" || t.plan?.status === "pending");
        }
      }
    };
    try {
      await chat.keepAliveWhile(() => Promise.race([run(), abandoned]));
    } catch (error) {
      failure = error instanceof AppError ? error.message : "Something went wrong.";
    } finally {
      clearTimeout(timeout);
      if (grace !== undefined) clearTimeout(grace);
      clearInterval(ticker);
      if (conversationId && chat.active.get(conversationId) === controller) chat.active.delete(conversationId);
      this.chatting = false;
    }
    // A partial answer says it was cut short: by the time limit, or by Stop in the app.
    if (timedOut) failure = "Talorys took too long to answer. Try again.";
    else if (controller.signal.aborted) failure = "The answer was stopped.";
    const parts = splitMessage(reply);
    if (failure) parts.push(`⚠️ ${this.text(failure)}`);
    if (needsApp) parts.push(this.text("Something here needs your confirmation. Open Talorys to review it."));
    if (parts.length === 0) parts.push(this.text("I wasn't able to produce a response. Please try rephrasing."));
    const url = this.link().appUrl;
    for (const [i, part] of parts.entries()) {
      const last = i === parts.length - 1;
      const button = last && needsApp && url && conversationId ? { inline_keyboard: [[{ text: this.text("Open in Talorys"), url: `${url}/chat/${conversationId}` }]] } : undefined;
      await this.sendText(chatId, part, button);
    }
  }

  /** Sends Markdown as Telegram HTML, and as plain text if Telegram can't parse the markup. */
  private async sendText(chatId: number, markdown: string, replyMarkup?: unknown): Promise<void> {
    const client = this.client;
    if (!client) return;
    const base = { chat_id: chatId, link_preview_options: { is_disabled: true }, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) };
    try {
      await client.call("sendMessage", { ...base, text: markdownToTelegramHtml(markdown), parse_mode: "HTML" });
    } catch (error) {
      if (!(error instanceof TelegramError && error.code === 400)) {
        console.warn("Telegram reply failed", error instanceof TelegramError ? error.code : "error");
        return;
      }
      // Plain text, and without the button in case the button was what Telegram refused.
      const { reply_markup: _, ...plain } = base as typeof base & { reply_markup?: unknown };
      await client.call("sendMessage", { ...plain, text: markdown }).catch(() => undefined);
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
