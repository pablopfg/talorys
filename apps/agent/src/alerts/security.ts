import type { Notification } from "@talorys/shared";

/**
 * Changes that open a door to the owner's data. Each one raises a security alert, which is always
 * critical and goes to every channel (Telegram and e-mail included) even when the person who made
 * the change is signed in to the app: whoever did it can't keep the owner from finding out. The text
 * says what happened, never where from or which secret: it can show on a lock screen.
 */
export const SECURITY_EVENTS = {
  password_changed: {
    title: "Password changed",
    body: "Your Axis password was changed and the other sessions were signed out. If it wasn't you, reset the owner password on Cloudflare right away (see the security guide).",
  },
  password_reset: {
    title: "Password reset by e-mail",
    body: "Your Axis password was reset with the link sent to your e-mail, and every session was signed out. If it wasn't you, reset the owner password on Cloudflare right away (see the security guide) and check your e-mail account.",
  },
  remote_enabled: {
    title: "Remote access on",
    body: "Remote access was turned on: apps with an access token can now reach your data. If it wasn't you, turn it off in Settings → Security → Remote access and change your password.",
  },
  token_created: {
    title: "Access token created",
    body: "A new access token was created. If it wasn't you, revoke it in Settings → Security → Remote access and change your password.",
  },
  telegram_chat: {
    title: "Telegram linked",
    body: "A Telegram chat was linked to Axis and will receive your alerts. If it wasn't you, unlink Telegram in Settings → Alerts and change your password.",
  },
  telegram_group: {
    title: "Telegram group linked",
    body: "A Telegram group was linked and now receives your alerts. If it wasn't you, unlink Telegram in Settings → Alerts and change your password.",
  },
  telegram_conversation: {
    title: "Telegram conversation on",
    body: "The conversation with Axis in the Telegram chat was turned on. If it wasn't you, turn it off in Settings → Alerts and change your password.",
  },
  telegram_unlinked: {
    title: "Telegram unlinked",
    body: "Telegram was unlinked: alerts no longer reach it. If it wasn't you, link it again in Settings → Alerts and change your password.",
  },
  push_added: {
    title: "New push device",
    body: "A new device now receives your push notifications. If it wasn't you, remove it in Settings → Alerts and change your password.",
  },
  push_removed: {
    title: "Push device removed",
    body: "A device was removed from push notifications. If it wasn't you, check the devices in Settings → Alerts and change your password.",
  },
  passkey_added: {
    title: "Passkey added",
    body: "A new passkey can now do the second sign-in step. If it wasn't you, remove it in Settings → Security and change your password.",
  },
  passkey_removed: {
    title: "Passkey removed",
    body: "A passkey was removed from your sign-in. If it wasn't you, change your password now and check Settings → Security.",
  },
  calendar_connected: {
    title: "Google Calendar connected",
    body: "A Google account's calendars were connected to Axis. If it wasn't you, disconnect it in Settings → Integrations, remove Axis from your Google account's third-party access and change your password.",
  },
  mcp_added: {
    title: "MCP server added",
    body: "A new MCP server was added: the agent can now use its tools. If it wasn't you, remove it in Settings → Integrations and change your password.",
  },
  activity_deleted: {
    title: "Sign-in activity deleted",
    body: "The sign-in activity was deleted. If it wasn't you, change your password now and sign out the other sessions.",
  },
  data_exported: {
    title: "Backup exported",
    body: "A full backup of your data was downloaded. If it wasn't you, change your password now and sign out the other sessions.",
  },
  data_imported: {
    title: "Backup imported",
    body: "A backup was imported into Axis. If it wasn't you, change your password now and check your data.",
  },
} as const;

export type SecurityEvent = keyof typeof SECURITY_EVENTS;

/** Anything that can raise an alert: the alert center, or a test double. */
export interface SecurityAlertSink {
  raise(input: { title: string; body: string; category: "security"; priority: "critical" }): Notification | null;
}

/** Raises the security alert for `event`. Never throws: the change itself already happened. */
export function raiseSecurityAlert(alerts: SecurityAlertSink, event: SecurityEvent): void {
  try {
    alerts.raise({ ...SECURITY_EVENTS[event], category: "security", priority: "critical" });
  } catch (error) {
    console.warn("Security alert not raised", event, error instanceof Error ? error.message : String(error));
  }
}
