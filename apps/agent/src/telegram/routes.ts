import { telegramUpdateSchema } from "@talorys/shared";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../api/app";
import { AppError } from "../api/errors";
import { body, requireRecentAuth } from "../api/middleware";
import { isTelegramWebhook } from "./client";
import type { TgUpdate } from "./service";

/** Telegram's updates are small; anything bigger is not one of them. */
const MAX_UPDATE_BYTES = 64 * 1024;
const updateSchema = z.object({ update_id: z.number().int().nonnegative() }).passthrough();

/**
 * POST /api/telegram/webhook: Telegram delivers the bot's updates here. It has no session, so it
 * runs before the session, CSRF and access-token checks; the secret header Telegram echoes back
 * is its only key. It answers at once and handles the update in the background, and answers 200
 * even to an update it cannot read, so Telegram does not resend it forever.
 */
export async function telegramWebhook(c: Context<AppEnv>): Promise<Response> {
  if (!(await isTelegramWebhook(c.req.header("x-telegram-bot-api-secret-token"), c.env.env.SESSION_SECRET))) {
    throw new AppError("FORBIDDEN", "Unknown webhook.");
  }
  const telegram = c.env.agent.services.telegram;
  if (!telegram.configured()) return c.json({ ok: true });
  let update: TgUpdate;
  try {
    update = (await body(c, updateSchema, MAX_UPDATE_BYTES)) as TgUpdate;
  } catch {
    return c.json({ ok: true });
  }
  telegram.receive(update);
  return c.json({ ok: true });
}

/** Owner-only routes behind Settings → Alerts. Access tokens never reach them (allowlist). */
export const telegramRoutes = new Hono<AppEnv>();

telegramRoutes.get("/telegram", (c) => c.json({ status: c.env.agent.services.telegram.status() }));

/** Points the bot at this deployment and returns a fresh link code. */
telegramRoutes.post("/telegram/connect", async (c) => {
  requireRecentAuth(c);
  return c.json(await c.env.agent.services.telegram.connect(new URL(c.req.url).origin));
});

/** Turns the conversation in the private chat on (asks for the password again) or off. */
telegramRoutes.patch("/telegram", async (c) => {
  const { conversation } = await body(c, telegramUpdateSchema, 1024);
  if (conversation) requireRecentAuth(c);
  return c.json({ status: c.env.agent.services.telegram.setConversation(conversation) });
});

telegramRoutes.post("/telegram/test", async (c) => {
  const s = c.env.agent.services.telegram;
  return c.json({ sent: await s.test(), status: s.status() });
});

telegramRoutes.delete("/telegram", async (c) => {
  requireRecentAuth(c);
  return c.json({ status: await c.env.agent.services.telegram.disconnect() });
});
