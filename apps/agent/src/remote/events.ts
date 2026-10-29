import { REMOTE_EVENTS, type RemoteEventInput, type RemoteEventResult } from "@talorys/shared";
import { AppError } from "../api/errors";
import type { AlertService } from "../alerts/service";
import type { Database } from "../db/database";
import type { SettingsService } from "../services/settings";
import { clip, unlinked } from "../services/text";

const SENT_KEY = "remote.events.sent";
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** One line: the title comes from outside and must not spill into another line or header. */
const oneLine = (text: string) => text.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/g, " ").trim();


/**
 * Events from outside systems (n8n, scripts, monitors) sent with an `events` access token. Each
 * becomes an alert in the "event" category, which the alert center caps at High; at most
 * REMOTE_EVENTS.perHour are taken in an hour, so a looping workflow can't flood the owner.
 */
export class RemoteEvents {
  constructor(
    private readonly alerts: Pick<AlertService, "raise">,
    private readonly settings: SettingsService,
    private readonly db: Database,
  ) {}

  receive(input: RemoteEventInput, now = Date.now()): RemoteEventResult {
    const recent = (this.settings.getJson<unknown[]>(SENT_KEY) ?? []).filter((t): t is number => typeof t === "number" && t > now - DAY_MS);
    const lastHour = recent.filter((t) => t > now - HOUR_MS);
    const full = lastHour.length >= REMOTE_EVENTS.perHour ? { list: lastHour, window: HOUR_MS, max: REMOTE_EVENTS.perHour, text: "an hour" }
      : recent.length >= REMOTE_EVENTS.perDay ? { list: recent, window: DAY_MS, max: REMOTE_EVENTS.perDay, text: "a day" } : null;
    if (full) {
      const retryAfter = Math.max(1, Math.ceil((Math.min(...full.list) + full.window - now) / 1000));
      throw new AppError("RATE_LIMITED", `At most ${full.max} events ${full.text}. Please wait before sending more.`, { retry_after: retryAfter }, {
        "retry-after": String(retryAfter),
      });
    }
    // Counted before raising: a repeat still uses its place, so a loop can't send forever.
    this.settings.setJson(SENT_KEY, [...recent, now]);
    const source = input.source ?? "remote";
    const kind = input.kind ?? "event";
    // Named after where it came from, so it can't pass for one of Talorys' own alerts; a source that
    // carries the app's or the agent's name ("Talorys-Security") would undo that, so it shows as "remote".
    const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const own = ["talorys", squash(this.settings.get().agentName)].filter(Boolean);
    const shown = own.some((name) => squash(source).includes(name)) ? "remote" : source;
    const title = clip(oneLine(`${shown}: ${unlinked(input.title)}`), 160);
    const n = this.alerts.raise({
      title,
      body: input.body ? clip(unlinked(input.body), 1000) : "",
      category: "event",
      priority: input.priority ?? "normal",
      dedupeKey: input.id ? `event:${source}:${input.id}` : undefined,
      cooldownMinutes: REMOTE_EVENTS.dedupeHours * 60,
      ...this.profile(source, kind),
    });
    return n ? { event: { id: n.id, priority: n.priority }, duplicate: false } : { event: null, duplicate: true };
  }

  /**
   * Each source + kind learns its own priority, up to REMOTE_EVENTS.maxProfiles of them; past that,
   * new pairs share one profile, so outside systems can't push out what the owner's alerts learned.
   */
  private profile(source: string, kind: string): { profileKind: string; profileLabel: string } {
    const own = { profileKind: `${source}-${kind}`, profileLabel: `${source} · ${kind}` };
    const key = `event:${own.profileKind.replace(/[^\w-]/g, "").slice(0, 40)}`;
    const known = !!this.db.one(`SELECT 1 AS x FROM tal_alert_profiles WHERE key = ?`, key);
    const count = this.db.one<{ n: number }>(`SELECT count(*) AS n FROM tal_alert_profiles WHERE category = 'event'`)?.n ?? 0;
    return known || count < REMOTE_EVENTS.maxProfiles ? own : { profileKind: "other", profileLabel: "Other events" };
  }
}
