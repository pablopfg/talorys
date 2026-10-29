import { EVENT_ALERTS, REMOTE_EVENTS } from "@talorys/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrations";
import { isRemoteAllowed } from "../src/remote/allowlist";
import { bearer, inAgent, loggedIn } from "./helpers";
import { fakeBrowser, pushServiceStub } from "./push-helpers";

async function mint(scope: "read" | "write" | "events"): Promise<string> {
  return inAgent(async (agent) => {
    agent.services.remote.setEnabled(true);
    return (await agent.services.remote.create({ name: `${scope} token`, scope })).token;
  });
}

beforeEach(async () => {
  await inAgent((agent) => {
    const s = agent.services;
    s.remote.revokeAll();
    s.remote.setEnabled(false);
    for (const table of ["tal_notifications", "tal_alert_deliveries", "tal_alert_profiles", "tal_push_subscriptions"]) s.db.run(`DELETE FROM ${table}`);
    s.settings.delete("remote.events.sent");
    s.push.fetcher = pushServiceStub(201).fetcher;
  });
});

const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string; message: string } }).error;

describe("events from outside systems", () => {
  it("turns an event into an alert in the Events category, with links defanged", async () => {
    const b = bearer(await mint("events"));
    const res = await b.call("/api/remote/events", {
      method: "POST",
      body: { title: "Backup failed\non https://evil.example", body: "See [the log](https://evil.example/log).", priority: "high", source: "n8n", kind: "backup-failed", id: "run-42" },
    });
    expect(res.status).toBe(201);
    const result = (await res.json()) as { event: { id: string; priority: string }; duplicate: boolean };
    expect(result).toMatchObject({ duplicate: false, event: { priority: "high" } });
    await inAgent((agent) => {
      const n = agent.services.notifications.get(result.event.id)!;
      expect(n).toMatchObject({ category: "event", priority: "high", title: "n8n: Backup failed on `hxxps://evil[.]example`", profile: "event:n8n-backup-failed" });
      // Not clickable anywhere: backticks for the app, hxxps and [.] for Telegram and mail clients.
      expect(n.body).toBe("See the log (`hxxps://evil[.]example/log`).");
    });
  });

  it("can't pass for Talorys, nor carry an address without http", async () => {
    const b = bearer(await mint("events"));
    const res = await b.call("/api/remote/events", {
      method: "POST",
      body: { title: "Password changed", body: "Check www.evil.com and evil.example/verify", source: "Talorys" },
    });
    expect(res.status).toBe(201);
    const result = (await res.json()) as { event: { id: string } };
    await inAgent((agent) => {
      const n = agent.services.notifications.get(result.event.id)!;
      expect(n.title).toBe("remote: Password changed");
      expect(n.body).toBe("Check `www[.]evil[.]com` and evil[.]example/verify");
    });
  });

  it("drops a repeat of the same id, and defaults to normal priority", async () => {
    const b = bearer(await mint("events"));
    const send = (body: object) => b.call("/api/remote/events", { method: "POST", body });
    expect((await send({ title: "Disk almost full", source: "n8n", id: "disk-1" })).status).toBe(201);
    const again = await send({ title: "Disk almost full", source: "n8n", id: "disk-1" });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ event: null, duplicate: true });
    // Another source with the same id is another event.
    expect((await send({ title: "Disk almost full", source: "monitor", id: "disk-1" })).status).toBe(201);
    await inAgent((agent) => {
      const list = agent.services.notifications.list({ limit: 10 });
      expect(list).toHaveLength(2);
      expect(list.every((n) => n.priority === "normal")).toBe(true);
    });
  });

  it("refuses critical, unknown fields of the wrong shape, and bodies over 2 KB", async () => {
    const b = bearer(await mint("events"));
    const send = (body: unknown) => b.call("/api/remote/events", { method: "POST", body });
    expect((await send({ title: "Fire", priority: "critical" })).status).toBe(400);
    expect((await send({ title: "" })).status).toBe(400);
    expect((await send({ title: "x".repeat(121) })).status).toBe(400);
    expect((await send({ title: "Ok", source: "bad source!" })).status).toBe(400);
    expect((await send({ title: "Ok", id: "has spaces" })).status).toBe(400);
    expect((await send({ title: "Ok", body: "y".repeat(2100) })).status).toBe(400);
    await inAgent((agent) => expect(agent.services.notifications.list({ limit: 10 })).toHaveLength(0));
  });

  it(`takes at most ${REMOTE_EVENTS.perHour} events an hour`, async () => {
    const b = bearer(await mint("events"));
    await inAgent((agent) => {
      const now = Date.now();
      agent.services.settings.setJson("remote.events.sent", Array.from({ length: REMOTE_EVENTS.perHour }, (_, i) => now - i * 1000));
    });
    const res = await b.call("/api/remote/events", { method: "POST", body: { title: "One more" } });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    // Old entries leave the window.
    await inAgent((agent) => agent.services.settings.setJson("remote.events.sent", [Date.now() - 2 * 3_600_000]));
    expect((await b.call("/api/remote/events", { method: "POST", body: { title: "One more" } })).status).toBe(201);
  });

  it(`takes at most ${REMOTE_EVENTS.perDay} events in 24 hours`, async () => {
    const b = bearer(await mint("events"));
    await inAgent((agent) => {
      const now = Date.now();
      // Spread over the day, so the hourly limit is not the one hit.
      agent.services.settings.setJson("remote.events.sent", Array.from({ length: REMOTE_EVENTS.perDay }, (_, i) => now - 2 * 3_600_000 - i * 60_000));
    });
    const res = await b.call("/api/remote/events", { method: "POST", body: { title: "One more" } });
    expect(res.status).toBe(429);
    expect((await errorCode(res)).message).toBe(`At most ${REMOTE_EVENTS.perDay} events a day. Please wait before sending more.`);
  });

  it("can't crowd out the owner's alerts: half of each channel limit, 3 insisting at once, 50 learned kinds", async () => {
    await inAgent(async (agent) => {
      const s = agent.services;
      s.push.subscriptions.save({ ...(await fakeBrowser()).json.keys, endpoint: "https://fcm.googleapis.com/fcm/send/e2e", label: "Phone", origin: "https://exemplo.com.br" });
      s.alerts.updatePreferences({ ...s.alerts.preferences(), limits: { perHour: 6, perDay: 30 } });
      const send = (i: number, priority: "normal" | "high" = "normal") =>
        s.remoteEvents.receive({ title: `Event ${i}`, source: "n8n", kind: "k", priority });
      for (let i = 0; i < 4; i++) send(i);
      const pushed = s.db.all<{ status: string; reason: string | null }>(`SELECT status, reason FROM tal_alert_deliveries WHERE channel = 'push' ORDER BY created_at, rowid`);
      // 3 of the 6 an hour go out; the 4th waits in the app, leaving the rest for the owner's alerts.
      expect(pushed.filter((d) => d.status !== "skipped")).toHaveLength(3);
      expect(pushed.at(-1)).toMatchObject({ status: "skipped", reason: "rate_limited" });
      s.alerts.raise({ title: "Owner routine", body: "", category: "routine" });
      expect(s.db.one<{ n: number }>(`SELECT count(*) AS n FROM tal_alert_deliveries WHERE channel = 'push' AND status != 'skipped'`)!.n).toBe(4);

      s.db.run(`DELETE FROM tal_alert_deliveries`);
      s.db.run(`DELETE FROM tal_notifications`);
      s.alerts.updatePreferences({ ...s.alerts.preferences(), limits: { perHour: 60, perDay: 100 } });
      for (let i = 0; i < 5; i++) send(10 + i, "high");
      expect(s.notifications.activeEscalations("event")).toBe(EVENT_ALERTS.maxActiveEscalations);
      await s.push.idle();
    });
    await inAgent((agent) => {
      const s = agent.services;
      s.db.run(`DELETE FROM tal_alert_profiles`);
      for (let i = 0; i < REMOTE_EVENTS.maxProfiles + 5; i++) {
        s.settings.delete("remote.events.sent");
        s.remoteEvents.receive({ title: "x", source: "n8n", kind: `kind-${i}`, priority: "low" });
      }
      const keys = s.db.all<{ key: string }>(`SELECT key FROM tal_alert_profiles WHERE category = 'event'`).map((r) => r.key);
      expect(keys).toHaveLength(REMOTE_EVENTS.maxProfiles + 1);
      expect(keys).toContain("event:other");
    });
  });

  it("keeps events tokens to events, and every other caller away from events", async () => {
    const events = bearer(await mint("events"));
    for (const [method, path] of [["GET", "/api/tasks"], ["POST", "/api/tasks"], ["GET", "/api/health"], ["GET", "/api/remote/events"], ["GET", "/api/notifications"]] as const) {
      const res = await events.call(path, { method, body: method === "POST" ? { title: "x" } : undefined });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect((await errorCode(res)).message).toBe("This access token can only send events.");
    }
    for (const scope of ["read", "write"] as const) {
      const res = await bearer(await mint(scope)).call("/api/remote/events", { method: "POST", body: { title: "x" } });
      expect(res.status, scope).toBe(403);
    }
    // The owner's session can't send them either: they would skip being marked as outside events.
    const owner = await loggedIn();
    const res = await owner.call("/api/remote/events", { method: "POST", body: { title: "x" } });
    expect(res.status).toBe(403);
    expect((await errorCode(res)).message).toBe("Only an events access token can send events.");
    // The general allowlist never includes it.
    expect(isRemoteAllowed("POST", "/api/remote/events")).toBe(false);
    await inAgent((agent) => expect(agent.services.notifications.list({ limit: 10 })).toHaveLength(0));
  });

  it("creates events tokens like the others, and older tokens survive the migration", async () => {
    const owner = await loggedIn();
    await inAgent((agent) => agent.services.remote.setEnabled(true));
    const res = await owner.json("/api/remote/tokens", { method: "POST", body: { name: "n8n", scope: "events" } });
    expect(res.token).toMatchObject({ name: "n8n", scope: "events" });
    const { tokens } = await owner.json("/api/remote/tokens");
    expect(tokens.map((t: { scope: string }) => t.scope)).toContain("events");
  });

  it("migration 23 keeps every token, still valid, and leaves no copy of them behind", async () => {
    const token = await mint("write");
    await inAgent(async (agent) => {
      const db = agent.services.db;
      // Back to the v22 shape: the CHECK without "events".
      db.run(`ALTER TABLE tal_remote_tokens RENAME TO tal_remote_tokens_now`);
      db.run(`DROP TABLE IF EXISTS tal_remote_tokens_v8`);
      db.run(`CREATE TABLE tal_remote_tokens (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, hint TEXT NOT NULL,
        scope TEXT NOT NULL CHECK (scope IN ('read','write')), created_at TEXT NOT NULL, last_used_at TEXT, expires_at TEXT)`);
      db.run(`INSERT INTO tal_remote_tokens SELECT id, name, token_hash, hint, scope, created_at, last_used_at, expires_at FROM tal_remote_tokens_now`);
      db.run(`DROP TABLE tal_remote_tokens_now`);
      expect(() => db.run(`UPDATE tal_remote_tokens SET scope = 'events'`)).toThrow();
      db.run(`ALTER TABLE tal_automations DROP COLUMN sentinel`);
      db.run(`UPDATE tal_schema SET version = 22`);
      migrate(db);
      expect(db.one<{ n: number }>(`SELECT count(*) AS n FROM tal_remote_tokens_v8`)!.n).toBe(0);
      expect(agent.services.remote.list().map((t) => t.scope)).toEqual(["write"]);
    });
    expect((await bearer(token).call("/api/tasks")).status).toBe(200);
  });
});
