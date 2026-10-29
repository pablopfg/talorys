import {
  ESCALATION,
  isInsistent,
  type Language,
  localizeServerText,
  MAX_PUSH_DEVICES,
  type Notification,
  type NotificationAction,
  NOTIFICATION_ACTIONS,
  type PushStatus,
} from "@talorys/shared";
import { clip } from "../services/text";
import { encryptPayload } from "./ece";
import { fromB64url } from "./encoding";
import type { PushSubscriptionRepository, PushSubscriptionRow } from "./repository";
import { importVapidKeys, type VapidKeys, vapidAuthorization } from "./vapid";
import { allowedHosts } from "../hosts";

export interface PushEnv {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  TALORYS_ALLOWED_HOSTS?: string;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Notification id, so a click can open the app and mark it read. */
  id?: string;
  url: string;
  /** Buttons under the notification (Done, Snooze, Mute); the service worker answers them. */
  actions?: { action: NotificationAction; title: string }[];
  /** Keep the notification on screen until the owner acts on it (high and critical alerts). */
  sticky?: boolean;
}

/** Options for one push: a later try of an insistent alert is marked "(2/3)". */
export interface PushOptions {
  attempt?: { number: number };
}

/** Labels of the push buttons, translated with the server-text catalog. */
const ACTION_TEXT: Record<NotificationAction, string> = { done: "Done", snooze: "Snooze 1 h", mute: "Mute this alert" };

export type SendOutcome = "sent" | "gone" | "failed";

/** Push services keep an undelivered message this long (seconds) while a device is offline. */
const TTL_SECONDS = 24 * 3600;
const SEND_TIMEOUT_MS = 10_000;

/** Short plain text for the system notification; the full Markdown stays in the app. */
export function toPushMessage(n: Pick<Notification, "id" | "title" | "body">): PushMessage {
  const plain = (text: string) => text.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
  const shorten = (text: string, max: number) => (text.length > max ? `${clip(text, max - 1)}…` : text);
  return { title: shorten(plain(n.title), 100), body: shorten(plain(n.body), 240), id: n.id, url: "/" };
}

/**
 * Delivers notifications to the owner's subscribed browsers with Web Push. Sending happens in
 * the background and never fails the work that created the notification: an automation run,
 * a reminder or a chat turn finishes the same whether or not any device was reached.
 */
export class PushService {
  /** Replaced in tests; push requests never follow redirects to another host. */
  fetcher: typeof fetch = (input, init) => fetch(input, init);
  private keys: Promise<VapidKeys | null> | null = null;
  private readonly pending = new Set<Promise<void>>();

  constructor(
    readonly subscriptions: PushSubscriptionRepository,
    private readonly env: PushEnv,
    private readonly background: (work: Promise<unknown>) => void,
    /** The owner's language: notifications are written in English and translated when sent. */
    private readonly language: () => Language = () => "en",
  ) {}

  configured(): boolean {
    return !!this.env.VAPID_PUBLIC_KEY && !!this.env.VAPID_PRIVATE_KEY;
  }

  /**
   * After a move to a new domain (DOM-02), devices subscribed on the old address would get
   * notifications whose click opens an address that no longer answers. They are dropped when the
   * owner opens the push settings on an allowed address, so the app there shows push as off and
   * they turn it on again. Never from a scheduled send: a mistyped setting must not silently
   * delete every device before anyone has reached the app.
   */
  private dropMovedDevices(): void {
    const hosts = allowedHosts(this.env);
    if (!hosts) return;
    for (const sub of this.subscriptions.all()) {
      let host = "";
      try {
        host = new URL(sub.origin).hostname.toLowerCase();
      } catch {
        // An unreadable origin can't be one of ours.
      }
      if (!hosts.has(host)) this.subscriptions.remove(sub.id);
    }
  }

  status(): PushStatus {
    this.dropMovedDevices();
    const available = this.configured();
    return { available, public_key: available ? this.env.VAPID_PUBLIC_KEY! : null, devices: this.subscriptions.devices(), max_devices: MAX_PUSH_DEVICES };
  }

  private vapid(): Promise<VapidKeys | null> {
    this.keys ??= importVapidKeys(this.env.VAPID_PUBLIC_KEY, this.env.VAPID_PRIVATE_KEY);
    return this.keys;
  }

  /**
   * Sends a notification to every device. Returns at once; delivery continues in the background,
   * and `onDone` gets the outcome counts (all zero when the send itself threw).
   */
  notify(
    n: Pick<Notification, "id" | "title" | "body"> & Partial<Pick<Notification, "priority" | "category">>,
    onDone?: (counts: Record<SendOutcome, number>) => void,
    opts: PushOptions = {},
  ): void {
    if (!this.configured() || this.subscriptions.all().length === 0) {
      onDone?.({ sent: 0, gone: 0, failed: 0 });
      return;
    }
    const language = this.language();
    const localized = { ...n, title: localizeServerText(n.title, language), body: localizeServerText(n.body, language) };
    const message = toPushMessage(localized);
    if (opts.attempt) message.title = `${message.title} (${opts.attempt.number}/${ESCALATION.attempts})`;
    // Insistent alerts stay on screen and carry their buttons; the rest only open the app. A security
    // alert has none: answers from the browser can't stop it, only Telegram can.
    if (n.priority && isInsistent(n.priority)) {
      message.sticky = true;
      if (n.category !== "security") {
        message.actions = NOTIFICATION_ACTIONS.map((action) => ({ action, title: localizeServerText(ACTION_TEXT[action], language) }));
      }
    }
    const work: Promise<void> = this.sendToAll(message)
      .catch((error) => {
        console.warn("Push delivery failed", error instanceof Error ? error.message : String(error));
        return { sent: 0, gone: 0, failed: 0 };
      })
      .then((counts) => onDone?.(counts))
      .catch((error) => console.warn("Push delivery report failed", error instanceof Error ? error.message : String(error)))
      .finally(() => this.pending.delete(work));
    this.pending.add(work);
    this.background(work);
  }

  /** Resolves when every background delivery started so far has finished (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  /** Sends one message to every device. Gone subscriptions are removed, failures counted. */
  async sendToAll(message: PushMessage): Promise<Record<SendOutcome, number>> {
    const counts: Record<SendOutcome, number> = { sent: 0, gone: 0, failed: 0 };
    // The devices registered when the message was sent: one added meanwhile (the device a "new
    // push device" alert is about) does not get it.
    const subscriptions = this.subscriptions.all();
    const keys = await this.vapid();
    if (!keys) return counts;
    const outcomes = await Promise.all(subscriptions.map((sub) => this.sendOne(sub, message, keys)));
    for (const o of outcomes) counts[o]++;
    return counts;
  }

  private async sendOne(sub: PushSubscriptionRow, message: PushMessage, keys: VapidKeys): Promise<SendOutcome> {
    let status: number;
    try {
      const body = await encryptPayload(new TextEncoder().encode(JSON.stringify(message)), {
        p256dh: fromB64url(sub.p256dh),
        auth: fromB64url(sub.auth),
      });
      const res = await this.fetcher(sub.endpoint, {
        method: "POST",
        headers: {
          authorization: await vapidAuthorization(sub.endpoint, keys, this.env.VAPID_SUBJECT || sub.origin),
          "content-encoding": "aes128gcm",
          "content-type": "application/octet-stream",
          ttl: String(TTL_SECONDS),
          // Every notification is something the owner scheduled or asked for, so deliver promptly.
          urgency: "high",
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      status = res.status;
      await res.body?.cancel();
    } catch {
      status = 0;
    }
    if (status >= 200 && status < 300) {
      this.subscriptions.recordSuccess(sub.id);
      return "sent";
    }
    // 404/410: the browser unsubscribed or the subscription expired; it will never work again.
    if (status === 404 || status === 410) {
      this.subscriptions.remove(sub.id);
      return "gone";
    }
    this.subscriptions.recordFailure(sub.id);
    return "failed";
  }
}
