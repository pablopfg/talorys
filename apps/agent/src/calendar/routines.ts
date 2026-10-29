import type { Automation } from "@talorys/shared";
import type { Services } from "../services/container";
import { clip, defangLinks } from "../services/text";
import { localDayBounds, toLocalMinute } from "../services/time";
import type { CalendarEvent } from "./service";

/** Where the last notice scheduled for a calendar is remembered, so a watcher round doesn't repeat it. */
const NOTICE_KEY = (calendarId: string) => `calendar.notice.${calendarId}`;

export interface NoticePayload {
  calendarId: string;
  /** The owner's local day, YYYY-MM-DD. */
  day: string;
  /** The first event's start, in ms. */
  start: number;
}

/** Today's events of one calendar, in the owner's timezone. */
async function today(s: Services, calendarId: string, now: Date): Promise<CalendarEvent[]> {
  const bounds = localDayBounds(s.settings.get().timezone, now);
  return s.calendar.events(calendarId, new Date(bounds.start), new Date(bounds.end));
}

const firstTimed = (events: CalendarEvent[]) => events.find((e) => e.start !== null)?.start ?? null;

/**
 * Whether a routine with a calendar gate runs now: only on days with an event on that calendar
 * (a Saturday closing only when there were patients). Null means run. When Google can't be
 * reached the routine runs anyway: a missed closing is worse than one on a quiet day.
 */
export async function gateAutomation(s: Services, a: Automation, now = new Date()): Promise<{ status: "skipped"; result: string } | null> {
  if (!a.calendar_gate) return null;
  const calendar = s.calendar.calendar(a.calendar_gate);
  if (!calendar || calendar.mode === "off") {
    s.alerts.raise({
      title: a.name,
      body: "Skipped: the Google calendar this automation depends on isn't open anymore. Open it in Settings → Integrations or edit the automation.",
      automationId: a.id,
      category: "system",
      dedupeKey: `routine-gate:${a.id}`,
      cooldownMinutes: 20 * 60,
    });
    return { status: "skipped", result: "Its Google calendar isn't open" };
  }
  try {
    if ((await today(s, calendar.id, now)).length === 0) return { status: "skipped", result: `No events on “${calendar.name}” today` };
  } catch (error) {
    console.warn("Calendar gate unavailable; running anyway", error instanceof Error ? error.message : String(error));
  }
  return null;
}

/**
 * For each calendar with a notice: the time to send it today (minutes before the first timed
 * event), scheduled once per day and start. A start already reached or a notice time already past
 * goes out now. Runs with the watchers; a calendar that fails is left for the next round.
 */
export async function planNotices(s: Services, schedule: (at: Date, payload: NoticePayload) => Promise<void>, now = new Date()): Promise<number> {
  const tz = s.settings.get().timezone;
  const day = toLocalMinute(now, tz).slice(0, 10);
  let planned = 0;
  for (const calendar of s.calendar.withNotice()) {
    try {
      const start = firstTimed(await today(s, calendar.id, now));
      if (start === null || start <= now.getTime()) continue;
      const last = s.settings.getJson<{ day: string; start: number }>(NOTICE_KEY(calendar.id));
      if (last?.day === day && last.start === start) continue;
      const at = start - calendar.notice!.minutes * 60_000;
      if (at <= now.getTime()) sendNotice(s, calendar.id, day, start);
      else await schedule(new Date(at), { calendarId: calendar.id, day, start });
      // Remembered only once planned: a failed schedule is tried again next round.
      s.settings.setJson(NOTICE_KEY(calendar.id), { day, start });
      planned++;
    } catch (error) {
      console.warn("Calendar notice not planned", error instanceof Error ? error.message : String(error));
    }
  }
  return planned;
}

/**
 * A scheduled notice comes due. It goes out only if that event is still the day's first at the
 * same time; a moved one was planned again by the watchers. If Google can't be reached, it goes
 * out anyway: a late "turn on the air conditioning" beats none.
 */
export async function noticeDue(s: Services, payload: NoticePayload, now = new Date()): Promise<boolean> {
  const calendar = s.calendar.calendar(payload.calendarId);
  if (!calendar || calendar.mode === "off" || !calendar.notice) return false;
  try {
    if (firstTimed(await today(s, calendar.id, now)) !== payload.start) return false;
  } catch (error) {
    console.warn("Calendar notice check failed; sending anyway", error instanceof Error ? error.message : String(error));
  }
  return sendNotice(s, calendar.id, payload.day, payload.start);
}

function sendNotice(s: Services, calendarId: string, day: string, start: number): boolean {
  const calendar = s.calendar.calendar(calendarId);
  if (!calendar?.notice) return false;
  const time = toLocalMinute(new Date(start), s.settings.get().timezone).slice(11);
  const name = defangLinks(clip(calendar.name, 80));
  return (
    s.alerts.raise({
      title: `First event on ${name} at ${time}`,
      // The owner's own words; defanged like any text that goes out to the channels.
      body: calendar.notice.text ? defangLinks(calendar.notice.text) : `The first event of the day on ${name} starts at ${time}.`,
      category: "reminder",
      dedupeKey: `calendar-notice:${calendarId}:${day}`,
      cooldownMinutes: 20 * 60,
      profileLabel: `Notice before the first event (${name})`,
    }) !== null
  );
}

/** Today's events on the open calendars, for the daily summary. Calendars Google won't answer for are left out. */
export async function agendaLines(s: Services, now = new Date()): Promise<string[]> {
  const tz = s.settings.get().timezone;
  const rows: { at: number; line: string }[] = [];
  for (const calendar of s.calendar.readable().slice(0, 10)) {
    try {
      for (const e of await today(s, calendar.id, now)) {
        const title = defangLinks(e.title) || "—";
        const where = defangLinks(clip(calendar.name, 60));
        rows.push(
          e.start === null
            ? { at: 0, line: `- all day — ${title} (${where})` }
            : { at: e.start, line: `- ${toLocalMinute(new Date(e.start), tz).slice(11)} — ${title} (${where})` },
        );
      }
    } catch (error) {
      console.warn("Calendar left out of the summary", error instanceof Error ? error.message : String(error));
    }
  }
  return rows
    .sort((a, b) => a.at - b.at)
    .map((r) => r.line);
}
