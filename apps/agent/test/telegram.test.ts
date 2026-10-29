import { env } from "cloudflare:workers";
import { DEFAULT_ALERT_PREFERENCES } from "@talorys/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/env";
import type { TalorysAgent } from "../src/agent/talorys-agent";
import { clearAccessKeys } from "../src/auth/access";
import { isRemoteAllowed } from "../src/remote/allowlist";
import { isTelegramWebhook, TelegramClient, TelegramError, telegramWebhookSecret } from "../src/telegram/client";
import type { TgUpdate } from "../src/telegram/service";
import { BASE, client, freshIp, inAgent, loggedIn } from "./helpers";

const SECRET = (env as unknown as Env).SESSION_SECRET!;
const OWNER = 1001;
const STRANGER = 2002;
const GROUP = -100500;

interface Call { method: string; params: Record<string, any> }

/**
 * A fake Bot API. Every call is recorded; `replies[method]` answers it (a function may throw a
 * TelegramError-shaped refusal by returning { ok: false, ... }).
 */
function fakeTelegram(replies: Record<string, (params: Record<string, any>) => unknown> = {}) {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    expect(url.startsWith("https://api.telegram.org/bot123456:test-telegram-token/")).toBe(true);
    const method = url.split("/").pop()!;
    const params = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ method, params });
    const reply = replies[method];
    const out = reply ? reply(params) : method === "getMe" ? { username: "talorys_test_bot" } : method === "sendMessage" ? { message_id: calls.length } : true;
    if (out && typeof out === "object" && (out as { ok?: boolean }).ok === false) return Response.json(out, { status: (out as { error_code: number }).error_code });
    return Response.json({ ok: true, result: out });
  }) as typeof fetch;
  return { calls, fetcher, sent: () => calls.filter((c) => c.method === "sendMessage") };
}

function useFake(agent: TalorysAgent, fake: ReturnType<typeof fakeTelegram>) {
  agent.services.telegram.client!.fetcher = fake.fetcher;
}

let nextUpdate = 1;
const update = (body: Omit<TgUpdate, "update_id">): TgUpdate => ({ update_id: nextUpdate++, ...body });
const privateMessage = (text: string, from = OWNER): TgUpdate =>
  update({ message: { message_id: 1, from: { id: from }, chat: { id: from, type: "private" }, text } });
const groupMessage = (text: string, from = OWNER, chat: Record<string, unknown> = {}): TgUpdate =>
  update({ message: { message_id: 1, from: { id: from }, chat: { id: GROUP, type: "supergroup", title: "Talorys alerts", ...chat }, text } });

/** Connects (fake Telegram) and returns the link code. */
async function connect(agent: TalorysAgent, fake = fakeTelegram()): Promise<string> {
  useFake(agent, fake);
  return (await agent.services.telegram.connect(BASE)).code;
}

/** Connects and links the owner's private chat. */
async function linkChat(agent: TalorysAgent, fake = fakeTelegram()): Promise<string> {
  const code = await connect(agent, fake);
  await agent.services.telegram.handle(privateMessage(`/start ${code}`));
  return code;
}

beforeEach(async () => {
  await inAgent((agent) => {
    const s = agent.services;
    s.db.run(`DELETE FROM tal_notifications`);
    s.db.run(`DELETE FROM tal_alert_deliveries`);
    s.db.run(`DELETE FROM tal_push_subscriptions`);
    s.settings.delete("alerts.preferences");
    s.settings.delete("telegram.link");
    s.settings.delete("telegram.code");
  });
});

afterEach(() => {
  clearAccessKeys();
  vi.restoreAllMocks();
});

describe("Telegram client", () => {
  it("returns the result and turns refusals into TelegramError without the token", async () => {
    const c = new TelegramClient("123456:test-telegram-token");
    c.fetcher = (async () => Response.json({ ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 7 } }, { status: 429 })) as typeof fetch;
    const error = (await c.call("sendMessage").catch((e) => e)) as TelegramError;
    expect(error).toBeInstanceOf(TelegramError);
    expect(error).toMatchObject({ code: 429, retryAfter: 7 });
    expect(String(error.message)).not.toContain("test-telegram-token");
    c.fetcher = (async () => { throw new Error("offline https://api.telegram.org/bot123456:test-telegram-token/x"); }) as typeof fetch;
    const offline = (await c.call("getMe").catch((e) => e)) as TelegramError;
    expect(offline).toMatchObject({ code: 0 });
    expect(String(offline.message)).not.toContain("test-telegram-token");
    c.fetcher = (async () => Response.json({ ok: true, result: { username: "b" } })) as typeof fetch;
    expect(await c.call("getMe")).toEqual({ username: "b" });
  });

  it("derives the webhook secret from SESSION_SECRET and compares it exactly", async () => {
    const secret = await telegramWebhookSecret(SECRET);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(await isTelegramWebhook(secret, SECRET)).toBe(true);
    expect(await isTelegramWebhook(`${secret}0`, SECRET)).toBe(false);
    expect(await isTelegramWebhook(secret.toUpperCase(), SECRET)).toBe(false);
    expect(await isTelegramWebhook("", SECRET)).toBe(false);
    expect(await isTelegramWebhook(null, SECRET)).toBe(false);
    expect(await isTelegramWebhook(secret, undefined)).toBe(false);
    expect(await telegramWebhookSecret("another secret")).not.toBe(secret);
  });
});

describe("linking", () => {
  it("points the webhook at this deployment and issues a one-time code", async () => {
    await inAgent(async (agent) => {
      const fake = fakeTelegram();
      useFake(agent, fake);
      const link = await agent.services.telegram.connect(BASE);
      expect(link.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      expect(link.chat_link).toBe(`https://t.me/talorys_test_bot?start=${link.code}`);
      expect(link.group_link).toBe(`https://t.me/talorys_test_bot?startgroup=${link.code}`);
      expect(Date.parse(link.expires_at) - Date.now()).toBeGreaterThan(9 * 60_000);
      const hook = fake.calls.find((c) => c.method === "setWebhook")!;
      expect(hook.params).toMatchObject({
        url: `${BASE}/api/telegram/webhook`,
        secret_token: await telegramWebhookSecret(SECRET),
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true,
      });
      // Only a hash of the code is stored.
      expect(JSON.stringify(agent.services.settings.getJson("telegram.code"))).not.toContain(link.code);
      expect(link.status).toMatchObject({ configured: true, bot: "talorys_test_bot", chat: false, group: null });
    });
  });

  it("links the owner's chat, then a group, and ignores everyone else", async () => {
    await inAgent(async (agent) => {
      const fake = fakeTelegram();
      const t = agent.services.telegram;
      const code = await connect(agent, fake);
      await t.handle(privateMessage("/start WRONGCOD"));
      expect(t.status().chat).toBe(false);
      // The group can't be linked before the private chat fixes the owner's account.
      await t.handle(groupMessage(`/start ${code}`));
      expect(t.status().group).toBeNull();
      await t.handle(privateMessage(`/start ${code}`));
      expect(t.status()).toMatchObject({ chat: true, group: null });
      expect(t.target()).toBe(OWNER);
      // Another account with the same code can't take over, in the chat or in the group.
      await t.handle(privateMessage(`/start ${code}`, STRANGER));
      expect(t.link().userId).toBe(OWNER);
      await t.handle(groupMessage(`/start ${code}`, STRANGER));
      expect(t.status().group).toBeNull();
      await t.handle(groupMessage(`/start@talorys_test_bot ${code}`));
      expect(t.status()).toMatchObject({ chat: true, group: "Talorys alerts", topics: false });
      expect(t.target()).toBe(GROUP);
      // The code is spent once the group is linked.
      expect(agent.services.settings.getJson("telegram.code")).toBeNull();
      expect(fake.sent().map((c) => c.params.text)).toContain("This group now receives Talorys alerts.");
    });
  });

  it("refuses an expired code", async () => {
    await inAgent(async (agent) => {
      const code = await connect(agent);
      const stored = agent.services.settings.getJson<{ hash: string; expiresAt: number }>("telegram.code")!;
      agent.services.settings.setJson("telegram.code", { ...stored, expiresAt: Date.now() - 1 });
      await agent.services.telegram.handle(privateMessage(`/start ${code}`));
      expect(agent.services.telegram.status().chat).toBe(false);
    });
  });

  it("follows a group that became a supergroup and ignores repeated updates", async () => {
    await inAgent(async (agent) => {
      const t = agent.services.telegram;
      const code = await linkChat(agent);
      await t.handle(groupMessage(`/start ${code}`));
      await t.handle(update({ message: { message_id: 2, chat: { id: GROUP, type: "group" }, migrate_to_chat_id: -100777 } }));
      expect(t.target()).toBe(-100777);
      const old = update({ message: { message_id: 3, chat: { id: -100777, type: "supergroup" }, migrate_to_chat_id: -1 } });
      agent.services.settings.setJson("telegram.link", { ...t.link(), lastUpdateId: old.update_id });
      await t.handle(old);
      expect(t.target()).toBe(-100777);
    });
  });

  it("answers the owner's other private messages and nobody else's", async () => {
    await inAgent(async (agent) => {
      const fake = fakeTelegram();
      await linkChat(agent, fake);
      const before = fake.sent().length;
      await agent.services.telegram.handle(privateMessage("hello"));
      await agent.services.telegram.handle(privateMessage("hello", STRANGER));
      const replies = fake.sent().slice(before);
      expect(replies).toHaveLength(1);
      expect(replies[0]!.params).toMatchObject({ chat_id: OWNER, text: "Talorys only sends alerts here for now. Use the app to talk to it." });
    });
  });

  it("disconnects even when Telegram is unreachable", async () => {
    await inAgent(async (agent) => {
      await linkChat(agent);
      agent.services.telegram.client!.fetcher = (async () => { throw new Error("down"); }) as typeof fetch;
      const status = await agent.services.telegram.disconnect();
      expect(status).toMatchObject({ chat: false, group: null, bot: null });
      expect(agent.services.telegram.target()).toBeNull();
    });
  });

  it("explains a refused token and an unreachable Telegram", async () => {
    await inAgent(async (agent) => {
      useFake(agent, fakeTelegram({ getMe: () => ({ ok: false, error_code: 401, description: "Unauthorized" }) }));
      await expect(agent.services.telegram.connect(BASE)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
      useFake(agent, fakeTelegram({ setWebhook: () => ({ ok: false, error_code: 502, description: "Bad Gateway" }) }));
      await expect(agent.services.telegram.connect(BASE)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    });
  });
});

describe("alerts on Telegram", () => {
  it("is skipped until a chat is linked", async () => {
    await inAgent(async (agent) => {
      agent.services.alerts.raise({ title: "Stretch", body: "Stand up", category: "reminder" });
      const rows = agent.services.db.all<{ channel: string; status: string; reason: string }>(`SELECT channel, status, reason FROM tal_alert_deliveries`);
      expect(rows).toContainEqual({ channel: "telegram", status: "skipped", reason: "no_device" });
    });
  });

  it("sends discreetly by default, the full text when the category allows it, and records the delivery", async () => {
    await inAgent(async (agent) => {
      const fake = fakeTelegram();
      const code = await linkChat(agent, fake);
      await agent.services.telegram.handle(groupMessage(`/start ${code}`));
      const before = fake.sent().length;
      const n = agent.services.alerts.raise({ title: "Pay <rent>", body: "Today & now", category: "reminder" })!;
      await agent.services.telegram.idle();
      const msg = fake.sent()[before]!.params;
      expect(msg).toMatchObject({ chat_id: GROUP, parse_mode: "HTML", disable_notification: true, link_preview_options: { is_disabled: true } });
      expect(msg.text).toContain("<b>Pay &lt;rent&gt;</b>");
      expect(msg.text).not.toContain("Today");
      expect(msg.text).toContain("Open Talorys to read it.");
      expect(msg.text).toContain("Reminders · Normal priority");
      // Normal alerts get only the "Open Talorys" button.
      expect(msg.reply_markup.inline_keyboard).toEqual([[{ text: "Open Talorys", url: BASE }]]);
      const row = agent.services.db.one<{ status: string; reached: number }>(`SELECT status, reached FROM tal_alert_deliveries WHERE notification_id = ? AND channel = 'telegram'`, n.id);
      expect(row).toEqual({ status: "sent", reached: 1 });

      agent.services.alerts.updatePreferences({ ...DEFAULT_ALERT_PREFERENCES, fullText: ["reminder"] });
      agent.services.alerts.raise({ title: "Call mom", body: "Today & now", category: "reminder", priority: "high" });
      await agent.services.telegram.idle();
      const loud = fake.sent().at(-1)!.params;
      expect(loud.text).toContain("Today &amp; now");
      expect(loud.disable_notification).toBe(false);
      expect(loud.reply_markup.inline_keyboard[0].map((b: { text: string }) => b.text)).toEqual(["Done", "Snooze 1 h"]);
    });
  });

  it("records a failed send and never throws", async () => {
    await inAgent(async (agent) => {
      await linkChat(agent, fakeTelegram({ sendMessage: () => ({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }) }));
      const n = agent.services.alerts.raise({ title: "t", body: "b", category: "routine" })!;
      await agent.services.telegram.idle();
      const row = agent.services.db.one<{ status: string; reason: string }>(`SELECT status, reason FROM tal_alert_deliveries WHERE notification_id = ? AND channel = 'telegram'`, n.id);
      expect(row).toEqual({ status: "failed", reason: "unreachable" });
    });
  });

  it("can be switched off per category, but security always goes out", async () => {
    await inAgent(async (agent) => {
      const fake = fakeTelegram();
      await linkChat(agent, fake);
      const routes = Object.fromEntries(Object.entries(DEFAULT_ALERT_PREFERENCES.routes).map(([k]) => [k, ["push"]]));
      agent.services.alerts.updatePreferences({ ...DEFAULT_ALERT_PREFERENCES, routes });
      const before = fake.sent().length;
      agent.services.alerts.raise({ title: "Quiet", body: "b", category: "routine" });
      agent.services.alerts.raise({ title: "New sign-in", body: "b", category: "security", priority: "critical" });
      await agent.services.telegram.idle();
      const texts = fake.sent().slice(before).map((c) => c.params.text as string);
      expect(texts).toHaveLength(1);
      expect(texts[0]).toContain("New sign-in");
      expect(texts[0]).toContain("🚨");
    });
  });

  it("uses one forum topic per category, and falls back when topics can't be made or were deleted", async () => {
    await inAgent(async (agent) => {
      let topic = 40;
      let threadGone = false;
      const fake = fakeTelegram({
        createForumTopic: () => ({ message_thread_id: ++topic }),
        sendMessage: (p) => (threadGone && p.message_thread_id ? { ok: false, error_code: 400, description: "Bad Request: message thread not found" } : { message_id: 1 }),
      });
      const t = agent.services.telegram;
      const code = await linkChat(agent, fake);
      await t.handle(groupMessage(`/start ${code}`, OWNER, { is_forum: true }));
      expect(t.status().topics).toBe(true);
      agent.services.alerts.raise({ title: "a", body: "b", category: "reminder" });
      await t.idle();
      agent.services.alerts.raise({ title: "c", body: "d", category: "reminder" });
      await t.idle();
      agent.services.alerts.raise({ title: "e", body: "f", category: "routine" });
      await t.idle();
      expect(fake.calls.filter((c) => c.method === "createForumTopic").map((c) => c.params.name)).toEqual(["Reminders", "Routines"]);
      expect(fake.sent().slice(-3).map((c) => c.params.message_thread_id)).toEqual([41, 41, 42]);

      threadGone = true;
      agent.services.alerts.raise({ title: "g", body: "h", category: "reminder" });
      await t.idle();
      expect(fake.sent().at(-1)!.params.message_thread_id).toBeUndefined();
      expect(t.link().topics.reminder).toBeUndefined();

      // Not an admin: createForumTopic is refused once, then not tried again.
      useFake(agent, fakeTelegram({ createForumTopic: () => ({ ok: false, error_code: 400, description: "Bad Request: not enough rights" }) }));
      threadGone = false;
      agent.services.alerts.raise({ title: "i", body: "j", category: "task" });
      await t.idle();
      expect(t.status().topics).toBe(false);
      expect(t.link().topicsUnavailable).toBe(true);
    });
  });
});

describe("buttons", () => {
  const press = (data: string, from = OWNER): TgUpdate =>
    update({ callback_query: { id: "cb1", from: { id: from }, data, message: { message_id: 9, chat: { id: OWNER, type: "private" } } } });

  it("marks an alert done, removes the buttons and answers", async () => {
    await inAgent(async (agent) => {
      const fake = fakeTelegram();
      await linkChat(agent, fake);
      const n = agent.services.alerts.raise({ title: "Pay rent", body: "b", category: "reminder", priority: "high" })!;
      await agent.services.telegram.handle(press(`n:done:${n.id}`));
      expect(agent.services.notifications.get(n.id)!.read_at).not.toBeNull();
      expect(fake.calls.find((c) => c.method === "answerCallbackQuery")!.params).toMatchObject({ callback_query_id: "cb1", text: "Marked as done." });
      expect(fake.calls.find((c) => c.method === "editMessageReplyMarkup")!.params).toMatchObject({ chat_id: OWNER, message_id: 9 });
    });
  });

  it("snoozes an alert into a one-off reminder an hour later", async () => {
    await inAgent(async (agent) => {
      await linkChat(agent);
      const n = agent.services.alerts.raise({ title: "Pay rent", body: "Before noon", category: "reminder", priority: "high" })!;
      const before = agent.services.automations.list().length;
      await agent.services.telegram.handle(press(`n:snooze:${n.id}`));
      const created = agent.services.automations.list();
      expect(created.length).toBe(before + 1);
      const reminder = created.find((a) => a.name === "Pay rent" && a.kind === "reminder")!;
      expect(reminder).toMatchObject({ message: "Before noon", enabled: true });
      expect(reminder.schedule).toMatchObject({ type: "once" });
      const at = Date.parse(`${(reminder.schedule as { at: string }).at}:00Z`);
      expect(at - Date.now()).toBeGreaterThan(59 * 60_000);
      expect(at - Date.now()).toBeLessThan(62 * 60_000);
      await agent.services.automations.delete(reminder.id);
    });
  });

  it("refuses presses from other accounts and unknown data", async () => {
    await inAgent(async (agent) => {
      const fake = fakeTelegram();
      await linkChat(agent, fake);
      const n = agent.services.alerts.raise({ title: "t", body: "b", category: "reminder", priority: "high" })!;
      await agent.services.telegram.handle(press(`n:done:${n.id}`, STRANGER));
      await agent.services.telegram.handle(press("n:delete:everything"));
      await agent.services.telegram.handle(press("n:done:missing"));
      expect(agent.services.notifications.get(n.id)!.read_at).toBeNull();
      expect(fake.calls.filter((c) => c.method === "answerCallbackQuery").map((c) => c.params.text)).toEqual([
        "Only the owner can use these buttons.",
        "This alert no longer exists.",
        "This alert no longer exists.",
      ]);
    });
  });
});

describe("webhook", () => {
  const post = async (body: unknown, headers: Record<string, string> = {}, extra: Partial<Env> = {}) =>
    worker.fetch(
      new Request(`${BASE}/api/telegram/webhook`, {
        method: "POST",
        headers: { "cf-connecting-ip": freshIp(), "content-type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      { ...(env as unknown as Env), ...extra },
    );

  it("needs the secret header, but no session, cookie or CSRF header", async () => {
    const secret = await telegramWebhookSecret(SECRET);
    expect((await post({ update_id: 1 })).status).toBe(403);
    expect((await post({ update_id: 1 }, { "x-telegram-bot-api-secret-token": "nope" })).status).toBe(403);
    const ok = await post({ update_id: 1 }, { "x-telegram-bot-api-secret-token": secret });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    // Unreadable or oversized updates are acknowledged, so Telegram does not resend them forever.
    expect((await post("not json", { "x-telegram-bot-api-secret-token": secret })).status).toBe(200);
    expect((await post({ update_id: -5 }, { "x-telegram-bot-api-secret-token": secret })).status).toBe(200);
    expect((await post({ update_id: 2, pad: "x".repeat(70 * 1024) }, { "x-telegram-bot-api-secret-token": secret })).status).toBe(200);
  });

  it("links the chat end to end through the webhook", async () => {
    const code = await inAgent((agent) => connect(agent));
    const res = await post(privateMessage(`/start ${code}`), { "x-telegram-bot-api-secret-token": await telegramWebhookSecret(SECRET) });
    expect(res.status).toBe(200);
    await inAgent(async (agent) => {
      await agent.services.telegram.idle();
      expect(agent.services.telegram.status().chat).toBe(true);
    });
  });

  it("passes Cloudflare Access only with the secret header", async () => {
    const access = { TALORYS_ACCESS_TEAM_DOMAIN: "myteam.cloudflareaccess.com", TALORYS_ACCESS_AUD: "0123456789abcdef".repeat(4) };
    vi.spyOn(globalThis, "fetch").mockImplementation((async () => Response.json({ keys: [] })) as typeof fetch);
    const secret = await telegramWebhookSecret(SECRET);
    expect((await post({ update_id: 1 }, {}, access)).status).toBe(403);
    expect((await post({ update_id: 1 }, { "x-telegram-bot-api-secret-token": "nope" }, access)).status).toBe(403);
    expect((await post({ update_id: 1 }, { "x-telegram-bot-api-secret-token": secret, cookie: "talorys_session=x" }, access)).status).toBe(403);
    expect((await post({ update_id: 1 }, { "x-telegram-bot-api-secret-token": secret }, access)).status).toBe(200);
  });
});

describe("Telegram API", () => {
  it("shows the status, connects, tests and unlinks for the signed-in owner", async () => {
    const c = await loggedIn();
    const fake = fakeTelegram();
    await inAgent((agent) => useFake(agent, fake));
    expect(await c.json("/api/telegram")).toEqual({ status: { configured: true, bot: null, chat: false, group: null, topics: false, linked_at: null } });
    const link = await c.json("/api/telegram/connect", { method: "POST" });
    expect(link.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect((await c.call("/api/telegram/test", { method: "POST" })).status).toBe(503);
    await inAgent((agent) => agent.services.telegram.handle(privateMessage(`/start ${link.code}`)));
    expect(await c.json("/api/telegram/test", { method: "POST" })).toMatchObject({ sent: true });
    expect(fake.sent().at(-1)!.params).toMatchObject({ chat_id: OWNER, text: "Test message: Telegram alerts work." });
    expect((await c.json("/api/telegram", { method: "DELETE" })).status).toMatchObject({ chat: false });
    expect(fake.calls.some((x) => x.method === "deleteWebhook")).toBe(true);
  });

  it("asks for the password again before connecting or unlinking on an old session", async () => {
    const c = await loggedIn();
    await inAgent((agent) => {
      useFake(agent, fakeTelegram());
      agent.services.db.run(`UPDATE tal_sessions SET confirmed_at = '2000-01-01T00:00:00.000Z'`);
    });
    expect((await c.call("/api/telegram/connect", { method: "POST" })).status).toBe(403);
    expect((await c.call("/api/telegram", { method: "DELETE" })).status).toBe(403);
    expect((await c.call("/api/telegram")).status).toBe(200);
  });

  it("is closed to anonymous requests and access tokens", async () => {
    for (const [method, path] of [["GET", "/api/telegram"], ["POST", "/api/telegram/connect"], ["POST", "/api/telegram/test"], ["DELETE", "/api/telegram"]] as const) {
      expect((await client().call(path, { method })).status).toBe(401);
      expect(isRemoteAllowed(method, path)).toBe(false);
    }
    expect(isRemoteAllowed("POST", "/api/telegram/webhook")).toBe(false);
  });
});

describe("preferences saved before Telegram", () => {
  it("turn Telegram on where the category was going out, and keep the owner's other choices", async () => {
    await inAgent((agent) => {
      const old = Object.fromEntries(Object.keys(DEFAULT_ALERT_PREFERENCES.routes).map((k) => [k, k === "system" ? [] : ["push"]]));
      agent.services.settings.setJson("alerts.preferences", { routes: old, limits: { perHour: 9, perDay: 90 } });
      const prefs = agent.services.alerts.preferences();
      expect(prefs.routes.reminder).toEqual(["push", "telegram"]);
      // A category the owner kept in the app stays there.
      expect(prefs.routes.system).toEqual([]);
      expect(prefs.limits).toEqual({ perHour: 9, perDay: 90 });
      expect(prefs.fullText).toEqual([]);
      // Once saved with the new shape, turning Telegram off sticks.
      agent.services.alerts.updatePreferences({ ...prefs, routes: { ...prefs.routes, reminder: ["push"] } });
      expect(agent.services.alerts.preferences().routes.reminder).toEqual(["push"]);
    });
  });
});
