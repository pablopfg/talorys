import { Agent } from "agents";
import { type Automation, isSentinelNothing, TRANSCRIPTION_LIMITS, WATCH } from "@talorys/shared";
import type { Env } from "../env";
import { migrate } from "../db/migrations";
import { createServices, type Services } from "../services/container";
import type { Scheduler } from "./scheduling";
import { AgentRunner } from "./runner";
import { createApi } from "../api/app";
import { CloudflareWorkersAIProvider } from "../ai/workers-ai";
import { MockAIProvider } from "../ai/mock";
import type { AIProvider } from "../ai/provider";
import { localDayBounds, formatLocal } from "../services/time";
import { defangLinks } from "../services/text";
import { semanticExtensions } from "../semantic";
import { AppError } from "../api/errors";
import { semanticNeighbors } from "../semantic/neighbors";
import { CLEF_MODEL, type ClefRun } from "../memory/conflict";
import { createTranscriber, type Transcription } from "../ai/transcription";
import { classifyAiError } from "../ai/provider";
import { runWatchers } from "../alerts/watchers";
import { gateAutomation, type NoticePayload, noticeDue, planNotices } from "../calendar/routines";

interface AgentState {
  /** Unread notifications, kept in agent state for cheap polling. */
  unread: number;
}

interface AutomationPayload {
  automationId: string;
}

interface AlertPayload {
  notificationId: string;
  /** The try the alarm is for; the alert's own state decides what happens. */
  step?: number;
}

const api = createApi();

/**
 * The owner's personal agent. Exactly one instance exists per deployment
 * ("personal-agent"); it owns all data in its SQLite-backed Durable Object.
 */
export class TalorysAgent extends Agent<Env, AgentState> {
  override initialState: AgentState = { unread: 0 };

  private _services: Services | null = null;
  /** In-flight chat turns by conversation, for cancellation. */
  readonly activeRuns = new Map<string, AbortController>();
  /** True while a voice clip is being transcribed: one at a time keeps the daily audio cap exact. */
  transcribing = false;

  get services(): Services {
    if (!this._services) {
      const scheduler: Scheduler = {
        schedule: async (at, automationId) => {
          const s = await this.schedule<AutomationPayload>(at, "runAutomation", { automationId });
          return s.id;
        },
        cancel: async (id) => {
          await this.cancelSchedule(id);
        },
        exists: async (id) => (await this.getScheduleById(id)) !== undefined,
        // One alarm per alert and step: a reconcile after a restart never adds a second one.
        scheduleAlert: async (at, notificationId, step) => {
          await this.schedule<AlertPayload>(at, "escalateAlert", { notificationId, step }, { idempotent: true });
        },
      };
      this._services = createServices(
        this.ctx.storage,
        this.env,
        scheduler,
        {
          clef: () => this.clefRun(),
          neighbors: (memory, opts) => semanticNeighbors(this.services, this.env, memory, opts),
          ...(this.env.TALORYS_ENV === "development" ? { onAiCheck: (check) => console.info("memory.ai_check", JSON.stringify(check)) } : {}),
        },
        (work) => this.ctx.waitUntil(work),
      );
      migrate(this._services.db);
      const services = this._services;
      // The private Telegram chat talks to the same agent as the app's chat.
      services.telegram.attachChat({
        turn: (input) => this.runner().chat(input),
        active: this.activeRuns,
        exists: (id) => services.conversations.get(id) !== null,
        keepAliveWhile: (work) => this.keepAliveWhile(work),
        transcribe: (audio, opts) => this.transcribeClip(audio, opts),
      });
    }
    return this._services;
  }

  override async onStart(): Promise<void> {
    const services = this.services;
    try {
      const { repaired } = await services.automations.reconcile();
      if (repaired > 0) services.activity.record("automation.reconciled", `Recovered ${repaired} schedule(s) after restart`);
    } catch (error) {
      console.error("Schedule reconciliation failed", error);
    }
    try {
      services.alerts.reconcile();
    } catch (error) {
      console.error("Alert retry reconciliation failed", error);
    }
    try {
      // Every 15 minutes (UTC clock), the watchers and the daily summary. A cron schedule is
      // idempotent: waking up again never adds a second one.
      await this.schedule(`*/${WATCH.everyMinutes} * * * *`, "watch");
    } catch (error) {
      console.error("Watcher schedule failed", error);
    }
  }

  /** Scheduled callback (cron): deadlines, system health and the daily summary. */
  async watch(): Promise<void> {
    await runWatchers(this.services);
    try {
      // Notices before a calendar's first event, timed to the minute rather than to this round.
      await planNotices(this.services, async (at, payload) => {
        await this.schedule<NoticePayload>(at, "calendarNotice", payload, { idempotent: true });
      });
    } catch (error) {
      console.warn("Calendar notices failed", error instanceof Error ? error.message : String(error));
    }
    this.refreshUnread();
  }

  /** Scheduled callback: a notice before a calendar's first event of the day. */
  async calendarNotice(payload: NoticePayload): Promise<void> {
    if (await noticeDue(this.services, payload)) this.refreshUnread();
  }

  override async onRequest(request: Request): Promise<Response> {
    return api.fetch(request, { agent: this, env: this.env });
  }

  /**
   * Talorys has no sub-agents. Without this, the SDK forwards any `/sub/{class}/{name}/...`
   * request to a fresh facet with its own empty database, bypassing login rate limits.
   */
  override async onBeforeSubAgent(): Promise<Response> {
    return Response.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
  }

  /** Chooses the AI provider. The mock is only used in local development or explicit demo mode. */
  aiProvider(): AIProvider | null {
    const settings = this.services.settings.get();
    if (settings.demoMode) return new MockAIProvider();
    if (this.env.TALORYS_ENV === "development" && this.env.TALORYS_MOCK_AI === "1") return new MockAIProvider();
    if (!this.env.AI) return null;
    return new CloudflareWorkersAIProvider(this.env.AI, settings.model);
  }

  /** Clef for the memory-history AI check: only with real Workers AI (not mock AI or demo mode). */
  clefRun(): ClefRun | null {
    if (!this.env.AI || !(this.aiProvider() instanceof CloudflareWorkersAIProvider)) return null;
    const ai = this.env.AI;
    return (request, signal) => ai.run(CLEF_MODEL, { ...request }, { signal });
  }

  /**
   * Turns one audio clip (base64) into text, for the app's voice input and Telegram voice
   * messages alike: one clip at a time, within the daily audio cap, and the audio is never stored.
   * `seconds` is the length the sender reported, checked against the cap before any model call.
   */
  async transcribeClip(audio: string, opts: { context?: string; signal?: AbortSignal; seconds?: number } = {}): Promise<Transcription> {
    const s = this.services;
    const transcriber = createTranscriber(this.env, s.settings);
    if (!transcriber) throw new AppError("AI_UNAVAILABLE", "Workers AI is not configured.");
    const max = TRANSCRIPTION_LIMITS.maxSecondsPerDay;
    const today = s.usage.transcriptionSecondsToday();
    if (today >= max || (opts.seconds !== undefined && today + opts.seconds > max)) {
      throw new AppError("AI_LIMIT_REACHED", `Talorys reached its daily limit of ${max / 60} minutes of voice input.`);
    }
    if (this.transcribing) throw new AppError("CONFLICT", "A recording is already being transcribed.");
    this.transcribing = true;
    try {
      const result = await transcriber.transcribe(audio, { language: s.settings.language(), context: opts.context, signal: opts.signal });
      // Charge the longer of the two lengths, so a clip is never undercounted.
      const seconds = Math.max(result.seconds, opts.seconds ?? 0);
      s.usage.recordTranscription(transcriber.model, transcriber.billable, seconds);
      return { text: result.text, seconds };
    } catch (error) {
      s.usage.increment({ ai_errors: 1 });
      throw classifyAiError(error);
    } finally {
      this.transcribing = false;
    }
  }

  runner(): AgentRunner {
    return new AgentRunner(
      this.services,
      this.aiProvider(),
      semanticExtensions(this.services, this.env, (work) => this.ctx.waitUntil(work)),
      this.services.mcp.chatTools(),
      this.services.mcp.scheduledTools(),
    );
  }

  refreshUnread(): void {
    const unread = this.services.notifications.unreadCount();
    if (unread !== this.state.unread) this.setState({ unread });
  }

  /** Scheduled callback invoked by the Agents SDK (Durable Object alarm). */
  async runAutomation(payload: AutomationPayload, schedule: { id: string }): Promise<void> {
    await this.services.automations.fire(payload.automationId, schedule.id, (a) => this.executeAutomation(a));
    this.refreshUnread();
  }

  /** Scheduled callback: the next try of an insistent alert (AlertService.escalate). */
  async escalateAlert(payload: AlertPayload): Promise<void> {
    this.services.alerts.escalate(payload.notificationId);
  }

  /** "Run now" from the UI: executes immediately without touching the schedule. */
  async runAutomationNow(id: string) {
    // Asked for by the owner: the calendar condition doesn't hold it back.
    const run = await this.services.automations.runNow(id, (a) => this.executeAutomation(a, { manual: true }));
    this.refreshUnread();
    return run;
  }

  private async executeAutomation(a: Automation, opts: { manual?: boolean } = {}): Promise<{ status: "success" | "skipped"; result: string }> {
    const s = this.services;
    const settings = s.settings.get();
    const gate = opts.manual ? null : await gateAutomation(s, a);
    if (gate) return gate;
    switch (a.kind) {
      case "reminder": {
        // Simple reminders never use AI. Their text may come from the agent, so links can't be clicked.
        s.alerts.raise({
          title: "Reminder",
          body: defangLinks(a.message || a.name),
          automationId: a.id,
          category: "reminder",
          priority: a.priority,
          // One-time reminders learn together; a recurring one learns as itself.
          ...(a.schedule.type === "once" ? { profileKind: "once", profileLabel: "One-time reminders" } : { profileLabel: a.name }),
        });
        return { status: "success", result: "Reminder delivered" };
      }
      case "task_digest": {
        const bounds = localDayBounds(settings.timezone);
        const overdue = s.tasks.list({ view: "overdue", limit: 20 });
        const today = s.tasks.list({ view: "today", dayStart: bounds.start, dayEnd: bounds.end, limit: 20 }).filter(
          (t) => !overdue.some((o) => o.id === t.id),
        );
        const open = s.tasks.list({ status: "open", limit: 200 }).length;
        const line = (t: { title: string; due_at: string | null; priority: string }) =>
          `- ${defangLinks(t.title)}${t.due_at ? ` (due ${formatLocal(t.due_at, settings.timezone, s.settings.language())})` : ""}${t.priority === "high" || t.priority === "urgent" ? ` · ${t.priority}` : ""}`;
        const parts = [
          overdue.length ? `**Overdue (${overdue.length})**\n${overdue.map(line).join("\n")}` : "",
          today.length ? `**Due today (${today.length})**\n${today.map(line).join("\n")}` : "",
          `${open} open task(s) in total.`,
        ].filter(Boolean);
        if (a.message) parts.unshift(defangLinks(a.message));
        s.alerts.raise({ title: a.name, body: parts.join("\n\n"), automationId: a.id, category: "digest", priority: a.priority, profileLabel: a.name });
        return { status: "success", result: `${overdue.length} overdue, ${today.length} due today` };
      }
      case "agent_prompt": {
        if (!s.usage.canRunScheduledAi(settings.limits)) return skipForBudget(s, a);
        let text: string;
        try {
          text = await this.runner().runScheduledPrompt(a.message, undefined, a.name, { sentinel: a.sentinel });
        } catch (error) {
          // The budget ran out while this run waited (another run or chat took the last request).
          if (error instanceof AppError && error.code === "AI_LIMIT_REACHED") return skipForBudget(s, a);
          throw error;
        }
        // A sentinel with nothing to say stays quiet: the run history is the only trace.
        if (a.sentinel && isSentinelNothing(text)) return { status: "success", result: "Nothing needed your attention" };
        // The reply is model-written: links in it stay visible but can't be clicked.
        s.alerts.raise({ title: a.name, body: defangLinks(text), automationId: a.id, category: "routine", priority: a.priority, profileLabel: a.name });
        return { status: "success", result: text };
      }
    }
  }
}

function skipForBudget(s: Services, a: Automation): { status: "skipped"; result: string } {
  s.alerts.raise({
    title: a.name,
    body: "Skipped: the daily budget for scheduled AI runs was reached. Adjust it in Settings → AI.",
    automationId: a.id,
    category: "system",
    // One per routine and day is enough; every later skip would only repeat it.
    dedupeKey: `routine-budget:${a.id}`,
    cooldownMinutes: 20 * 60,
  });
  return { status: "skipped", result: "Scheduled AI budget reached" };
}
