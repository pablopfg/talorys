import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { bearer, type Client, inAgent, loggedIn } from "./helpers";
import { googleFixture } from "./google-fixture";
import { agendaLines, gateAutomation, type NoticePayload, noticeDue, planNotices } from "../src/calendar/routines";
import { sendDigest } from "../src/alerts/watchers";

type Fixture = ReturnType<typeof googleFixture>;

const OWNER = "owner@example.com";
const CLINIC = "clinic@group.calendar.google.com";
/** 10:00 UTC on a Tuesday; the test settings use UTC. */
const NOW = new Date("2026-11-03T10:00:00Z");

async function connect(c: Client, f: Fixture) {
  const { authorize_url } = await c.json("/api/calendar/google/connect", { method: "POST", body: {} });
  const url = new URL(authorize_url);
  f.state.challenge = url.searchParams.get("code_challenge");
  expect((await c.call("/api/calendar/google/callback", { method: "POST", body: { state: url.searchParams.get("state"), code: f.state.code } })).status).toBe(200);
}

async function setup(modes: Record<string, "off" | "read" | "write"> = { [CLINIC]: "read" }) {
  const f = googleFixture();
  await inAgent((a) => {
    a.services.calendar.network = f.network;
    a.services.settings.update({ timezone: "UTC" });
  });
  const c = await loggedIn();
  await connect(c, f);
  for (const [id, mode] of Object.entries(modes)) {
    expect((await c.call(`/api/calendar/google/calendars/${encodeURIComponent(id)}`, { method: "PATCH", body: { mode } })).status).toBe(200);
  }
  return { c, f };
}

const patient = (id: string, start: string, end: string, summary = "Patient") => ({
  id,
  calendar: CLINIC,
  summary,
  start: { dateTime: start },
  end: { dateTime: end },
  etag: '"1"',
});

const notices = () => inAgent((a) => a.services.notifications.list({ limit: 50 }).filter((n) => n.title.startsWith("First event")));
const setNotice = (c: Client, id: string, notice: { minutes: number; text: string } | null) =>
  c.call(`/api/calendar/google/calendars/${encodeURIComponent(id)}/notice`, { method: "PUT", body: { notice } });

beforeEach(() => inAgent((a) => a.services.calendar.disconnect()));
afterEach(() =>
  inAgent((a) => {
    a.services.db.run(`DELETE FROM tal_notifications`);
    a.services.db.run(`DELETE FROM tal_automations`);
    a.services.db.run(`DELETE FROM tal_settings WHERE key LIKE 'calendar.notice.%'`);
  }),
);

describe("notice before the first event", () => {
  it("is set per open calendar, and goes when the calendar is hidden", async () => {
    const { c } = await setup({ [CLINIC]: "read" });
    expect((await setNotice(c, OWNER, { minutes: 60, text: "x" })).status).toBe(400);
    expect((await setNotice(c, CLINIC, { minutes: 50, text: "x" })).status).toBe(400);
    const res = await setNotice(c, CLINIC, { minutes: 60, text: "Turn on the air conditioning" });
    expect(((await res.json()) as any).calendar.notice).toEqual({ minutes: 60, text: "Turn on the air conditioning" });
    await c.call(`/api/calendar/google/calendars/${encodeURIComponent(CLINIC)}`, { method: "PATCH", body: { mode: "off" } });
    const status = await c.json("/api/calendar/google");
    expect(status.calendars.find((x: { id: string }) => x.id === CLINIC).notice).toBeNull();
  });

  it("is timed from the first timed event of the day, once, and goes out when due", async () => {
    const { c, f } = await setup();
    await setNotice(c, CLINIC, { minutes: 60, text: "Turn on the air conditioning" });
    f.state.events.push(
      { ...patient("allday", "", ""), start: { date: "2026-11-03" }, end: { date: "2026-11-04" } },
      patient("p2", "2026-11-03T15:00:00Z", "2026-11-03T16:00:00Z"),
      patient("p1", "2026-11-03T13:00:00Z", "2026-11-03T14:00:00Z"),
    );
    // The fake Google returns them in insertion order; Talorys asks for startTime order, so sort like Google would.
    f.state.events.sort((a, b) => (a.start.dateTime ?? "").localeCompare(b.start.dateTime ?? ""));
    const planned: { at: Date; payload: NoticePayload }[] = [];
    const schedule = async (at: Date, payload: NoticePayload) => {
      planned.push({ at, payload });
    };
    expect(await inAgent((a) => planNotices(a.services, schedule, NOW))).toBe(1);
    expect(planned).toEqual([{ at: new Date("2026-11-03T12:00:00Z"), payload: { calendarId: CLINIC, day: "2026-11-03", start: Date.parse("2026-11-03T13:00:00Z") } }]);
    // The next watcher round doesn't plan it again.
    expect(await inAgent((a) => planNotices(a.services, schedule, new Date("2026-11-03T10:15:00Z")))).toBe(0);
    expect(await notices()).toEqual([]);

    expect(await inAgent((a) => noticeDue(a.services, planned[0]!.payload, new Date("2026-11-03T12:00:00Z")))).toBe(true);
    const [sent] = await notices();
    expect(sent).toMatchObject({ title: "First event on Clinic at 13:00", body: "Turn on the air conditioning", category: "reminder" });
    // Not twice on the same day.
    expect(await inAgent((a) => noticeDue(a.services, planned[0]!.payload, new Date("2026-11-03T12:01:00Z")))).toBe(false);
  });

  it("follows a first event that moved, and doesn't send the stale one", async () => {
    const { c, f } = await setup();
    await setNotice(c, CLINIC, { minutes: 60, text: "" });
    f.state.events.push(patient("p1", "2026-11-03T13:00:00Z", "2026-11-03T14:00:00Z"));
    const planned: NoticePayload[] = [];
    const schedule = async (_at: Date, payload: NoticePayload) => {
      planned.push(payload);
    };
    await inAgent((a) => planNotices(a.services, schedule, NOW));
    f.state.events[0]!.start = { dateTime: "2026-11-03T14:00:00Z" };
    expect(await inAgent((a) => noticeDue(a.services, planned[0]!, new Date("2026-11-03T12:00:00Z")))).toBe(false);
    await inAgent((a) => planNotices(a.services, schedule, new Date("2026-11-03T12:00:00Z")));
    expect(planned[1]).toMatchObject({ start: Date.parse("2026-11-03T14:00:00Z") });
    expect(await inAgent((a) => noticeDue(a.services, planned[1]!, new Date("2026-11-03T13:00:00Z")))).toBe(true);
    expect((await notices())[0]).toMatchObject({ body: "The first event of the day on Clinic starts at 14:00." });
  });

  it("goes out at once when its time already passed, and never for an event that started", async () => {
    const { c, f } = await setup();
    await setNotice(c, CLINIC, { minutes: 60, text: "AC" });
    f.state.events.push(patient("p1", "2026-11-03T10:30:00Z", "2026-11-03T11:00:00Z"));
    const schedule = async () => {
      throw new Error("not expected");
    };
    expect(await inAgent((a) => planNotices(a.services, schedule, NOW))).toBe(1);
    expect(await notices()).toHaveLength(1);
    await inAgent((a) => a.services.db.run(`DELETE FROM tal_notifications`));
    await inAgent((a) => a.services.db.run(`DELETE FROM tal_settings WHERE key LIKE 'calendar.notice.%'`));
    expect(await inAgent((a) => planNotices(a.services, schedule, new Date("2026-11-03T10:45:00Z")))).toBe(0);
    expect(await notices()).toEqual([]);
  });
});

describe("routines that run only on days with events", () => {
  it("needs an open calendar", async () => {
    const { c } = await setup({ [CLINIC]: "read" });
    const body = { name: "Saturday closing", kind: "reminder", message: "Close", schedule: { type: "weekly", days: [6], time: "13:00" } };
    expect((await c.call("/api/automations", { method: "POST", body: { ...body, calendar_gate: OWNER } })).status).toBe(400);
    const res = await c.call("/api/automations", { method: "POST", body: { ...body, calendar_gate: CLINIC } });
    expect(res.status).toBe(201);
    expect(((await res.json()) as any).automation.calendar_gate).toBe(CLINIC);
  });

  it("can't be set with an access token, and a run asked for in the app isn't held back", async () => {
    await setup();
    const token = await inAgent(async (x) => {
      x.services.remote.setEnabled(true);
      return (await x.services.remote.create({ name: "script", scope: "write" })).token;
    });
    const body = { name: "Probe", kind: "reminder", message: "x", schedule: { type: "interval", minutes: 30 }, calendar_gate: CLINIC };
    expect((await bearer(token).call("/api/automations", { method: "POST", body })).status).toBe(403);
    await inAgent((x) => {
      x.services.remote.revokeAll();
      x.services.remote.setEnabled(false);
    });
    // No events today on the clinic calendar: the scheduled run would be skipped, "Run now" isn't.
    const a = await inAgent((x) =>
      x.services.automations.create({ name: "Saturday closing", kind: "reminder", message: "Close", schedule: { type: "weekly", days: [6], time: "13:00" }, enabled: true, calendar_gate: CLINIC }),
    );
    expect(await inAgent((x) => x.runAutomationNow(a.id))).toMatchObject({ status: "success" });
  });

  it("are skipped on a day without events, and run on a day with one", async () => {
    const { f } = await setup();
    const a = await inAgent((x) =>
      x.services.automations.create({ name: "Saturday closing", kind: "reminder", message: "Close", schedule: { type: "weekly", days: [6], time: "13:00" }, enabled: true, calendar_gate: CLINIC }),
    );
    expect(await inAgent((x) => gateAutomation(x.services, a, NOW))).toEqual({ status: "skipped", result: "No events on “Clinic” today" });
    f.state.events.push(patient("p1", "2026-11-03T08:00:00Z", "2026-11-03T09:00:00Z"));
    expect(await inAgent((x) => gateAutomation(x.services, a, NOW))).toBeNull();
    // Google unreachable: it runs anyway.
    f.state.refreshRevoked = true;
    f.state.access = "other";
    expect(await inAgent((x) => gateAutomation(x.services, a, NOW))).toBeNull();
  });

  it("are skipped, with one alert, when their calendar is hidden later", async () => {
    const { c } = await setup();
    const a = await inAgent((x) =>
      x.services.automations.create({ name: "Saturday closing", kind: "reminder", message: "Close", schedule: { type: "weekly", days: [6], time: "13:00" }, enabled: true, calendar_gate: CLINIC }),
    );
    await c.call(`/api/calendar/google/calendars/${encodeURIComponent(CLINIC)}`, { method: "PATCH", body: { mode: "off" } });
    for (let i = 0; i < 2; i++) expect(await inAgent((x) => gateAutomation(x.services, a, NOW))).toMatchObject({ status: "skipped" });
    const alerts = await inAgent((x) => x.services.notifications.list({ limit: 50 }).filter((n) => n.title === "Saturday closing"));
    expect(alerts).toHaveLength(1);
  });
});

describe("the daily summary", () => {
  it("lists today's events on the open calendars, in time order", async () => {
    const { f } = await setup({ [CLINIC]: "read", [OWNER]: "write" });
    f.state.events.push(
      patient("p1", "2026-11-03T13:00:00Z", "2026-11-03T14:00:00Z", "Ana https://evil.example"),
      { ...patient("g1", "2026-11-03T07:00:00Z", "2026-11-03T08:00:00Z", "Gym"), calendar: OWNER },
      { ...patient("d1", "", "", "Holiday"), calendar: OWNER, start: { date: "2026-11-03" }, end: { date: "2026-11-04" } },
      patient("tomorrow", "2026-11-04T13:00:00Z", "2026-11-04T14:00:00Z", "Tomorrow"),
    );
    const lines = await inAgent((a) => agendaLines(a.services, NOW));
    expect(lines[0]).toBe("- all day — Holiday (Owner)");
    expect(lines[1]).toBe("- 07:00 — Gym (Owner)");
    // An invite's link stays visible but can't be clicked, as in every alert.
    expect(lines[2]).toBe("- 13:00 — Ana `https://evil.example` (Clinic)");
    expect(lines).toHaveLength(3);
    expect(await inAgent((a) => sendDigest(a.services, NOW, "2026-11-03", lines))).toBe(true);
    const [digest] = await inAgent((a) => a.services.notifications.list({ limit: 5 }).filter((n) => n.title === "Daily summary"));
    expect(digest!.body).toContain("**Calendar today (3)**");
  });
});
