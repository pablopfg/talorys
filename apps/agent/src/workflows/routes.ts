import { workflowKeySchema, workflowUpdateSchema } from "@talorys/shared";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../api/app";
import { AppError, NotFoundError } from "../api/errors";
import { body, requireRecentAuth } from "../api/middleware";

/** Owner sessions only: access tokens (n8n, scripts) never see or change workflows. */
const ownerOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("remote") || !c.get("sessionId")) throw new AppError("FORBIDDEN", "Workflows can only be managed from the Axis app.");
  return next();
};

function keyOf(c: Context<AppEnv>) {
  const parsed = workflowKeySchema.safeParse(c.req.param("key"));
  if (!parsed.success) throw new NotFoundError("Workflow not found");
  return parsed.data;
}

/** The Workflows menu: routines run by Cloudflare Workflows, each with an on/off switch. */
export const workflowRoutes = new Hono<AppEnv>();

workflowRoutes.use("/workflows", ownerOnly);
workflowRoutes.use("/workflows/*", ownerOnly);

workflowRoutes.get("/workflows", (c) => {
  const s = c.env.agent.services;
  return c.json({
    available: s.workflows.available(),
    workflows: s.workflows.list(),
    runs: s.workflows.runs(undefined, 30),
    timezone: s.settings.get().timezone,
  });
});

workflowRoutes.get("/workflows/:key/runs", (c) => c.json({ runs: c.env.agent.services.workflows.runs(keyOf(c), 50) }));

/** Turning a workflow on or giving it new addresses needs the password typed recently; turning it off never does. */
workflowRoutes.patch("/workflows/:key", async (c) => {
  const key = keyOf(c);
  const patch = await body(c, workflowUpdateSchema, 8 * 1024);
  if (patch.enabled === true || patch.config !== undefined) requireRecentAuth(c);
  return c.json({ workflow: await c.env.agent.services.workflows.update(key, patch) });
});

workflowRoutes.post("/workflows/:key/run", async (c) => {
  const key = keyOf(c);
  const s = c.env.agent.services;
  const run = await s.workflows.runNow(key);
  return c.json({ run, workflow: s.workflows.get(key) });
});
