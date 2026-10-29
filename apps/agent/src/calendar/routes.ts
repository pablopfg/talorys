import { calendarModeSchema, calendarNoticeSchema, googleCalendarCallbackSchema } from "@talorys/shared";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../api/app";
import { AppError } from "../api/errors";
import { body, requireRecentAuth } from "../api/middleware";
import { raiseSecurityAlert } from "../alerts/security";
import { CalendarError } from "./service";

/** Owner sessions only: access tokens never manage the calendar connection. */
const ownerOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("remote") || !c.get("sessionId")) throw new AppError("FORBIDDEN", "Google Calendar can only be managed from the Axis app.");
  return next();
};

/** The Axis address the owner is using, for Google to return to. The CSRF check already refused any other Origin. */
const appOrigin = (c: Context<AppEnv>) => c.req.header("origin") ?? new URL(c.req.url).origin;

/** Google's answers become safe messages; nothing from Google's response reaches the browser. */
async function google<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof CalendarError) throw new AppError("SERVICE_UNAVAILABLE", error.message);
    throw error;
  }
}

/**
 * Owner management of the Google Calendar connection. No part of this is a tool: the agent can
 * never connect an account or open a calendar to itself. Responses never include tokens.
 */
export const calendarRoutes = new Hono<AppEnv>();

calendarRoutes.use("/calendar/*", ownerOnly);

calendarRoutes.get("/calendar/google", (c) => c.json(c.env.agent.services.calendar.status()));

/** Where to send the owner to allow access. Needs the password typed recently. */
calendarRoutes.post("/calendar/google/connect", async (c) => {
  requireRecentAuth(c);
  return c.json({ authorize_url: await c.env.agent.services.calendar.beginConnect(appOrigin(c)) });
});

/** Google's answer, forwarded by the callback page with the owner's session. */
calendarRoutes.post("/calendar/google/callback", async (c) => {
  const input = await body(c, googleCalendarCallbackSchema, 8 * 1024);
  const s = c.env.agent.services;
  const status = await google(() => s.calendar.finishConnect(input));
  raiseSecurityAlert(s.alerts, "calendar_connected");
  return c.json(status);
});

calendarRoutes.post("/calendar/google/refresh", async (c) => c.json(await google(() => c.env.agent.services.calendar.refreshCalendars())));

/** What the agent may do with one calendar. Opening one to the agent needs the password typed recently; closing it never does. */
calendarRoutes.patch("/calendar/google/calendars/:id", async (c) => {
  const { mode } = await body(c, calendarModeSchema, 1024);
  if (mode !== "off") requireRecentAuth(c);
  const s = c.env.agent.services;
  const calendar = s.calendar.setMode(c.req.param("id"), mode);
  s.activity.record("calendar.mode", `Calendar “${calendar.name}”: ${mode}`);
  return c.json({ calendar });
});

/** A notice before the calendar's first event of the day, sent to the owner (the agent isn't involved). */
calendarRoutes.put("/calendar/google/calendars/:id/notice", async (c) => {
  const { notice } = await body(c, calendarNoticeSchema, 2048);
  const s = c.env.agent.services;
  const calendar = s.calendar.setNotice(c.req.param("id"), notice);
  s.activity.record(
    "calendar.notice",
    notice ? `Calendar “${calendar.name}”: notice ${notice.minutes} min before the first event` : `Calendar “${calendar.name}”: notice off`,
  );
  return c.json({ calendar });
});

calendarRoutes.delete("/calendar/google", async (c) => {
  await c.env.agent.services.calendar.disconnect();
  return c.json({ disconnected: true });
});
