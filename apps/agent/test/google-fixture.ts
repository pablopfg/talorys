import type { CalendarNetwork } from "../src/calendar/service";

export interface FakeEvent {
  id: string;
  calendar: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  etag: string;
  location?: string;
  description?: string;
  status?: string;
}

/** A fake Google (OAuth and Calendar API) that checks what Talorys sends, and records it. */
export function googleFixture() {
  const state = {
    code: "good-code",
    challenge: null as string | null,
    access: "at-1",
    refresh: "rt-1",
    tokens: 1,
    scope: "https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events",
    refreshRevoked: false,
    revoked: [] as string[],
    requests: [] as { method: string; url: string; body: string | null; ifMatch: string | null; redirect: string | undefined }[],
    calendars: [
      { id: "owner@example.com", summary: "Owner", accessRole: "owner", timeZone: "UTC", primary: true },
      { id: "clinic@group.calendar.google.com", summary: "Clinic", accessRole: "reader", timeZone: "UTC" },
      { id: "busy@group.calendar.google.com", summary: "Busy only", accessRole: "freeBusyReader" },
    ],
    events: [] as FakeEvent[],
    created: [] as Record<string, unknown>[],
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const sha256b64url = async (text: string) =>
    btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const network: CalendarNetwork = {
    fetch: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? "GET";
      const headers = new Headers(init.headers);
      const body = typeof init.body === "string" ? init.body : null;
      state.requests.push({ method, url: url.href, body, ifMatch: headers.get("if-match"), redirect: init.redirect });
      if (url.href === "https://oauth2.googleapis.com/token") {
        const form = new URLSearchParams(body ?? "");
        if (form.get("client_secret") !== "test-google-client-secret") return json({ error: "invalid_client" }, 401);
        if (form.get("grant_type") === "authorization_code") {
          if (form.get("code") !== state.code || !state.challenge || (await sha256b64url(form.get("code_verifier") ?? "")) !== state.challenge) {
            return json({ error: "invalid_grant" }, 400);
          }
          return json({ access_token: state.access, refresh_token: state.refresh, expires_in: 3600, scope: state.scope, token_type: "Bearer" });
        }
        if (form.get("grant_type") === "refresh_token") {
          if (state.refreshRevoked || form.get("refresh_token") !== state.refresh) return json({ error: "invalid_grant" }, 400);
          state.access = `at-${++state.tokens}`;
          return json({ access_token: state.access, expires_in: 3600, token_type: "Bearer" });
        }
        return json({ error: "unsupported_grant_type" }, 400);
      }
      if (url.href === "https://oauth2.googleapis.com/revoke") {
        state.revoked.push(new URLSearchParams(body ?? "").get("token") ?? "");
        return new Response(null, { status: 200 });
      }
      if (headers.get("authorization") !== `Bearer ${state.access}`) return json({ error: { code: 401 } }, 401);
      const path = url.pathname.replace("/calendar/v3", "");
      if (path === "/users/me/calendarList") return json({ items: state.calendars });
      const m = /^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(path);
      if (!m) return json({ error: { code: 404 } }, 404);
      const calendar = decodeURIComponent(m[1]!);
      const eventId = m[2] ? decodeURIComponent(m[2]) : null;
      if (!eventId && method === "GET") {
        const min = Date.parse(url.searchParams.get("timeMin") ?? "");
        const max = Date.parse(url.searchParams.get("timeMax") ?? "");
        const q = url.searchParams.get("q")?.toLowerCase();
        const items = state.events.filter((e) => {
          const at = Date.parse(e.start.dateTime ?? `${e.start.date}T00:00:00Z`);
          return e.calendar === calendar && at >= min && at < max && (!q || e.summary.toLowerCase().includes(q));
        });
        return json({ items });
      }
      if (!eventId && method === "POST") {
        const created = { ...(JSON.parse(body ?? "{}") as Record<string, unknown>), calendar, sendUpdates: url.searchParams.get("sendUpdates") };
        state.created.push(created);
        return json({ id: `new-${state.created.length}`, ...created });
      }
      const event = state.events.find((e) => e.calendar === calendar && e.id === eventId);
      if (!event) return json({ error: { code: 404 } }, 404);
      if (method === "GET") return json(event);
      if (headers.get("if-match") && headers.get("if-match") !== event.etag) return json({ error: { code: 412 } }, 412);
      if (method === "PATCH") {
        Object.assign(event, JSON.parse(body ?? "{}"), { etag: `${event.etag}+` });
        return json(event);
      }
      if (method === "DELETE") {
        state.events = state.events.filter((e) => e !== event);
        return new Response(null, { status: 204 });
      }
      return json({ error: { code: 405 } }, 405);
    }) as typeof fetch,
  };
  return { state, network };
}
