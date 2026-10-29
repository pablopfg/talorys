import { STORAGE_LIMITS, TRASH_LIMITS, type Memory } from "@talorys/shared";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inAgent } from "./helpers";
import type { Services } from "../src/services/container";
import { type DuplicateFinder, sameFact } from "../src/services/retention";
import { storedDuplicates } from "../src/semantic/neighbors";
import { deleteSemanticConfig, readSemanticConfig, writeSemanticConfig } from "../src/semantic/config";
import { invalidateSemanticCache } from "../src/semantic";
import { dropSemanticData } from "../src/semantic/migrations";
import { runIndexer } from "../src/semantic/indexer";
import { createSemanticContext } from "../src/semantic/recall";
import { embeddingsToday } from "../src/semantic/embeddings";
import { UsageService } from "../src/services/usage";

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const later = (days: number) => new Date(Date.now() + days * DAY);

function reset(s: Services) {
  for (const table of ["tal_tasks", "tal_notes", "tal_messages", "tal_conversations", "tal_memory_reviews", "tal_trash"]) s.db.run(`DELETE FROM ${table}`);
  s.memories.clear();
  s.db.run(`DELETE FROM tal_settings WHERE key = 'retention.state'`);
  s.db.run(`DELETE FROM tal_notifications WHERE dedupe_key LIKE 'retention-%'`);
  s.storage.limits = { ...STORAGE_LIMITS };
  s.storage.trashLimits = structuredClone(TRASH_LIMITS);
  s.settings.update({ autoCleanup: true });
}

beforeEach(() => inAgent((a) => reset(a.services)));
afterEach(() => inAgent((a) => reset(a.services)));

/** A memory with chosen dates and source, written past the repository's repeat check. */
function memory(s: Services, content: string, daysAgo: number, opts: { source?: Memory["source"]; edited?: boolean; category?: Memory["category"] } = {}) {
  const m = s.memories.create({ content: `placeholder ${crypto.randomUUID()}`, source: opts.source ?? "agent", category: opts.category ?? "fact" });
  const created = ago(daysAgo);
  s.db.run(`UPDATE tal_memories SET content = ?, created_at = ?, updated_at = ? WHERE id = ?`, content, created, opts.edited ? ago(daysAgo / 2) : created, m.id);
  return m.id;
}

const notice = (s: Services, key: string) => s.db.one<{ title: string; body: string }>(`SELECT title, body FROM tal_notifications WHERE dedupe_key = ?`, key);

describe("weekly cleanup", () => {
  it("archives old finished tasks and trashes old empty notes, never open tasks or real notes", async () => {
    await inAgent((a) => {
      const s = a.services;
      const oldDone = s.tasks.create({ title: "Filed taxes", status: "done" });
      s.db.run(`UPDATE tal_tasks SET completed_at = ? WHERE id = ?`, ago(120), oldDone.id);
      const recentDone = s.tasks.create({ title: "Bought milk", status: "done" });
      const oldOpen = s.tasks.create({ title: "Learn the cello" });
      s.db.run(`UPDATE tal_tasks SET created_at = ?, updated_at = ? WHERE id = ?`, ago(400), ago(400), oldOpen.id);

      const empty = s.notes.create({ title: "Untitled", content: "  " });
      const emptyNew = s.notes.create({ title: "Untitled", content: "" });
      const titled = s.notes.create({ title: "Gift ideas", content: "" });
      const stale = s.notes.create({ title: "Old recipe", content: "Flour" });
      s.db.run(`UPDATE tal_notes SET updated_at = ? WHERE id IN (?, ?)`, ago(30), empty.id, titled.id);
      s.db.run(`UPDATE tal_notes SET updated_at = ? WHERE id = ?`, ago(200), stale.id);

      const report = s.retention.cleanup();
      expect(report).toEqual({ tasks_archived: 1, notes_trashed: 1, stale_notes: 1, messages_removed: 0 });
      expect(s.tasks.get(oldDone.id)).toBeNull();
      expect([recentDone.id, oldOpen.id].map((id) => !!s.tasks.get(id))).toEqual([true, true]);
      expect(s.notes.get(empty.id)).toBeNull();
      expect([emptyNew.id, titled.id, stale.id].map((id) => !!s.notes.get(id))).toEqual([true, true, true]);

      const trash = s.storage.listTrash();
      expect(trash.find((t) => t.item_id === oldDone.id)).toMatchObject({ reason: "archived", actor: "system" });
      expect(trash.find((t) => t.item_id === empty.id)).toMatchObject({ reason: "deleted", actor: "system" });
      s.storage.restore(trash.find((t) => t.item_id === oldDone.id)!.id);
      expect(s.tasks.get(oldDone.id)?.status).toBe("done");
      s.db.run(`DELETE FROM tal_tasks WHERE id = ?`, oldDone.id);

      const sent = notice(s, "retention-cleanup");
      expect(sent?.title).toBe("Weekly cleanup");
      expect(sent?.body).toContain("1 finished task(s) archived");
      expect(sent?.body).toContain("1 note(s) unchanged for 6 months");
      // The same stale count is not suggested again.
      s.db.run(`DELETE FROM tal_notifications WHERE dedupe_key = 'retention-cleanup'`);
      s.retention.cleanup();
      expect(notice(s, "retention-cleanup")).toBeNull();
    });
  });

  it("removes only old messages the summary covers without a gap, and never imported ones", async () => {
    await inAgent((a) => {
      const s = a.services;
      const at = (id: string, days: number) => s.db.run(`UPDATE tal_messages SET created_at = ? WHERE id = ?`, ago(days), id);
      const conv = s.conversations.create("Old chat");
      // Fell out of the context window before any summary existed: never summarized.
      const lost = s.conversations.addMessage({ conversation_id: conv.id, role: "user", content: "very old" });
      at(lost.id, 300);
      const old1 = s.conversations.addMessage({ conversation_id: conv.id, role: "user", content: "old question" });
      const old2 = s.conversations.addMessage({ conversation_id: conv.id, role: "assistant", content: "old answer" });
      at(old1.id, 201);
      at(old2.id, 200);
      const recent = s.conversations.addMessage({ conversation_id: conv.id, role: "user", content: "new question" });
      const created = (id: string) => s.db.one<{ created_at: string }>(`SELECT created_at FROM tal_messages WHERE id = ?`, id)!.created_at;
      s.conversations.setSummary(conv.id, "They asked an old question.", { first: created(old1.id), last: created(old2.id) });
      expect(s.conversations.get(conv.id)?.summary_from).toBe(created(old1.id));

      // Coverage that continues the previous summary keeps its start.
      const continued = s.conversations.create("Continued");
      const c1 = s.conversations.addMessage({ conversation_id: continued.id, role: "user", content: "first" });
      const c2 = s.conversations.addMessage({ conversation_id: continued.id, role: "user", content: "second" });
      at(c1.id, 250);
      at(c2.id, 240);
      const c1At = s.db.one<{ created_at: string }>(`SELECT created_at FROM tal_messages WHERE id = ?`, c1.id)!.created_at;
      const c2At = s.db.one<{ created_at: string }>(`SELECT created_at FROM tal_messages WHERE id = ?`, c2.id)!.created_at;
      s.conversations.setSummary(continued.id, "First part.", { first: c1At, last: c1At });
      s.conversations.setSummary(continued.id, "Both parts.", { first: c2At, last: c2At });
      expect(s.conversations.get(continued.id)?.summary_from).toBe(c1At);

      // A summary from before this version: coverage unknown, so nothing goes.
      const legacy = s.conversations.create("Legacy");
      const l1 = s.conversations.addMessage({ conversation_id: legacy.id, role: "user", content: "legacy" });
      at(l1.id, 300);
      s.db.run(`UPDATE tal_conversations SET summary = 'Legacy summary', summary_upto = ? WHERE id = ?`, ago(100), legacy.id);

      // Imported turns are never removed.
      const imported = s.conversations.create("Imported");
      const i1 = s.conversations.addMessage({ conversation_id: imported.id, role: "user", content: "from a file" });
      at(i1.id, 300);
      s.db.run(`UPDATE tal_messages SET source = 'import' WHERE id = ?`, i1.id);
      const i1At = s.db.one<{ created_at: string }>(`SELECT created_at FROM tal_messages WHERE id = ?`, i1.id)!.created_at;
      s.conversations.setSummary(imported.id, "Imported.", { first: i1At, last: i1At });

      expect(s.retention.cleanup().messages_removed).toBe(4);
      expect(s.conversations.messages(conv.id).map((m) => m.id)).toEqual([lost.id, recent.id]);
      expect(s.conversations.messages(continued.id)).toEqual([]);
      expect(s.conversations.messages(legacy.id).map((m) => m.id)).toEqual([l1.id]);
      expect(s.conversations.messages(imported.id).map((m) => m.id)).toEqual([i1.id]);
    });
  });

  it("announces itself and waits 7 days, then runs weekly, and never while switched off", async () => {
    await inAgent(async (a) => {
      const s = a.services;
      const t = s.tasks.create({ title: "Old", status: "done" });
      s.db.run(`UPDATE tal_tasks SET completed_at = ? WHERE id = ?`, ago(100), t.id);
      await s.retention.runDue();
      expect(notice(s, "retention-start")?.title).toBe("Automatic cleanup");
      expect(s.tasks.get(t.id)).not.toBeNull();
      await s.retention.runDue(undefined, later(3));
      expect(s.tasks.get(t.id)).not.toBeNull();

      s.settings.update({ autoCleanup: false });
      await s.retention.runDue(undefined, later(8));
      expect(s.tasks.get(t.id)).not.toBeNull();
      s.settings.update({ autoCleanup: true });
      await s.retention.runDue(undefined, later(8));
      expect(s.tasks.get(t.id)).toBeNull();

      const again = s.tasks.create({ title: "Old too", status: "done" });
      s.db.run(`UPDATE tal_tasks SET completed_at = ? WHERE id = ?`, ago(100), again.id);
      await s.retention.runDue(undefined, later(10));
      expect(s.tasks.get(again.id)).not.toBeNull();
      await s.retention.runDue(undefined, later(16));
      expect(s.tasks.get(again.id)).toBeNull();
    });
  });

  it("stops and tells the owner when the archive has no more room", async () => {
    await inAgent((a) => {
      const s = a.services;
      s.storage.trashLimits.system.items = 1;
      for (const title of ["a", "b", "c"]) {
        const t = s.tasks.create({ title, status: "done" });
        s.db.run(`UPDATE tal_tasks SET completed_at = ? WHERE id = ?`, ago(100), t.id);
      }
      expect(s.retention.cleanup().tasks_archived).toBe(1);
      expect(s.storage.count("tasks")).toBe(2);
      expect(notice(s, "retention-full")?.title).toBe("Automatic cleanup paused");
    });
  });
});

describe("memory compaction", () => {
  it("combines exact repeats the agent saved, and never removes the owner's, imported or edited ones", async () => {
    await inAgent(async (a) => {
      const s = a.services;
      const agentOld = memory(s, "prefers TEA in the morning", 10);
      const agentNew = memory(s, "Prefers tea in the morning", 2);
      const imported = memory(s, "Walks the dog at 7", 20, { source: "import" });
      const agentLater = memory(s, "walks the dog at 7", 3);
      const edited = memory(s, "Drinks oat milk", 15, { edited: true });
      const manual = memory(s, "drinks oat milk", 5, { source: "manual" });
      const otherCategory = memory(s, "Prefers tea in the morning", 1, { category: "preference" });

      const report = await s.retention.compact();
      expect(report.combined).toBe(1);
      expect(s.memories.get(agentOld)).toBeNull();
      expect([agentNew, imported, agentLater, edited, manual, otherCategory].map((id) => !!s.memories.get(id))).toEqual([true, true, true, true, true, true]);
      const trashed = s.storage.listTrash({ kind: "memory" });
      expect(trashed.map((t) => [t.item_id, t.reason, t.actor])).toEqual([[agentOld, "compacted", "system"]]);
      expect(notice(s, "retention-compaction")?.body).toContain("combined 1 repeated memory(ies)");
      expect(s.retention.state()).toMatchObject({ compaction_cursor: null, last_compaction: expect.any(String) });
    });
  });

  it("combines close copies only when the wording says the same thing, and leaves linked, reviewed or token-made ones", async () => {
    await inAgent(async (a) => {
      const s = a.services;
      const lisbonOld = memory(s, "Lives in Lisbon, Portugal", 15);
      const lisbonNew = memory(s, "Lives in Lisbon (Portugal)", 1);
      const allergic = memory(s, "Allergic to penicillin", 12);
      const notAllergic = memory(s, "Not allergic to penicillin", 2);
      const eight = memory(s, "School starts at 8:00", 11);
      const eightThirty = memory(s, "School starts at 8:30", 3);
      const linked = memory(s, "Works at Acme Corp", 14);
      const newerLinked = memory(s, "Works at Acme Corp.", 4);
      const past = memory(s, "Works at Initech", 30);
      s.db.run(`UPDATE tal_memories SET status = 'historical', superseded_by = ? WHERE id = ?`, linked, past);
      const reviewed = memory(s, "Plays chess on Fridays", 13);
      const newerReviewed = memory(s, "Plays chess on Fridays!", 5);
      s.memories.createReview({ memory_id: reviewed, other_id: past, relationship: "possible_update", reason: "test" });
      const agentTennis = memory(s, "Plays tennis on Mondays", 9);
      const tokenSent = memory(s, "Plays tennis on Mondays.", 6, { source: "remote" });

      // A fake vector search that calls every pair close.
      const pairs = [[lisbonOld, lisbonNew], [allergic, notAllergic], [eight, eightThirty], [linked, newerLinked], [reviewed, newerReviewed], [agentTennis, tokenSent]];
      const finder: DuplicateFinder = async (batch) => {
        const out = new Map<string, string[]>();
        for (const m of batch) for (const [x, y] of pairs) if (m.id === x || m.id === y) out.set(m.id, [m.id === x ? y! : x!]);
        return out;
      };
      const report = await s.retention.compact(finder);
      expect(report.combined).toBe(1);
      expect(s.memories.get(lisbonOld)).toBeNull();
      for (const id of [lisbonNew, allergic, notAllergic, eight, eightThirty, linked, newerLinked, reviewed, newerReviewed, agentTennis, tokenSent]) {
        expect(s.memories.get(id)).not.toBeNull();
      }
    });
  });

  it("leaves a copy whose newer version changed while the vector search ran", async () => {
    await inAgent(async (a) => {
      const s = a.services;
      const old = memory(s, "Likes jazz music", 10);
      const newer = memory(s, "Likes jazz music!", 1);
      const report = await s.retention.compact(async () => {
        s.memories.update(newer, { content: "Likes rock music" });
        return new Map([[newer, [old]]]);
      });
      expect(report.combined).toBe(0);
      expect(s.memories.get(old)).not.toBeNull();
    });
  });

  it("checks every new memory over several rounds, ties included, and reports once at the end", async () => {
    await inAgent(async (a) => {
      const s = a.services;
      const tie = ago(1);
      const ids: string[] = [];
      for (let i = 0; i < 60; i++) {
        const id = memory(s, `Fact number ${i}`, 1);
        s.db.run(`UPDATE tal_memories SET created_at = ?, updated_at = ? WHERE id = ?`, tie, tie, id);
        ids.push(id);
      }
      const older = memory(s, "Fact number 0.", 5);
      const seen: string[] = [];
      const finder: DuplicateFinder = async (batch) => {
        seen.push(...batch.map((m) => m.id));
        return new Map(batch.filter((m) => m.id === ids[0]).map((m) => [m.id, [older]]));
      };
      const first = await s.retention.compact(finder);
      expect([first.checked, first.done]).toEqual([50, false]);
      expect(notice(s, "retention-compaction")).toBeNull();
      const second = await s.retention.compact(finder);
      expect(second.done).toBe(true);
      expect(new Set(seen.filter((id) => ids.includes(id))).size).toBe(60);
      expect(s.memories.get(older)).toBeNull();
      expect(notice(s, "retention-compaction")?.body).toContain("combined 1 repeated memory(ies)");
    });
  });

  it("is due after 50 new memories in 15 days, or early near the limit, and checks at most once a day", async () => {
    await inAgent(async (a) => {
      const s = a.services;
      let calls = 0;
      const finder: DuplicateFinder = async (batch) => {
        calls += batch.length;
        return new Map();
      };
      s.settings.setJson("retention.state", { starts_at: ago(1) });
      for (let i = 0; i < 10; i++) memory(s, `Early ${i}`, 0.5);
      await s.retention.runDue(finder);
      expect(calls).toBe(0);
      s.storage.limits = { ...s.storage.limits, memories: 12 };
      await s.retention.runDue(finder, new Date(Date.now() + 2 * 3_600_000));
      expect(calls).toBe(0);
      await s.retention.runDue(finder, later(1.1));
      expect(calls).toBe(10);
    });
  });

  it("tells repeated wording apart from a different fact", () => {
    expect(sameFact("Lives in Lisbon, Portugal", "lives in lisbon (Portugal)")).toBe(true);
    expect(sameFact("Allergic to penicillin", "Not allergic to penicillin")).toBe(false);
    expect(sameFact("Gosta de chá", "Não gosta de chá")).toBe(false);
    expect(sameFact("PIN is 1234", "PIN is 1235")).toBe(false);
    expect(sameFact("Has a cat named Tom", "Has a dog named Rex")).toBe(false);
  });
});

describe("stored duplicates", () => {
  it("reads stored vectors for a whole batch and never embeds anything", async () => {
    await inAgent(async (a) => {
      const s = a.services;
      dropSemanticData(s.db);
      deleteSemanticConfig(s.settings);
      invalidateSemanticCache(s);
      try {
        const first = memory(s, "Plays the piano on Sundays", 3);
        const second = memory(s, "Plays the piano on Sundays", 2);
        const other = memory(s, "The car is blue", 1);
        expect(await storedDuplicates(s, env as never, [s.memories.get(second)!], 0.95)).toBeNull();
        writeSemanticConfig(s.settings, { enabled: true }, s.db);
        invalidateSemanticCache(s);
        await runIndexer(createSemanticContext(s, env as never, readSemanticConfig(s.settings, s.db)!));
        const before = embeddingsToday(s.db, UsageService.day());
        const found = await storedDuplicates(s, env as never, [s.memories.get(second)!, s.memories.get(other)!], 0.95);
        expect(found?.get(second)).toContain(first);
        expect(found?.get(second) ?? []).not.toContain(other);
        expect(embeddingsToday(s.db, UsageService.day())).toBe(before);
      } finally {
        dropSemanticData(s.db);
        deleteSemanticConfig(s.settings);
        invalidateSemanticCache(s);
      }
    });
  });
});
