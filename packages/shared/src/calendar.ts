import { z } from "zod";

/**
 * Google Calendar: one Google account, connected with OAuth. Each of its calendars is off for the
 * agent, readable, or readable and writable; the agent's changes always go through an approval.
 */
export const CALENDAR_MODES = ["off", "read", "write"] as const;
export type CalendarMode = (typeof CALENDAR_MODES)[number];

/** Where Google sends the browser back after the owner allows access. */
export const GOOGLE_CALENDAR_CALLBACK_PATH = "/settings/google-calendar";

export interface GoogleCalendarInfo {
  id: string;
  name: string;
  /** Google's role for the account: owner, writer, reader or freeBusyReader. */
  access_role: string;
  time_zone: string | null;
  primary: boolean;
  mode: CalendarMode;
  /** Whether Google lets this account change events there (owner or writer). */
  writable: boolean;
}

export interface GoogleCalendarStatus {
  /** GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and MCP_CREDENTIAL_KEY are set. */
  configured: boolean;
  connected: boolean;
  email: string | null;
  status: "connected" | "error" | null;
  error: string | null;
  connected_at: string | null;
  calendars: GoogleCalendarInfo[];
}

export const calendarModeSchema = z.object({ mode: z.enum(CALENDAR_MODES) });

export const googleCalendarCallbackSchema = z.object({
  state: z.string().min(16).max(200),
  code: z.string().min(1).max(2048).optional(),
  error: z.string().max(200).optional(),
});
