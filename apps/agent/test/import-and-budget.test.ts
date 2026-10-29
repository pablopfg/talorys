import { BACKUP_FORMAT } from "@talorys/shared";
import { describe, expect, it } from "vitest";
import { inAgent, loggedIn } from "./helpers";
import { AgentRunner } from "../src/agent/runner";
import { errorSummary } from "../src/api/errors";
import { MAX_IMPORT_RECORDS } from "../src/services/backup";
import { UsageService } from "../src/services/usage";
import type { ChatStreamEvent } from "@talorys/shared";
import type { AgentEvent, AIProvider, GenerateRequest, ToolRequest } from "../src/ai/provider";

const backupOf = (data: Record<string, unknown>) => ({ format: BACKUP_FORMAT, version: 1, exported_at: new Date().toISOString(), data });

describe("backup timestamps can't be forged (AGT-04)", () => {
  it("stores a future date as the import time, so a later local edit still wins", async () => {
    const c = await loggedIn();
    const id = crypto.randomUUID();
    const backup = backupOf({
      notes: [{ id, title: "Forged", content: "from the backup", created_at: "9999-01-01T00:00:00.000Z", updated_at: "9999-01-01T00:00:00.000Z" }],
    });
    await c.json("/api/import", { method: "POST", body: backup });
    const imported = await inAgent((a) => a.services.notes.get(id)!);
    expect(Date.parse(imported.updated_at)).toBeLessThanOrEqual(Date.now());
    expect(imported.created_at.startsWith("9999")).toBe(false);

    await new Promise((r) => setTimeout(r, 5));
    await inAgent((a) => a.services.notes.update(id, { content: "my local edit" }));
    // The same file again can't overwrite the newer local version.
    await c.json("/api/import", { method: "POST", body: backup });
    expect(await inAgent((a) => a.services.notes.get(id)?.content)).toBe("my local edit");
  });

  it("replaces an unreadable date with the import time", async () => {
    const c = await loggedIn();
    const id = crypto.randomUUID();
    await c.json("/api/import", {
      method: "POST",
      body: backupOf({ tasks: [{ id, title: "Odd dates", status: "todo", created_at: "yesterday", updated_at: "zzz" }] }),
    });
    const task = await inAgent((a) => a.services.tasks.get(id)!);
    expect(Number.isNaN(Date.parse(task.updated_at))).toBe(false);
    expect(Number.isNaN(Date.parse(task.created_at))).toBe(false);
  });

  it("refuses a backup with more records than the limit, importing nothing", async () => {
    const c = await loggedIn();
    const max = MAX_IMPORT_RECORDS.automations;
    const automations = Array.from({ length: max + 1 }, (_, i) => ({
      id: crypto.randomUUID(), name: `A${i}`, kind: "reminder", message: "hi", schedule: { type: "daily", time: "09:00" }, enabled: false,
    }));
    const marker = crypto.randomUUID();
    const res = await c.call("/api/import", {
      method: "POST",
      body: backupOf({ automations, projects: [{ id: marker, name: "Should not land", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" }] }),
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain(`automations: more than ${max}`);
    expect(await inAgent((a) => a.services.projects.get(marker))).toBeNull();
  });
});

describe("daily budgets follow the owner's timezone (AGT-07)", () => {
  it("counts a call made at 23:00 in São Paulo on that local day", async () => {
    await inAgent((a) => {
      const usage = new UsageService(a.services.db, () => "America/Sao_Paulo");
      // 02:00 UTC on Oct 29 is 23:00 on Oct 28 in São Paulo.
      const late = new Date("2026-10-29T02:00:00Z");
      expect(usage.day(late)).toBe("2026-10-28");
      expect(UsageService.day(late)).toBe("2026-10-29");
      a.services.db.run("DELETE FROM tal_usage_daily WHERE day IN ('2026-10-28', '2026-10-29')");
      usage.increment({ ai_requests: 1 }, late);
      expect(a.services.db.one<{ day: string }>("SELECT day FROM tal_usage_daily WHERE ai_requests > 0 AND day IN ('2026-10-28', '2026-10-29')")?.day).toBe(
        "2026-10-28",
      );
      a.services.db.run("DELETE FROM tal_usage_daily WHERE day IN ('2026-10-28', '2026-10-29')");
    });
  });

  it("uses the timezone from settings, and UTC if it is unusable", async () => {
    await inAgent((a) => {
      const s = a.services;
      const before = s.settings.get().timezone;
      try {
        s.settings.update({ timezone: "Asia/Tokyo" });
        const at = new Date("2026-10-28T20:00:00Z"); // 05:00 on Oct 29 in Tokyo
        expect(s.usage.day(at)).toBe("2026-10-29");
      } finally {
        s.settings.update({ timezone: before });
      }
      expect(new UsageService(s.db, () => "Not/AZone").day(new Date("2026-10-28T23:30:00Z"))).toBe("2026-10-28");
    });
  });

  it("counts the tools a turn ran even when the model then fails", async () => {
    class FailsAfterATool implements AIProvider {
      readonly id = "fails";
      readonly model = "mock";
      readonly billable = false;
      async generate(_req: GenerateRequest) {
        return { text: "", usage: { model: this.model, billable: false, inputTokens: { reported: 0, estimated: 0 }, outputTokens: { reported: 0, estimated: 0 }, cachedInputTokens: 0 } };
      }
      async *stream(): AsyncIterable<AgentEvent> {}
      async *generateWithTools(req: ToolRequest): AsyncIterable<AgentEvent> {
        await req.tools.find((t) => t.name === "list_tasks")!.execute({}, "call-1");
        throw new Error("provider exploded");
      }
    }
    await inAgent(async (a) => {
      const s = a.services;
      const before = s.usage.today().tool_calls;
      const events: ChatStreamEvent[] = [];
      for await (const e of new AgentRunner(s, new FailsAfterATool()).chat({ message: "what's due?", signal: new AbortController().signal })) {
        events.push(e);
      }
      expect(events.some((e) => e.type === "error")).toBe(true);
      expect(s.usage.today().tool_calls).toBe(before + 1);
    });
  });
});

describe("logs leave out content (AGT-08)", () => {
  it.each([
    [new Error("3040: capacity exceeded while answering 'my bank PIN is 1234'"), "Error 3040"],
    [new TypeError("Cannot read properties of undefined"), "TypeError"],
    ["plain string with a secret", "string"],
  ])("%s", (error, summary) => {
    expect(errorSummary(error)).toBe(summary);
  });
});
