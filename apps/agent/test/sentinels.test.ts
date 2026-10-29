import { isSentinelNothing, SENTINEL_NOTHING, SENTINEL_TEMPLATES, sentinelText } from "@talorys/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRunner } from "../src/agent/runner";
import { buildSystemPrompt, SENTINEL_RUN_PROMPT } from "../src/agent/prompt";
import { exportData, importData } from "../src/services/backup";
import { inAgent, loggedIn } from "./helpers";
import { pushServiceStub } from "./push-helpers";

beforeEach(async () => {
  await inAgent(async (a) => {
    const s = a.services;
    for (const x of s.automations.list()) await s.automations.delete(x.id);
    s.db.run(`DELETE FROM tal_notifications`);
    s.push.fetcher = pushServiceStub(201).fetcher;
  });
});

describe("sentinel replies", () => {
  it.each(["NOTHING", "Nothing.", "**NOTHING**", "  nothing \n", "NADA", "Nada!", ""])("%j means nothing to report", (reply) => {
    expect(isSentinelNothing(reply)).toBe(true);
  });

  it.each(["Nothing is due, but the rent is overdue.", "1. Pay rent", "NOTHING NEW: call the bank"])("%j is something to report", (reply) => {
    expect(isSentinelNothing(reply)).toBe(false);
  });

  it("asks only sentinel runs for the quiet answer", () => {
    const base = { agentName: "Axis", timezone: "UTC", now: new Date(), autoMemory: false, memories: [] };
    expect(buildSystemPrompt({ ...base, scheduled: true, sentinel: true })).toContain(SENTINEL_RUN_PROMPT);
    expect(SENTINEL_RUN_PROMPT).toContain(`exactly ${SENTINEL_NOTHING}`);
    expect(buildSystemPrompt({ ...base, scheduled: true })).not.toContain(SENTINEL_RUN_PROMPT);
    // Never in a live chat, even if asked.
    expect(buildSystemPrompt({ ...base, sentinel: true })).not.toContain(SENTINEL_RUN_PROMPT);
  });

  it("has a morning and a weekly template in English and Portuguese, falling back to English", () => {
    expect(SENTINEL_TEMPLATES.map((t) => t.id)).toEqual(["morning", "weekly", "briefing", "closing", "saturday"]);
    const morning = SENTINEL_TEMPLATES[0]!;
    expect(sentinelText(morning, "pt-BR").name).toBe("Checagem da manhã");
    expect(sentinelText(morning, "ko")).toEqual(morning.text.en);
  });
});

describe("sentinel routines", () => {
  it("stays quiet when nothing needs the owner, and speaks when something does", async () => {
    await inAgent(async (a) => {
      const s = a.services;
      const sentinel = await s.automations.create({
        name: "Morning check", kind: "agent_prompt", message: "Tell me what needs me", schedule: { type: "daily", time: "07:00" }, enabled: false, sentinel: true,
      });
      expect(sentinel.sentinel).toBe(true);
      let reply = "NOTHING.";
      const runScheduledPrompt = vi.fn(async () => reply);
      const runner = vi.spyOn(a, "runner").mockReturnValue({ runScheduledPrompt } as unknown as AgentRunner);
      try {
        expect(await a["executeAutomation"](sentinel)).toEqual({ status: "success", result: "Nothing needed your attention" });
        expect(runScheduledPrompt).toHaveBeenCalledWith("Tell me what needs me", undefined, "Morning check", { sentinel: true });
        expect(s.notifications.list({ limit: 10 })).toHaveLength(0);

        reply = "Rent is overdue: pay it at https://evil.example today.";
        expect((await a["executeAutomation"](sentinel)).status).toBe("success");
        const [n] = s.notifications.list({ limit: 10 });
        expect(n).toMatchObject({ title: "Morning check", category: "routine" });
        expect(n!.body).toContain("`https://evil.example`");

        // A routine that isn't a sentinel delivers whatever it says, NOTHING included.
        const plain = await s.automations.create({ name: "Quote", kind: "agent_prompt", message: "A quote", schedule: { type: "daily", time: "08:00" }, enabled: false });
        reply = "NOTHING";
        await a["executeAutomation"](plain);
        expect(runScheduledPrompt).toHaveBeenLastCalledWith("A quote", undefined, "Quote", { sentinel: false });
        expect(s.notifications.list({ limit: 10 }).map((x) => x.title)).toContain("Quote");
      } finally {
        runner.mockRestore();
      }
    });
  });

  it("is set and changed through the API, only on AI routines", async () => {
    const c = await loggedIn();
    const created = await c.json("/api/automations", {
      method: "POST",
      body: { name: "Weekly review", kind: "agent_prompt", message: "Review my week", schedule: { type: "weekly", days: [5], time: "17:00" }, sentinel: true },
    });
    expect(created.automation).toMatchObject({ kind: "agent_prompt", sentinel: true });
    const off = await c.json(`/api/automations/${created.automation.id}`, { method: "PATCH", body: { sentinel: false } });
    expect(off.automation.sentinel).toBe(false);

    const reminder = await c.call("/api/automations", {
      method: "POST",
      body: { name: "Water", kind: "reminder", message: "Drink water", schedule: { type: "daily", time: "10:00" }, sentinel: true },
    });
    expect(reminder.status).toBe(400);
    const plain = await c.json("/api/automations", { method: "POST", body: { name: "Water", kind: "reminder", message: "Drink water", schedule: { type: "daily", time: "10:00" } } });
    expect(plain.automation.sentinel).toBe(false);
    expect((await c.call(`/api/automations/${plain.automation.id}`, { method: "PATCH", body: { sentinel: true } })).status).toBe(400);
  });

  it("keeps the sentinel switch through a backup, and only on AI routines", async () => {
    await inAgent(async (a) => {
      const s = a.services;
      await s.automations.create({ name: "Check", kind: "agent_prompt", message: "Check", schedule: { type: "daily", time: "07:00" }, enabled: false, sentinel: true });
      const backup = JSON.parse(JSON.stringify(exportData(s)));
      expect(backup.data.automations[0].sentinel).toBe(true);
      for (const x of s.automations.list()) await s.automations.delete(x.id);
      backup.data.automations.push({ ...backup.data.automations[0], id: crypto.randomUUID(), kind: "reminder", name: "Forged" });
      await importData(s, backup);
      const byName = Object.fromEntries(s.automations.list().map((x) => [x.name, x]));
      expect(byName.Check).toMatchObject({ sentinel: true, enabled: false });
      expect(byName.Forged!.sentinel).toBe(false);
    });
  });
});
