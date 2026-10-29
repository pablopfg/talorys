import type { PushService } from "../push/service";
import type { AlertChannelAdapter } from "./service";

/** Web Push to every subscribed browser; reached = devices that accepted the message. */
export function pushChannel(push: PushService): AlertChannelAdapter {
  return {
    id: "push",
    unavailable: () => (!push.configured() ? "not_configured" : push.subscriptions.all().length === 0 ? "no_device" : null),
    send: (n, done) => push.notify(n, (counts) => done(counts.sent)),
  };
}
