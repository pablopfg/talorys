import { env } from "cloudflare:workers";
import { DEFAULT_ALERT_PREFERENCES, TRANSCRIPTION_LIMITS } from "@talorys/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/env";
import type { TalorysAgent } from "../src/agent/talorys-agent";
import { clearAccessKeys } from "../src/auth/access";
import { isRemoteAllowed } from "../src/remote/allowlist";
import { bytesToBase64, isTelegramWebhook, TelegramClient, TelegramError, telegramWebhookSecret } from "../src/telegram/client";
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
function fakeTelegram(replies: Record<string, (params: Record<string, any>) => unknown> = {}, files: Record<string, () => Response> = {}) {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const filePrefix = "https://api.telegram.org/file/bot123456:test-telegram-token/";
    if (url.startsWith(filePrefix)) {
      const path = url.slice(filePrefix.length);
      calls.push({ method: "download", params: { path } });
      return files[path]?.() ?? new Response("Not Found", { status: 404 });
    }
    expect(url.startsWith("https://api.telegram.org/bot123456:test-telegram-token/")).toBe(true);
    const method = url.split("/").pop()!;
    const params = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ method, params });
    const reply = replies[method];
    const out = reply ? await reply(params) : method === "getMe" ? { username: "talorys_test_bot" } : method === "sendMessage" ? { message_id: calls.length } : true;
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
/** A voice message (or, with `kind: "audio"`, an audio file) from the owner. */
const voiceMessage = (file: { file_id?: string; duration?: number; file_size?: number }, kind: "voice" | "audio" = "voice", from = OWNER): TgUpdate =>
  update({ message: { message_id: 1, from: { id: from }, chat: { id: from, type: "private" }, [kind]: { file_id: "voice-1", duration: 4, ...file } } });
/** A fake Bot API that serves one voice file of `bytes` bytes. */
const voiceTelegram = (bytes = 16_000, replies: Record<string, (params: Record<string, any>) => unknown> = {}) =>
  fakeTelegram(
    { getFile: () => ({ file_id: "voice-1", file_size: bytes, file_path: "voice/file_1.oga" }), ...replies },
    { "voice/file_1.oga": () => new Response(new Uint8Array(bytes).fill(7)) },
  );
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
    s.db.run(`DELETE FROM tal_alert_profiles`);
    s.db.run(`DELETE FROM tal_alert_corrections`);
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
      const fake = fakeTelegram();
      const t = agent.services.telegram;
      const code = await linkChat(agent, fake);
      await t.handle(groupMessage(`/start ${code}`));
      await t.handle(update({ message: { message_id: 2, chat: { id: GROUP, type: "group" }, migrate_to_chat_id: -100777 } }));
      expect(t.target()).toBe(-100777);
      const help = privateMessage("/help");
      await t.handle(help);
      await t.handle(help);
      expect(fake.sent().filter((c) => c.params.text?.startsWith("Write or send a voice message"))).toHaveLength(1);
    });
  });

  it("keeps working when Telegram restarts update ids at a lower number or sends them out of order", async () => {
    await inAgent(async (agent) => {
      const fake = fakeTelegram();
      const t = agent.services.telegram;
      await linkChat(agent, fake);
      await t.handle({ ...privateMessage("/help"), update_id: 900_000 });
      await t.handle({ ...privateMessage("/help"), update_id: 5 });
      await t.handle({ ...privateMessage("/help"), update_id: 899_999 });
      expect(fake.sent().filter((c) => c.params.text?.startsWith("Write or send a voice message"))).toHaveLength(3);
      // Only the last 100 ids are kept.
      for (let i = 0; i < 120; i++) await t.handle({ ...privateMessage("/help"), update_id: 1_000_000 + i });
      expect(t.link().seenUpdates).toHaveLength(100);
    });
  });

  it("stores nothing for strangers and leaves groups it was not linked to", async () => {
    await inAgent(async (agent) => {
      const fake = fakeTelegram();
      const t = agent.services.telegram;
      await linkChat(agent, fake);
      const before = JSON.stringify(t.link());
      await t.handle(privateMessage("spam", STRANGER));
      await t.handle(update({ message: { message_id: 1, from: { id: STRANGER }, chat: { id: -100999, type: "supergroup", title: "Other" }, text: "hi bot" } }));
      await t.handle(update({ callback_query: { id: "x", from: { id: STRANGER }, data: "n:done:abc" } }));
      expect(JSON.stringify(t.link())).toBe(before);
      expect(fake.calls.filter((c) => c.method === "leaveChat").map((c) => c.params.chat_id)).toEqual([-100999]);
    });
  });

  it("answers the owner's other private messages and nobody else's", async () => {
    await inAgent(async (agent) => {
      const fake = fakeTelegram();
      await linkChat(agent, fake);
      const before = fake.sent().length;
      await agent.services.telegram.handle(privateMessage("/help"));
      await agent.services.telegram.handle(privateMessage("/help", STRANGER));
      const replies = fake.sent().slice(before);
      expect(replies).toHaveLength(1);
      expect(replies[0]!.params).toMatchObject({ chat_id: OWNER });
      expect(replies[0]!.params.text).toMatch(/^Write or send a voice message to talk to Talorys/);
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
      // Normal alerts get only "Change priority" and "Open Talorys".
      expect(msg.reply_markup.inline_keyboard).toEqual([[{ text: "Change priority", callback_data: `c:${n.id}` }], [{ text: "Open Talorys", url: BASE }]]);
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

describe("forum topics under load", () => {
  it("creates one topic for alerts raised together, and keeps trying after a transient failure", async () => {
    await inAgent(async (agent) => {
      let topic = 70;
      let down = true;
      const fake = fakeTelegram({
        createForumTopic: () => (down ? { ok: false, error_code: 429, description: "Too Many Requests" } : { message_thread_id: ++topic }),
      });
      const t = agent.services.telegram;
      const code = await linkChat(agent, fake);
      await t.handle(groupMessage(`/start ${code}`, OWNER, { is_forum: true }));
      agent.services.alerts.raise({ title: "a", body: "b", category: "digest" });
      await t.idle();
      // A rate limit is not a refusal: topics stay on.
      expect(t.link().topicsUnavailable).toBe(false);
      down = false;
      agent.services.alerts.raise({ title: "c", body: "d", category: "digest" });
      agent.services.alerts.raise({ title: "e", body: "f", category: "digest" });
      await t.idle();
      expect(fake.calls.filter((c) => c.method === "createForumTopic" && c.params.name === "Digests")).toHaveLength(2);
      expect(fake.sent().slice(-2).map((c) => c.params.message_thread_id)).toEqual([71, 71]);
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

  it("acts once on repeated presses, and keeps a discreet category's text out of the snoozed reminder", async () => {
    await inAgent(async (agent) => {
      const fake = fakeTelegram();
      await linkChat(agent, fake);
      agent.services.alerts.updatePreferences({ ...DEFAULT_ALERT_PREFERENCES, fullText: ["reminder"] });
      const n = agent.services.alerts.raise({ title: "Odd sign-in", body: "From a new country", category: "security", priority: "high" })!;
      const before = agent.services.automations.list().length;
      await agent.services.telegram.handle(press(`n:snooze:${n.id}`));
      await agent.services.telegram.handle(press(`n:snooze:${n.id}`));
      const created = agent.services.automations.list();
      expect(created.length).toBe(before + 1);
      const reminder = created.find((a) => a.name === "Odd sign-in")!;
      expect(reminder.message).toBe("Snoozed alert. Its full text is in the notification center.");
      expect(fake.calls.filter((c) => c.method === "answerCallbackQuery").map((c) => c.params.text)).toEqual(["Snoozed for 1 hour.", "This alert was already handled."]);
      await agent.services.automations.delete(reminder.id);
    });
  });

  it("corrects an alert's priority from its buttons, and offers no correction on security alerts", async () => {
    await inAgent(async (agent) => {
      const fake = fakeTelegram();
      await linkChat(agent, fake);
      const n = agent.services.alerts.raise({ title: "Weekly report", body: "b", category: "routine" })!;
      await agent.services.telegram.idle();
      expect(fake.sent().at(-1)!.params.reply_markup.inline_keyboard[0]).toEqual([{ text: "Change priority", callback_data: `c:${n.id}` }]);
      await agent.services.telegram.handle(press(`c:${n.id}`));
      const edits = () => fake.calls.filter((c) => c.method === "editMessageReplyMarkup");
      expect(edits().at(-1)!.params.reply_markup.inline_keyboard).toEqual([
        [
          { text: "Low", callback_data: `p:low:${n.id}` },
          { text: "✓ Normal", callback_data: `p:normal:${n.id}` },
          { text: "High", callback_data: `p:high:${n.id}` },
        ],
        [{ text: "Back", callback_data: `k:${n.id}` }],
      ]);
      await agent.services.telegram.handle(press(`p:high:${n.id}`));
      expect(agent.services.notifications.get(n.id)).toMatchObject({ priority: "high", priority_reason: "corrected" });
      expect(fake.calls.filter((c) => c.method === "answerCallbackQuery").at(-1)!.params.text).toBe("Priority changed to High. Talorys learns from this.");
      // Back on the alert's own buttons, now with the ones of a high alert.
      expect(edits().at(-1)!.params.reply_markup.inline_keyboard[0][0]).toEqual({ text: "Done", callback_data: `n:done:${n.id}` });
      await agent.services.telegram.handle(press(`k:${n.id}`));
      expect(edits().at(-1)!.params.reply_markup.inline_keyboard.at(-2)).toEqual([{ text: "Change priority", callback_data: `c:${n.id}` }]);
      // Someone else in the group can't correct anything.
      await agent.services.telegram.handle(press(`p:low:${n.id}`, STRANGER));
      expect(agent.services.notifications.get(n.id)!.priority).toBe("high");
      // Gone, or a forged press on a security alert: nothing changes.
      await agent.services.telegram.handle(press(`p:low:missing`));
      expect(fake.calls.filter((c) => c.method === "answerCallbackQuery").at(-1)!.params.text).toBe("This alert no longer exists.");
      const security = agent.services.alerts.raise({ title: "New sign-in", body: "b", category: "security", priority: "critical" })!;
      await agent.services.telegram.idle();
      expect(fake.sent().at(-1)!.params.reply_markup.inline_keyboard.flat().some((b: { callback_data?: string }) => b.callback_data?.startsWith("c:"))).toBe(false);
      await agent.services.telegram.handle(press(`p:low:${security.id}`));
      expect(agent.services.notifications.get(security.id)!.priority).toBe("critical");
      expect(fake.calls.filter((c) => c.method === "answerCallbackQuery").at(-1)!.params.text).toBe("Security alerts are always critical.");
      await agent.services.telegram.handle(press(`n:done:${security.id}`));
    });
  });

  it("explains a learned priority in the alert", async () => {
    await inAgent(async (agent) => {
      const fake = fakeTelegram();
      await linkChat(agent, fake);
      agent.services.db.run(
        `INSERT INTO tal_alert_profiles (id, key, category, shift, created_at, updated_at) VALUES ('p1', 'routine:general', 'routine', 1, ?, ?)`,
        new Date().toISOString(), new Date().toISOString(),
      );
      agent.services.alerts.raise({ title: "Learned", body: "b", category: "routine" });
      await agent.services.telegram.idle();
      expect(fake.sent().at(-1)!.params.text).toContain("Routines · High priority · Louder than usual: learned from how you handle these alerts");
      agent.services.db.run(`DELETE FROM tal_alert_profiles`);
    });
  });

  it("shows Mute under insistent alerts, and muting stops the insistence but keeps the alert unread", async () => {
    await inAgent(async (agent) => {
      const fake = fakeTelegram();
      await linkChat(agent, fake);
      const n = agent.services.alerts.raise({ title: "Pill", body: "b", category: "reminder", priority: "high" })!;
      await agent.services.telegram.idle();
      const keyboard = fake.sent().at(-1)!.params.reply_markup.inline_keyboard;
      expect(keyboard[1]).toEqual([{ text: "Mute this alert", callback_data: `n:mute:${n.id}` }]);
      expect(agent.services.notifications.get(n.id)!.escalation).toBe("active");
      await agent.services.telegram.handle(press(`n:mute:${n.id}`));
      expect(agent.services.notifications.get(n.id)).toMatchObject({ escalation: "muted", read_at: null });
      await agent.services.telegram.handle(press(`n:mute:${n.id}`));
      expect(fake.calls.filter((c) => c.method === "answerCallbackQuery").map((c) => c.params.text)).toEqual([
        "Muted. Talorys stops insisting on this alert.",
        "This alert was already handled.",
      ]);
      // A normal alert has no Done, Snooze or Mute; only Change priority.
      agent.services.alerts.raise({ title: "FYI", body: "b", category: "reminder" });
      await agent.services.telegram.idle();
      const data = fake.sent().at(-1)!.params.reply_markup.inline_keyboard.flat().map((b: { callback_data?: string }) => b.callback_data).filter(Boolean);
      expect(data).toHaveLength(1);
      expect(data[0]).toMatch(/^c:/);
    });
  });

  it("stops every insistent alert when the owner writes in the private chat", async () => {
    await inAgent(async (agent) => {
      const fake = fakeTelegram();
      await linkChat(agent, fake);
      const n = agent.services.alerts.raise({ title: "Pill", body: "b", category: "reminder", priority: "high" })!;
      await agent.services.telegram.handle(privateMessage("/help"));
      expect(agent.services.notifications.get(n.id)).toMatchObject({ escalation: "acknowledged", read_at: null });
    });
  });

  it("sends the last try to the private chat instead of the group, marked as a later try", async () => {
    await inAgent(async (agent) => {
      const fake = fakeTelegram({ createForumTopic: () => ({ message_thread_id: 77 }) });
      const t = agent.services.telegram;
      const code = await linkChat(agent, fake);
      await t.handle(groupMessage(`/start ${code}`, OWNER, { is_forum: true }));
      const n = agent.services.alerts.raise({ title: "Pill", body: "b", category: "reminder", priority: "high" })!;
      await t.idle();
      expect(fake.sent().at(-1)!.params).toMatchObject({ chat_id: GROUP, message_thread_id: 77 });
      const s = agent.services;
      const back = (minutes: number) => {
        const row = s.notifications.get(n.id)!;
        const shift = (iso: string) => new Date(Date.parse(iso) - minutes * 60_000).toISOString();
        s.db.run(`UPDATE tal_notifications SET created_at = ?, next_attempt_at = ? WHERE id = ?`, shift(row.created_at), shift(row.next_attempt_at!), n.id);
      };
      back(15);
      s.alerts.escalate(n.id);
      await t.idle();
      expect(fake.sent().at(-1)!.params).toMatchObject({ chat_id: GROUP, message_thread_id: 77, disable_notification: false });
      expect(fake.sent().at(-1)!.params.text).toContain("Try 2 of 3, not confirmed yet");
      back(45);
      s.alerts.escalate(n.id);
      await t.idle();
      const last = fake.sent().at(-1)!.params;
      expect(last.chat_id).toBe(OWNER);
      expect(last).not.toHaveProperty("message_thread_id");
      expect(last.text).toContain("Try 3 of 3, not confirmed yet");
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

describe("conversation in the private chat", () => {
  it("answers through the agent, in an app conversation that the next messages continue", async () => {
    await inAgent(async (agent) => {
      const fake = fakeTelegram();
      const t = agent.services.telegram;
      await linkChat(agent, fake);
      const before = fake.sent().length;
      await t.handle(privateMessage("hello there"));
      const reply = fake.sent().slice(before);
      expect(reply).toHaveLength(1);
      expect(reply[0]!.params).toMatchObject({ chat_id: OWNER, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
      expect(reply[0]!.params.text).toContain("You said: &quot;hello there&quot;".replace(/&quot;/g, '"'));
      expect(fake.calls.some((c) => c.method === "sendChatAction" && c.params.action === "typing")).toBe(true);
      const conversationId = t.status().conversation_id!;
      expect(conversationId).toBeTruthy();
      expect(agent.services.conversations.messages(conversationId).map((m) => [m.role, m.content.slice(0, 11)])).toEqual([
        ["user", "hello there"],
        ["assistant", "(Demo mode)"],
      ]);
      await t.handle(privateMessage("second message"));
      expect(t.status().conversation_id).toBe(conversationId);
      expect(agent.services.conversations.messages(conversationId)).toHaveLength(4);
      // /new starts another conversation.
      await t.handle(privateMessage("/new"));
      expect(t.status().conversation_id).toBeNull();
      await t.handle(privateMessage("third"));
      expect(t.status().conversation_id).not.toBe(conversationId);
      // A conversation deleted in the app is replaced by a new one.
      const third = t.status().conversation_id!;
      agent.services.conversations.delete(third);
      await t.handle(privateMessage("fourth"));
      expect(t.status().conversation_id).not.toBe(third);
      expect(agent.services.conversations.get(t.status().conversation_id!)).not.toBeNull();
    });
  });

  it("uses the agent's tools, like the app's chat", async () => {
    await inAgent(async (agent) => {
      const fake = fakeTelegram();
      await linkChat(agent, fake);
      const before = agent.services.tasks.list({ status: "open", limit: 500 }).length;
      await agent.services.telegram.handle(privateMessage("add task Buy coffee beans"));
      expect(agent.services.tasks.list({ status: "open", limit: 500 }).length).toBe(before + 1);
      expect(fake.sent().at(-1)!.params.text).toMatch(/Buy coffee beans/);
      // Approvals are given in the app: the reply says so and links the conversation.
      await agent.services.telegram.handle(privateMessage("delete task Buy coffee beans"));
      const last = fake.sent().at(-1)!.params;
      expect(last.text).toBe("Something here needs your confirmation. Open Talorys to review it.");
      expect(last.reply_markup.inline_keyboard[0][0]).toEqual({ text: "Open in Talorys", url: `${BASE}/chat/${agent.services.telegram.status().conversation_id}` });
      expect(agent.services.tasks.list({ status: "open", limit: 500 }).length).toBe(before + 1);
    });
  });

  it("says when the conversation is busy, off, or the message is not text", async () => {
    await inAgent(async (agent) => {
      const fake = fakeTelegram();
      const t = agent.services.telegram;
      await linkChat(agent, fake);
      const first = t.handle(privateMessage("a fairly long message so the reply takes a while to stream"));
      await t.handle(privateMessage("again"));
      await first;
      expect(fake.sent().map((c) => c.params.text)).toContain("Talorys is still answering your last message. Wait for it, then write again.");

      await t.handle(update({ message: { message_id: 5, from: { id: OWNER }, chat: { id: OWNER, type: "private" } } }));
      expect(fake.sent().at(-1)!.params.text).toBe("Talorys reads text and voice messages here.");

      t.setConversation(false);
      const before = agent.services.conversations.list().length;
      await t.handle(privateMessage("hello"));
      expect(fake.sent().at(-1)!.params.text).toBe("The conversation through Telegram is off. Turn it on in Settings → Alerts → Telegram.");
      expect(agent.services.conversations.list().length).toBe(before);
    });
  });

  it("keeps the conversation off for a link made before it existed, until the owner turns it on", async () => {
    await inAgent(async (agent) => {
      const t = agent.services.telegram;
      await linkChat(agent);
      const { conversation: _, ...old } = t.link();
      agent.services.settings.setJson("telegram.link", old);
      expect(t.status().conversation).toBe(false);
      t.setConversation(true);
      expect(t.status().conversation).toBe(true);
    });
  });

  it("says when the answer was stopped from the app", async () => {
    await inAgent(async (agent) => {
      const fake = fakeTelegram();
      const t = agent.services.telegram;
      await linkChat(agent, fake);
      const turn = t.handle(privateMessage("a long message that takes a while to answer word by word"));
      await new Promise((r) => setTimeout(r, 60));
      for (const controller of agent.activeRuns.values()) controller.abort();
      await turn;
      expect(fake.sent().at(-1)!.params.text).toBe("⚠️ The answer was stopped.");
      expect(agent.activeRuns.size).toBe(0);
    });
  });

  it("tells the owner when the agent can't answer", async () => {
    await inAgent(async (agent) => {
      const fake = fakeTelegram();
      await linkChat(agent, fake);
      const s = agent.services;
      s.usage.increment({ ai_requests: 100_000 });
      await s.telegram.handle(privateMessage("hello"));
      expect(fake.sent().at(-1)!.params.text).toMatch(/^⚠️ .*daily limit/);
      s.usage.increment({ ai_requests: -100_000 });
    });
  });

  it("falls back to plain text when Telegram can't parse the markup, and splits long replies", async () => {
    await inAgent(async (agent) => {
      let refuse = true;
      const fake = fakeTelegram({
        sendMessage: (p) => (refuse && p.parse_mode === "HTML" ? { ok: false, error_code: 400, description: "Bad Request: can't parse entities" } : { message_id: 1 }),
      });
      await linkChat(agent, fake);
      await agent.services.telegram.handle(privateMessage("hello"));
      const last = fake.sent().at(-1)!.params;
      expect(last.parse_mode).toBeUndefined();
      expect(last.text).toMatch(/You said/);
      refuse = false;
    });
  });

  it("can be turned off and on from the API, asking for the password to turn it on", async () => {
    const c = await loggedIn();
    await inAgent(async (agent) => linkChat(agent));
    expect((await c.json("/api/telegram", { method: "PATCH", body: { conversation: false } })).status).toMatchObject({ conversation: false });
    await inAgent((agent) => agent.services.db.run(`UPDATE tal_sessions SET confirmed_at = '2000-01-01T00:00:00.000Z'`));
    expect((await c.call("/api/telegram", { method: "PATCH", body: { conversation: true } })).status).toBe(403);
    expect((await c.json("/api/telegram", { method: "PATCH", body: { conversation: false } })).status).toMatchObject({ conversation: false });
    expect((await c.call("/api/telegram", { method: "PATCH", body: { conversation: "yes" } })).status).toBe(400);
  });
});

describe("voice messages in the private chat", () => {
  beforeEach(async () => {
    await inAgent((agent) => {
      agent.services.db.run("DELETE FROM tal_usage_daily");
      agent.services.db.run("DELETE FROM tal_model_usage_daily");
    });
  });

  it("transcribes the voice message, shows the text and answers it like a written message", async () => {
    await inAgent(async (agent) => {
      const fake = voiceTelegram();
      const t = agent.services.telegram;
      await linkChat(agent, fake);
      const before = fake.sent().length;
      await t.handle(voiceMessage({ duration: 6 }));
      expect(fake.calls.find((c) => c.method === "getFile")!.params).toEqual({ file_id: "voice-1" });
      expect(fake.calls.find((c) => c.method === "download")!.params).toEqual({ path: "voice/file_1.oga" });
      const replies = fake.sent().slice(before).map((c) => c.params.text as string);
      expect(replies[0]).toBe("🎙️ Demo transcription of 4 s of audio.");
      expect(replies[1]).toContain('You said: "Demo transcription of 4 s of audio."');
      const conversationId = t.status().conversation_id!;
      expect(agent.services.conversations.messages(conversationId)[0]).toMatchObject({ role: "user", content: "Demo transcription of 4 s of audio." });
      // Charged by the longer of Telegram's length and the model's, against the app's voice cap.
      expect(agent.services.usage.transcriptionSecondsToday()).toBe(6);
      expect(agent.transcribing).toBe(false);
      // Audio files are handled the same way.
      await t.handle(voiceMessage({ duration: 3 }, "audio"));
      expect(fake.sent().map((c) => c.params.text)).toContain("🎙️ Demo transcription of 4 s of audio.");
      expect(agent.services.usage.transcriptionSecondsToday()).toBe(10);
    });
  });

  it("refuses messages over 5 minutes or a few megabytes before downloading them", async () => {
    await inAgent(async (agent) => {
      const fake = voiceTelegram();
      const t = agent.services.telegram;
      await linkChat(agent, fake);
      const tooLong = "⚠️ This voice message is too long. Send up to 5 minutes, or write it.";
      await t.handle(voiceMessage({ duration: 301 }));
      expect(fake.sent().at(-1)!.params.text).toBe(tooLong);
      await t.handle(voiceMessage({ file_size: 6 * 1024 * 1024 }));
      expect(fake.sent().at(-1)!.params.text).toBe(tooLong);
      expect(fake.calls.some((c) => c.method === "getFile" || c.method === "download")).toBe(false);
      expect(agent.services.usage.transcriptionSecondsToday()).toBe(0);
    });
  });

  it("stops a download that is larger than Telegram said", async () => {
    await inAgent(async (agent) => {
      const big = 5 * 1024 * 1024 + 1;
      const fake = fakeTelegram(
        { getFile: () => ({ file_id: "voice-1", file_size: 1000, file_path: "voice/file_1.oga" }) },
        { "voice/file_1.oga": () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(big)); c.close(); } })) },
      );
      await linkChat(agent, fake);
      await agent.services.telegram.handle(voiceMessage({}));
      expect(fake.sent().at(-1)!.params.text).toBe("⚠️ This voice message is too long. Send up to 5 minutes, or write it.");
      // getFile reporting a large file is refused too.
      const fake2 = voiceTelegram(5 * 1024 * 1024 + 1);
      useFake(agent, fake2);
      await agent.services.telegram.handle(voiceMessage({ file_size: undefined }));
      expect(fake2.calls.some((c) => c.method === "download")).toBe(false);
      expect(fake2.sent().at(-1)!.params.text).toBe("⚠️ This voice message is too long. Send up to 5 minutes, or write it.");
      expect(agent.services.usage.transcriptionSecondsToday()).toBe(0);
    });
  });

  it("keeps to the daily voice limit shared with the app", async () => {
    await inAgent(async (agent) => {
      const fake = voiceTelegram();
      await linkChat(agent, fake);
      agent.services.usage.increment({ transcription_seconds: TRANSCRIPTION_LIMITS.maxSecondsPerDay - 30 });
      await agent.services.telegram.handle(voiceMessage({ duration: 60 }));
      expect(fake.sent().at(-1)!.params.text).toBe("⚠️ Talorys reached its daily limit of 60 minutes of voice input.");
      expect(agent.services.telegram.status().conversation_id).toBeNull();
      // A shorter message still fits.
      await agent.services.telegram.handle(voiceMessage({ duration: 20 }));
      expect(fake.sent().map((c) => c.params.text)).toContain("🎙️ Demo transcription of 4 s of audio.");
    });
  });

  it("explains a failed download, an empty transcript, a busy transcriber and a conversation turned off", async () => {
    await inAgent(async (agent) => {
      const fake = fakeTelegram({ getFile: () => ({ file_id: "voice-1", file_path: "voice/missing.oga" }) });
      const t = agent.services.telegram;
      await linkChat(agent, fake);
      await t.handle(voiceMessage({}));
      expect(fake.sent().at(-1)!.params.text).toBe("⚠️ Talorys couldn't transcribe this voice message. Try again, or write it.");

      const voice = voiceTelegram();
      useFake(agent, voice);
      const spy = vi.spyOn(agent, "transcribeClip").mockResolvedValueOnce({ text: "   ", seconds: 2 });
      await t.handle(voiceMessage({}));
      expect(voice.sent().at(-1)!.params.text).toBe("Talorys couldn't make out any words in this voice message. Try again, or write it.");
      spy.mockRestore();

      agent.transcribing = true;
      try {
        await t.handle(voiceMessage({}));
        expect(voice.sent().at(-1)!.params.text).toBe("⚠️ A recording is already being transcribed.");
      } finally {
        agent.transcribing = false;
      }

      t.setConversation(false);
      const calls = voice.calls.length;
      await t.handle(voiceMessage({}));
      expect(voice.sent().at(-1)!.params.text).toBe("The conversation through Telegram is off. Turn it on in Settings → Alerts → Telegram.");
      expect(voice.calls.slice(calls).some((c) => c.method === "getFile")).toBe(false);
    });
  });

  it("answers one message at a time while a voice message is transcribed", async () => {
    await inAgent(async (agent) => {
      const fake = voiceTelegram();
      const t = agent.services.telegram;
      await linkChat(agent, fake);
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => (release = resolve));
      const real = agent.transcribeClip.bind(agent);
      vi.spyOn(agent, "transcribeClip").mockImplementationOnce(async (audio, opts) => {
        await held;
        return real(audio, opts);
      });
      const first = t.handle(voiceMessage({}));
      await vi.waitFor(() => expect(fake.calls.some((c) => c.method === "download")).toBe(true));
      await t.handle(privateMessage("meanwhile"));
      expect(fake.sent().at(-1)!.params.text).toBe("Talorys is still answering your last message. Wait for it, then write again.");
      release();
      await first;
      expect(fake.sent().map((c) => c.params.text)).toContain("🎙️ Demo transcription of 4 s of audio.");
    });
  });

  it("estimates the length from the size when Telegram gives none, and checks the cap with it", async () => {
    await inAgent(async (agent) => {
      // 400 KB at 32 kbit/s is 100 s; the mock model reports at most 60 s.
      const fake = voiceTelegram(400_000);
      await linkChat(agent, fake);
      await agent.services.telegram.handle(voiceMessage({ duration: 0 }, "audio"));
      expect(fake.sent().map((c) => c.params.text)).toContain("🎙️ Demo transcription of 60 s of audio.");
      expect(agent.services.usage.transcriptionSecondsToday()).toBe(100);
      agent.services.usage.increment({ transcription_seconds: TRANSCRIPTION_LIMITS.maxSecondsPerDay - 100 - 50 });
      await agent.services.telegram.handle(voiceMessage({ duration: undefined }, "audio"));
      expect(fake.sent().at(-1)!.params.text).toBe("⚠️ Talorys reached its daily limit of 60 minutes of voice input.");
      expect(agent.services.usage.transcriptionSecondsToday()).toBe(TRANSCRIPTION_LIMITS.maxSecondsPerDay - 50);
    });
  });

  it("keeps the chat busy from the transcript until its answer starts", async () => {
    await inAgent(async (agent) => {
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => (release = resolve));
      let echoing = false;
      const fake = voiceTelegram(16_000, {
        sendMessage: async (params) => {
          if (String(params.text).startsWith("🎙️")) {
            echoing = true;
            await held;
          }
          return { message_id: 1 };
        },
      });
      const t = agent.services.telegram;
      await linkChat(agent, fake);
      const first = t.handle(voiceMessage({}));
      await vi.waitFor(() => expect(echoing).toBe(true));
      await t.handle(privateMessage("in between"));
      expect(fake.sent().at(-1)!.params.text).toBe("Talorys is still answering your last message. Wait for it, then write again.");
      release();
      await first;
      const conversationId = t.status().conversation_id!;
      expect(agent.services.conversations.messages(conversationId).map((m) => m.content)[0]).toBe("Demo transcription of 4 s of audio.");
      // The chat is free again afterwards.
      await t.handle(privateMessage("after"));
      expect(fake.sent().at(-1)!.params.text).toContain('You said: "after"');
    });
  });

  it("shows the Workers AI quota message as is", async () => {
    await inAgent(async (agent) => {
      const fake = voiceTelegram();
      await linkChat(agent, fake);
      const { AppError } = await import("../src/api/errors");
      vi.spyOn(agent, "transcribeClip").mockRejectedValueOnce(new AppError("AI_QUOTA_EXHAUSTED", "Your Cloudflare account has used its Workers AI allocation for today. Tasks, notes, memories and reminders keep working; chat will resume when the quota resets."));
      await agent.services.telegram.handle(voiceMessage({}));
      expect(fake.sent().at(-1)!.params.text).toBe("⚠️ Your Cloudflare account has used its Workers AI allocation for today. Tasks, notes, memories and reminders keep working; chat will resume when the quota resets.");
    });
  });

  it("ignores voice messages from anyone but the owner", async () => {
    await inAgent(async (agent) => {
      const fake = voiceTelegram();
      await linkChat(agent, fake);
      const calls = fake.calls.length;
      await agent.services.telegram.handle(voiceMessage({}, "voice", STRANGER));
      expect(fake.calls.slice(calls).some((c) => c.method === "getFile")).toBe(false);
    });
  });
});

describe("Telegram file download", () => {
  it("accepts only Telegram's file paths, never follows redirects and stops past the limit", async () => {
    const c = new TelegramClient("123456:test-telegram-token");
    const seen: { url: string; init?: RequestInit }[] = [];
    c.fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), init });
      return new Response(new Uint8Array([1, 2, 3]));
    }) as typeof fetch;
    expect(Array.from(await c.download("voice/file_1.oga", 3))).toEqual([1, 2, 3]);
    expect(seen[0]!.url).toBe("https://api.telegram.org/file/bot123456:test-telegram-token/voice/file_1.oga");
    expect(seen[0]!.init?.redirect).toBe("manual");
    for (const path of ["../bot1/getMe", "voice/../x", "/etc/passwd", "voice/a?b", "https://x.example/a", "voice//a", ""]) {
      expect(((await c.download(path, 10).catch((e) => e)) as TelegramError).code).toBe(400);
    }
    expect(seen).toHaveLength(1);
    expect(((await c.download("voice/file_1.oga", 2).catch((e) => e)) as TelegramError).code).toBe(413);
    c.fetcher = (async () => new Response(null, { status: 302, headers: { location: "https://x.example/" } })) as typeof fetch;
    expect(((await c.download("voice/file_1.oga", 10).catch((e) => e)) as TelegramError).code).toBe(302);
    c.fetcher = (async () => new Response("x", { headers: { "content-length": "99" } })) as typeof fetch;
    expect(((await c.download("voice/file_1.oga", 10).catch((e) => e)) as TelegramError).code).toBe(413);
  });

  it("encodes large files to base64 without overflowing", () => {
    const bytes = new Uint8Array(300_000).map((_, i) => i % 256);
    const encoded = bytesToBase64(bytes);
    expect(Uint8Array.from(atob(encoded), (ch) => ch.charCodeAt(0))).toEqual(bytes);
  });
});

describe("Telegram formatting", () => {
  it("escapes everything and keeps only simple formatting", async () => {
    const { markdownToTelegramHtml, splitMessage } = await import("../src/telegram/format");
    expect(markdownToTelegramHtml("**Bold** and *it* and `a<b>` and <script>x</script>")).toBe(
      "<b>Bold</b> and <i>it</i> and <code>a&lt;b&gt;</code> and &lt;script&gt;x&lt;/script&gt;",
    );
    expect(markdownToTelegramHtml("## Title\n- one\n- two")).toBe("<b>Title</b>\n• one\n• two");
    expect(markdownToTelegramHtml("```js\nconst a = **1**;\n```")).toBe("<pre>const a = **1**;</pre>");
    expect(markdownToTelegramHtml("[click](https://evil.example)")).toBe("[click](https://evil.example)");
    // Text that looks like the internal placeholders stays as it is.
    expect(markdownToTelegramHtml("\uE0000\uE000 and `x`")).toBe("\uE0000\uE000 and <code>x</code>");
    expect(splitMessage(`${"a".repeat(9)}😀b`, 10)).toEqual(["a".repeat(9), "😀b"]);
    const long = `${"word ".repeat(1000)}\n\n${"more ".repeat(500)}`;
    const parts = splitMessage(long, 3800);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 3800)).toBe(true);
    expect(parts.join(" ").replace(/\s+/g, " ").trim()).toBe(long.replace(/\s+/g, " ").trim());
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
    expect(await c.json("/api/telegram")).toEqual({ status: { configured: true, bot: null, chat: false, group: null, topics: false, linked_at: null, conversation: false, conversation_id: null } });
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
