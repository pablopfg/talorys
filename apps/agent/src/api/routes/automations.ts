import {
  automationCreateSchema,
  alertPreferencesSchema,
  alertProfileUpdateSchema,
  automationUpdateSchema,
  notificationActionSchema,
  notificationPriorityUpdateSchema,
} from "@talorys/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Context } from "hono";
import type { AppEnv } from "../app";
import { AppError, NotFoundError } from "../errors";
import { body, query, requireRecentAuth } from "../middleware";

export const automationRoutes = new Hono<AppEnv>();

/** Access tokens may not add or change scheduled AI prompts; reminders and digests stay writable. */
function denyRemoteAgentPrompt(c: Context<AppEnv>, kind: string): void {
  if (c.get("remote") && kind === "agent_prompt") {
    throw new AppError("FORBIDDEN", "Access tokens cannot create or change AI prompt automations.");
  }
}

/** Calendar conditions are set in the app: an access token learns nothing about the owner's calendars. */
function denyRemoteGate(c: Context<AppEnv>, gate: string | null | undefined): void {
  if (c.get("remote") && gate) throw new AppError("FORBIDDEN", "Access tokens cannot set a calendar condition.");
}

automationRoutes.get("/automations", (c) => {
  const s = c.env.agent.services;
  return c.json({
    automations: s.automations.list(),
    runs: s.automationsRepo.runs({ limit: 50 }),
    failed_runs: s.automationsRepo.runs({ limit: 20, status: "error" }),
    timezone: s.settings.get().timezone,
  });
});

automationRoutes.get("/automations/:id", (c) =>
  c.json({ automation: c.env.agent.services.automationsRepo.require(c.req.param("id")) }),
);

automationRoutes.get("/automations/:id/runs", (c) => {
  const s = c.env.agent.services;
  const id = c.req.param("id");
  s.automationsRepo.require(id);
  const q = query(c, z.object({
    status: z.enum(["success", "error", "skipped", "running"]).optional(),
    before: z.string().max(40).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }));
  const limit = q.limit ?? 25;
  const runs = s.automationsRepo.runs({ automationId: id, status: q.status, before: q.before, limit: limit + 1 });
  return c.json({ runs: runs.slice(0, limit), has_more: runs.length > limit });
});

automationRoutes.post("/automations/:id/run", async (c) => {
  const id = c.req.param("id");
  denyRemoteAgentPrompt(c, c.env.agent.services.automationsRepo.require(id).kind);
  return c.json({ run: await c.env.agent.runAutomationNow(id) });
});

automationRoutes.post("/automations", async (c) => {
  const input = await body(c, automationCreateSchema);
  denyRemoteAgentPrompt(c, input.kind);
  denyRemoteGate(c, input.calendar_gate);
  return c.json({ automation: await c.env.agent.services.automations.create(input) }, 201);
});

automationRoutes.patch("/automations/:id", async (c) => {
  const id = c.req.param("id");
  const patch = await body(c, automationUpdateSchema);
  if (c.get("remote")) denyRemoteAgentPrompt(c, c.env.agent.services.automationsRepo.require(id).kind);
  denyRemoteGate(c, patch.calendar_gate);
  return c.json({ automation: await c.env.agent.services.automations.update(id, patch) });
});

automationRoutes.delete("/automations/:id", async (c) => {
  await c.env.agent.services.automations.delete(c.req.param("id"));
  return c.json({ deleted: true });
});

// ---------- Notification center ----------

automationRoutes.get("/notifications", (c) => {
  const { unread } = query(c, z.object({ unread: z.enum(["1", "0"]).optional() }));
  const s = c.env.agent.services;
  return c.json({ notifications: s.notifications.list({ unreadOnly: unread === "1" }), unread: s.notifications.unreadCount() });
});

automationRoutes.post("/notifications/read", async (c) => {
  const { id } = await body(c, z.object({ id: z.string().max(64).optional() }));
  c.env.agent.services.alerts.markRead(id);
  c.env.agent.refreshUnread();
  return c.json({ unread: c.env.agent.services.notifications.unreadCount() });
});

/** A security alert is the record of what happened: deleting one needs the password typed recently. */
automationRoutes.delete("/notifications/:id", (c) => {
  const s = c.env.agent.services;
  if (s.notifications.get(c.req.param("id"))?.category === "security") requireRecentAuth(c);
  s.alerts.delete(c.req.param("id"));
  c.env.agent.refreshUnread();
  return c.json({ deleted: true });
});

/**
 * The owner answers an alert: Done, Snooze 1 h or Mute (stop insisting). The same answers as the
 * Telegram buttons; the push notification's buttons call this from the service worker.
 */
automationRoutes.post("/notifications/:id/action", async (c) => {
  const { action } = await body(c, notificationActionSchema, 1024);
  const s = c.env.agent.services;
  const result = await s.alerts.respond(c.req.param("id"), action);
  c.env.agent.refreshUnread();
  return c.json({ result, notification: s.notifications.get(c.req.param("id")), unread: s.notifications.unreadCount() });
});

/** The owner corrects how loud a notification is. */
automationRoutes.patch("/notifications/:id", async (c) => {
  const { priority } = await body(c, notificationPriorityUpdateSchema);
  const notification = c.env.agent.services.alerts.setPriority(c.req.param("id"), priority);
  if (!notification) throw new NotFoundError("Notification not found");
  return c.json({ notification });
});

// ---------- Alert center ----------

automationRoutes.get("/alerts", (c) => c.json(c.env.agent.services.alerts.overview()));

automationRoutes.put("/alerts/preferences", async (c) => {
  const s = c.env.agent.services;
  const preferences = s.alerts.updatePreferences(await body(c, alertPreferencesSchema, 8 * 1024));
  s.activity.record("alerts.preferences", "Changed alert preferences");
  return c.json({ preferences });
});

/** Sends a test e-mail to the owner's address: at most EMAIL_ALERTS.testsPerDay, counted in the daily cap. */
automationRoutes.post("/alerts/email/test", async (c) => {
  const s = c.env.agent.services;
  // A stolen session must not be able to spend the e-mail limit before doing something worse.
  requireRecentAuth(c);
  if (!s.email.configured()) throw new AppError("NOT_CONFIGURED", "E-mail alerts are not set up on this deployment.");
  if (!s.email.canTest()) throw new AppError("RATE_LIMITED", "The daily e-mail limit was reached. Try again tomorrow.");
  const sent = await s.email.test();
  return c.json({ sent, overview: s.alerts.overview() });
});

/** What the priority learned from the owner's use, per kind of alert. */
automationRoutes.get("/alerts/profiles", (c) => c.json({ profiles: c.env.agent.services.alerts.profiles() }));

/** Fixes a kind of alert at a priority, or lets it learn again. */
automationRoutes.put("/alerts/profiles/:id", async (c) => {
  const { pinned } = await body(c, alertProfileUpdateSchema, 1024);
  return c.json({ profile: c.env.agent.services.alerts.pinProfile(c.req.param("id"), pinned) });
});

/** Forgets what Axis learned about a kind of alert. */
automationRoutes.delete("/alerts/profiles/:id", (c) => c.json({ profile: c.env.agent.services.alerts.resetProfile(c.req.param("id")) }));
