import type { PushService } from "../push/service";
import type { TelegramService } from "../telegram/service";
import type { AlertChannelAdapter } from "./service";

/** Web Push to every subscribed browser; reached = devices that accepted the message. */
export function pushChannel(push: PushService): AlertChannelAdapter {
  return {
    id: "push",
    unavailable: () => (!push.configured() ? "not_configured" : push.subscriptions.all().length === 0 ? "no_device" : null),
    send: (n, done, attempt) => push.notify(n, (counts) => done(counts.sent), { attempt }),
  };
}

/**
 * The owner's Telegram group, or the private chat while no group is linked; reached = 1 when
 * Telegram accepted the message. `fullText` says whether the category's text may leave the app.
 */
export function telegramChannel(telegram: TelegramService, fullText: (n: Parameters<AlertChannelAdapter["send"]>[0]) => boolean): AlertChannelAdapter {
  return {
    id: "telegram",
    unavailable: () => (!telegram.configured() ? "not_configured" : telegram.target() === null ? "no_device" : null),
    send: (n, done, attempt) => telegram.deliver(n, fullText(n), done, attempt),
  };
}
