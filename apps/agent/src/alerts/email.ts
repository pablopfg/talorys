import { type AlertCategory, type AlertPriority, EMAIL_ALERTS, localizeServerText, type Notification } from "@talorys/shared";
import type { SettingsService } from "../services/settings";
import { clip } from "../services/text";

/** The part of Cloudflare's send_email binding Talorys uses (the structured send). */
export interface EmailSender {
  send(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
}

export interface EmailConfig {
  /** The send_email binding (SEND_EMAIL); without it e-mail is not set up. */
  binding?: EmailSender;
  /** Sender, on a domain with Cloudflare Email Routing (ALERT_EMAIL_FROM). */
  from?: string;
  /** The owner's address, verified in Email Routing (ALERT_EMAIL_TO, else OWNER_EMAIL). */
  to?: string;
  /** The app's address for the link at the end of each e-mail, when known. */
  appUrl?: string;
}

const SENT_KEY = "alerts.email.sent";
/** What a sent e-mail was: a security or critical alert, another alert, or the test. */
type EmailKind = "security" | "other" | "test" | "recovery";
interface SentEmail {
  t: string;
  k: EmailKind;
}
const DAY_MS = 86_400_000;
const MAX_SUBJECT = 150;
const MAX_BODY = 3000;
/** A plain address: no display name, spaces, angle brackets or line breaks. */
const ADDRESS = /^[A-Za-z0-9._%+-]{1,64}@(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

const CATEGORY_TEXT: Record<AlertCategory, string> = {
  reminder: "Reminders", digest: "Digests", routine: "Routines", task: "Tasks", system: "System", security: "Security", event: "Events",
};
const PRIORITY_TEXT: Record<AlertPriority, string> = { low: "Low priority", normal: "Normal priority", high: "High priority", critical: "Critical" };

/** Security and critical alerts may use the reserved part of the daily cap. */
function kindOf(n: Pick<Notification, "category" | "priority">): EmailKind {
  return n.category === "security" || n.priority === "critical" ? "security" : "other";
}

export function isEmailAddress(value: string | undefined): value is string {
  return !!value && ADDRESS.test(value);
}

/** "p•••@exemplo.com.br": enough for the owner to recognise, not enough to copy. */
export function maskAddress(address: string): string {
  const at = address.lastIndexOf("@");
  return `${address.slice(0, 1)}•••${address.slice(at)}`;
}

/** Control characters (line breaks included) would let text spill into the message's headers. */
function oneLine(text: string): string {
  return text.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").trim();
}

/**
 * Alerts by e-mail, through Cloudflare Email Routing's send_email binding. Free when the recipient
 * is an address verified in Email Routing, which is the only kind this channel sends to. At most
 * EMAIL_ALERTS.perDay messages in 24 hours, counted here so no other limit can make room for more.
 */
export class EmailAlerts {
  private readonly pending = new Set<Promise<unknown>>();

  constructor(
    private readonly config: EmailConfig,
    private readonly settings: SettingsService,
    private readonly background: (work: Promise<unknown>) => void,
  ) {}

  /** True when the binding, a valid sender and a valid recipient are all set. */
  configured(): boolean {
    return !!this.config.binding && isEmailAddress(this.config.from) && isEmailAddress(this.config.to);
  }

  /** The masked recipient, or null when e-mail is not set up. */
  recipient(): string | null {
    return this.configured() ? maskAddress(this.config.to!) : null;
  }

  /** Sends started in the last 24 hours (the test e-mail included). */
  sentToday(): number {
    return this.recent().length;
  }

  /** True when the daily cap leaves no room for this alert (security and critical ones have a reserve). */
  full(n: Pick<Notification, "category" | "priority">): boolean {
    return !this.room(kindOf(n));
  }

  /** True while a test e-mail can still go out today. */
  canTest(): boolean {
    return this.room("test");
  }

  /** The alert channel's send: runs in the background and reports 1 when the e-mail was accepted. */
  deliver(n: Notification, fullText: boolean, done: (reached: number) => void): void {
    this.track(this.send(kindOf(n), this.subject(n.title), this.alertText(n, fullText)).then(done, () => done(0)));
  }

  /** A test message from Settings → Alerts. Resolves to true when Cloudflare accepted it. */
  async test(): Promise<boolean> {
    const text = [
      this.text("This is a test e-mail from Talorys. E-mail alerts work."),
      "",
      ...this.footer(),
    ].join("\n");
    return (await this.send("test", this.subject("Test e-mail"), text)) > 0;
  }

  /** The verified recipient, for the "forgot password" check; null when e-mail is not set up. */
  address(): string | null {
    return this.configured() ? this.config.to! : null;
  }

  /** Room today for a "forgot password" e-mail, outside the reserve kept for security alerts. */
  canSendRecovery(): boolean {
    return this.room("recovery");
  }

  /**
   * The "forgot password" link, to the owner's verified address only, in the background. It never
   * uses the reserve for security alerts (the auth service also allows at most 3 a day).
   */
  sendRecovery(link: string): void {
    this.track(this.recovery(link));
  }

  private async recovery(link: string): Promise<boolean> {
    const text = [
      this.text("Someone asked to reset your Talorys password. To choose a new one, open this link within 30 minutes:"),
      "",
      link,
      "",
      this.text("The link works once. If it wasn't you, ignore this e-mail: your password stays the same."),
      this.text("Talorys never asks for your password or codes by e-mail."),
    ].join("\n");
    return (await this.send("recovery", this.subject("Reset your password"), text)) > 0;
  }

  /** Resolves when every send started so far has finished (tests). */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  /** The message body: the alert (or a note that it is in the app), what kind it is, and where to manage it. */
  alertText(n: Notification, fullText: boolean): string {
    const lines = [clip(this.text(n.title), 200), ""];
    lines.push(fullText ? clip(this.text(n.body), MAX_BODY) : this.text("Open Talorys to read it."));
    lines.push("", `${this.text(CATEGORY_TEXT[n.category])} · ${this.text(PRIORITY_TEXT[n.priority])}`);
    // Phishing copies alerts like these: the real ones never ask for anything.
    if (n.category === "security") lines.push(this.text("Talorys never asks for your password or codes by e-mail."));
    lines.push("", ...this.footer());
    return lines.join("\n");
  }

  private subject(title: string): string {
    return clip(oneLine(`Talorys: ${this.text(title)}`), MAX_SUBJECT);
  }

  private footer(): string[] {
    const lines: string[] = [];
    if (this.config.appUrl) lines.push(`${this.text("Open Talorys:")} ${this.config.appUrl}`);
    lines.push(this.text("Choose which alerts reach your e-mail in Settings → Alerts."));
    return lines;
  }

  private text(english: string): string {
    return localizeServerText(english, this.settings.language());
  }

  private recent(): SentEmail[] {
    const since = Date.now() - DAY_MS;
    return (this.settings.getJson<unknown[]>(SENT_KEY) ?? [])
      .filter((e): e is SentEmail => !!e && typeof e === "object" && typeof (e as SentEmail).t === "string")
      .filter((e) => Date.parse(e.t) > since);
  }

  private room(kind: EmailKind, sent = this.recent()): boolean {
    if (kind === "test" && sent.filter((e) => e.k === "test").length >= EMAIL_ALERTS.testsPerDay) return false;
    return sent.length < (kind === "security" ? EMAIL_ALERTS.perDay : EMAIL_ALERTS.perDay - EMAIL_ALERTS.reserved);
  }

  /** Sends one message to the owner. Resolves to 1 when accepted, 0 otherwise; never throws. */
  private async send(kind: EmailKind, subject: string, body: string): Promise<number> {
    if (!this.configured()) return 0;
    const sent = this.recent();
    if (!this.room(kind, sent)) return 0;
    // Counted before sending: a send that fails or hangs still uses its place, so retries can't flood.
    const next = [...sent, { t: new Date().toISOString(), k: kind }];
    this.settings.setJson(SENT_KEY, next);
    // The e-mail that uses up a limit says so, so the silence after it is not mistaken for calm.
    let text = body;
    if (next.length === EMAIL_ALERTS.perDay) {
      text += `\n\n${this.text("This is the last e-mail alert for today. Until tomorrow, alerts stay in the app, push and Telegram.")}`;
    } else if (kind !== "security" && next.length === EMAIL_ALERTS.perDay - EMAIL_ALERTS.reserved) {
      text += `\n\n${this.text("Other alerts stop going by e-mail for today; security and critical alerts still do.")}`;
    }
    try {
      await this.config.binding!.send({ from: this.config.from!, to: this.config.to!, subject, text });
      return 1;
    } catch (error) {
      // Only the code: the message may echo the addresses.
      const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "error";
      console.warn("Alert e-mail not sent", code);
      return 0;
    }
  }

  private track(work: Promise<unknown>): void {
    const tracked: Promise<unknown> = work.finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
    this.background(tracked);
  }
}
