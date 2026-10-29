import { scheduleSpecSchema } from "@talorys/shared";
import { z } from "zod";
import { defineTool, quoteTitle, ToolError } from "./registry";
import { clip, defangLinks } from "../services/text";
import { formatLocal, toLocalMinute } from "../services/time";

/** Shortest repeat interval the agent may schedule on its own; the owner can still pick less in the app. */
export const MIN_AGENT_INTERVAL_MINUTES = 60;

type ScheduleSpec = z.infer<typeof scheduleSpecSchema>;

function checkAgentSchedule(schedule: ScheduleSpec): void {
  if (schedule.type === "interval" && schedule.minutes < MIN_AGENT_INTERVAL_MINUTES) {
    throw new ToolError(`Repeat at most once every ${MIN_AGENT_INTERVAL_MINUTES} minutes. The owner can choose shorter intervals in the app.`);
  }
}

const routineInput = z.object({
  name: z.string().min(1).max(200),
  prompt: z.string().min(1).max(2000).describe("What the routine asks the AI to do on each run"),
  schedule: scheduleSpecSchema,
});

/**
 * Only when the owner asks for it: a high reminder is sent again until confirmed (ESCALATION). The
 * agent may make one-time reminders insistent only; recurring ones are set in the app.
 */
const insistent = z
  .boolean()
  .optional()
  .describe("true only when the owner asks to be reminded until they confirm: it is sent again after 15 min and 1 h until they tap Done");

/**
 * How loud the reminder is. The agent picks it in the same turn, guided by the owner's past
 * corrections in the system prompt; no extra AI call. High also insists, as `insistent` does.
 */
const reminderPriority = z
  .enum(["low", "normal", "high"])
  .optional()
  .describe("low: only in the app, no phone notification; normal (default): a notification; high: rings and insists until confirmed. Follow the owner's past priority corrections for similar reminders; use high only when the owner asks to be reminded until they confirm or their corrections show it");

/** Target id of a proposed AI routine, which doesn't exist until the owner approves it. */
const NEW_ROUTINE_TARGET = "new-ai-routine";

export const reminderTools = [
  defineTool({
    name: "create_reminder",
    description:
      "Create a one-time reminder shown in the owner's notification center. Give either 'at' (local time 'YYYY-MM-DDTHH:MM' in the owner's timezone) or 'in_minutes'.",
    permission: "write",
    maxCallsPerTurn: 3,
    input: z.object({
      message: z.string().min(1).max(500),
      at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
      in_minutes: z.number().int().min(1).max(60 * 24 * 365).optional(),
      insistent,
      priority: reminderPriority,
    }),
    label: (i) => `Setting reminder “${i.message}”`,
    execute: async (i, ctx) => {
      let at = i.at;
      if (!at && i.in_minutes) at = toLocalMinute(new Date(Date.now() + i.in_minutes * 60_000 + 59_000), ctx.timezone);
      if (!at) throw new ToolError("Provide 'at' or 'in_minutes'.");
      const a = await ctx.services.automations.create({
        name: clip(defangLinks(i.message), 120),
        kind: "reminder",
        // Model-written: links stay visible but can't be clicked once the reminder fires.
        message: defangLinks(i.message),
        schedule: { type: "once", at },
        enabled: true,
        priority: i.insistent ? "high" : (i.priority ?? "normal"),
      });
      return {
        reminder: { id: a.id, message: a.message, when: formatLocal(a.next_run, ctx.timezone), priority: a.priority, insistent: a.priority === "high" },
      };
    },
  }),
  defineTool({
    name: "create_automation",
    description: [
      "Create a recurring schedule. kind: 'reminder' (show message, no AI) or 'task_digest' (deterministic summary of due/overdue tasks, no AI).",
      "For a routine that runs an AI prompt, use propose_ai_routine instead.",
      "schedule examples: {type:'daily',time:'09:00'}, {type:'weekly',days:[5],time:'17:00'} (0=Sunday),",
      "{type:'monthly',day:1,time:'08:00'}, {type:'interval',minutes:120}, {type:'once',at:'2026-01-31T09:00'}. Times are local.",
    ].join(" "),
    permission: "write",
    maxCallsPerTurn: 2,
    input: z.object({
      name: z.string().min(1).max(200),
      // AI routines run on their own every time they fire, so they go through propose_ai_routine and the owner's approval.
      kind: z.enum(["reminder", "task_digest"]),
      message: z.string().max(2000).optional().describe("Reminder text"),
      schedule: scheduleSpecSchema,
    }),
    label: (i) => `Scheduling “${i.name}”`,
    execute: async (i, ctx) => {
      checkAgentSchedule(i.schedule);
      const a = await ctx.services.automations.create({
        name: defangLinks(i.name),
        kind: i.kind,
        message: defangLinks(i.message ?? ""),
        schedule: i.schedule,
        enabled: true,
      });
      return { automation: { id: a.id, name: a.name, schedule: a.schedule_description, next_run: formatLocal(a.next_run, ctx.timezone) } };
    },
  }),
  defineTool({
    name: "propose_ai_routine",
    description: [
      "Propose a recurring AI routine: on each run, the AI answers 'prompt' with read-only tools and the reply goes to the owner's notifications.",
      "Use only when the owner asked for one in this chat and AI reasoning is truly needed; plain reminders and task digests use create_automation.",
      "The owner must approve the exact prompt and schedule in the app before anything is scheduled. Schedule examples as in create_automation.",
    ].join(" "),
    permission: "destructive",
    maxCallsPerTurn: 1,
    input: routineInput,
    label: (i) => `Proposing AI routine “${i.name}”`,
    prepare: async (i) => {
      checkAgentSchedule(i.schedule);
      return {
        targetId: NEW_ROUTINE_TARGET,
        summary: `Schedule AI routine ${quoteTitle(i.name)}`,
        payload: i,
        // The whole prompt and schedule are on the card: this is exactly what will run unattended.
        preview: `Schedule: ${JSON.stringify(i.schedule)}\n\n${i.prompt}`,
      };
    },
    // Nothing exists yet; the proposal itself (payload, preview) is what the owner approves.
    snapshot: (id) => (id === NEW_ROUTINE_TARGET ? [NEW_ROUTINE_TARGET] : null),
    commit: async (_id, ctx, payload) => {
      const i = routineInput.parse(payload);
      checkAgentSchedule(i.schedule);
      const a = await ctx.services.automations.create({ name: i.name, kind: "agent_prompt", message: i.prompt, schedule: i.schedule, enabled: true });
      ctx.services.activity.record("automation.approved", `Scheduled AI routine “${a.name}” (approved agent action)`);
    },
  }),
  defineTool({
    name: "list_automations",
    description: "List reminders and scheduled automations.",
    permission: "read",
    maxCallsPerTurn: 2,
    input: z.object({}),
    label: () => `Checking schedules`,
    execute: (_i, ctx) => ({
      automations: ctx.services.automations.list().map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        schedule: a.schedule_description,
        enabled: a.enabled,
        insistent: a.priority === "high",
        next_run: formatLocal(a.next_run, ctx.timezone),
      })),
    }),
  }),
  defineTool({
    name: "cancel_automation",
    description: "Propose deleting a reminder or automation by id. The owner must approve it in the app before anything is deleted.",
    permission: "destructive",
    maxCallsPerTurn: 3,
    input: z.object({ id: z.string().min(1) }),
    label: () => `Proposing to cancel a schedule`,
    prepare: (i, ctx) => {
      const a = ctx.services.automations.get(i.id);
      if (!a) throw new ToolError("Automation not found.");
      return { targetId: a.id, summary: `Cancel ${a.kind === "reminder" ? "reminder" : "automation"} ${quoteTitle(a.name)}` };
    },
    // Run bookkeeping (last_run, next_run, run_count) changes on every run and is left out.
    snapshot: (id, ctx) => {
      const a = ctx.services.automations.get(id);
      return a && [a.name, a.kind, a.message, a.schedule, a.enabled];
    },
    commit: async (id, ctx) => {
      const a = ctx.services.automations.get(id);
      if (!a) throw new ToolError("This automation no longer exists.");
      await ctx.services.automations.delete(a.id);
    },
  }),
  defineTool({
    name: "notify_owner",
    description: "Post a message to the owner's notification center. Only in scheduled runs, to deliver results.",
    permission: "write",
    maxCallsPerTurn: 1,
    input: z.object({ title: z.string().min(1).max(200), body: z.string().min(1).max(4000) }),
    label: () => `Sending a notification`,
    execute: (i, ctx) => {
      // The model writes this, so it can't pose as another sender or carry clickable links.
      const title = clip(`${ctx.routineName ?? "Routine"} · ${i.title.replace(/\s+/g, " ").trim()}`, 200);
      const n = ctx.services.alerts.raise({ title, body: defangLinks(i.body), category: "routine" });
      return { notified: n?.id ?? null };
    },
  }),
];
