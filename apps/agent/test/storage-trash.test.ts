import { BACKUP_FORMAT, STORAGE_LIMITS, TRASH_LIMITS } from "@talorys/shared";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { bearer, inAgent, loggedIn } from "./helpers";
import { isRemoteAllowed } from "../src/remote/allowlist";
import { invalidateSemanticCache } from "../src/semantic";
import { deleteSemanticConfig, writeSemanticConfig } from "../src/semantic/config";
import { embeddingsToday, recordEmbeddings } from "../src/semantic/embeddings";
import { dropSemanticData } from "../src/semantic/migrations";
import { semanticNeighbors } from "../src/semantic/neighbors";
import { UsageService } from "../src/services/usage";
import type { Env } from "../src/env";

/** Puts the real limits back after a test that lowered them. */
afterEach(async () => {
  await inAgent((a) => {
    a.services.storage.limits = { ...STORAGE_LIMITS };
    a.services.storage.trashLimits = structuredClone(TRASH_LIMITS);
    a.services.storage.empty({ includeArchive: true });
    a.services.remote.revokeAll();
    a.services.remote.setEnabled(false);
  });
});

/** Lowers one kind's limit to what is stored now, so the next create is refused. */
const fill = (kind: "tasks" | "notes" | "memories" | "conversations" | "messages", extra = 0) =>
  inAgent((a) => {
    a.services.storage.limits = { ...a.services.storage.limits, [kind]: a.services.storage.count(kind) + extra };
  });

describe("trash", () => {
  it("keeps a deleted task, note and memory, and restores each as it was", async () => {
    const c = await loggedIn();
    const { project } = await c.json("/api/projects", { method: "POST", body: { name: `Trash ${crypto.randomUUID()}` } });
    const { task } = await c.json("/api/tasks", { method: "POST", body: { title: "Renew passport", description: "Bring photos", priority: "high", project_id: project.id } });
    const { note } = await c.json("/api/notes", { method: "POST", body: { title: "Packing list", content: "Socks\nCharger" } });
    const { memory } = await c.json("/api/memories", { method: "POST", body: { content: `Keeps the spare key under pot ${crypto.randomUUID()}` } });

    for (const path of [`/api/tasks/${task.id}`, `/api/notes/${note.id}`, `/api/memories/${memory.id}`]) {
      expect((await c.call(path, { method: "DELETE" })).status).toBe(200);
      expect((await c.call(path)).status).toBe(404);
    }
    // A link to a project deleted in the meantime is dropped on restore.
    await c.call(`/api/projects/${project.id}`, { method: "DELETE" });

    const { items } = await c.json("/api/trash");
    const entry = (id: string) => items.find((i: { item_id: string }) => i.item_id === id);
    expect(entry(task.id)).toMatchObject({ kind: "task", title: "Renew passport", reason: "deleted" });
    expect(entry(note.id)).toMatchObject({ kind: "note", title: "Packing list" });
    expect(entry(memory.id)).toMatchObject({ kind: "memory", reason: "deleted" });
    expect(Date.parse(entry(task.id).expires_at) - Date.parse(entry(task.id).deleted_at)).toBe(30 * 86_400_000);
    // The listing never carries the stored copy.
    expect(entry(task.id).payload).toBeUndefined();

    for (const id of [task.id, note.id, memory.id]) {
      expect((await c.call(`/api/trash/${entry(id).id}/restore`, { method: "POST" })).status).toBe(200);
    }
    expect((await c.json(`/api/tasks/${task.id}`)).task).toEqual({ ...task, project_id: null });
    expect((await c.json(`/api/notes/${note.id}`)).note).toEqual(note);
    expect((await c.json(`/api/memories/${memory.id}`)).memory.content).toBe(memory.content);
    expect((await c.json("/api/trash")).items.some((i: { item_id: string }) => [task.id, note.id, memory.id].includes(i.item_id))).toBe(false);
    // Restoring twice is refused.
    expect((await c.call(`/api/trash/${entry(task.id).id}/restore`, { method: "POST" })).status).toBe(404);

    for (const path of [`/api/tasks/${task.id}`, `/api/notes/${note.id}`, `/api/memories/${memory.id}`]) await c.call(path, { method: "DELETE" });
  });

  it("deletes for good one by one or all at once, and keeps the archive when emptying", async () => {
    const c = await loggedIn();
    const ids = await inAgent((a) => {
      const s = a.services;
      const kept = s.tasks.create({ title: "Old finished task", status: "done" });
      const gone = s.tasks.create({ title: "Typo task" });
      const other = s.notes.create({ title: "Scratch" });
      s.tasks.delete(kept.id, { reason: "archived" });
      s.tasks.delete(gone.id);
      s.notes.delete(other.id);
      return { kept: kept.id, gone: gone.id, other: other.id };
    });
    const { items } = await c.json("/api/trash");
    const find = (id: string) => items.find((i: { item_id: string }) => i.item_id === id);
    expect(find(ids.kept)).toMatchObject({ reason: "archived" });
    expect(Date.parse(find(ids.kept).expires_at) - Date.parse(find(ids.kept).deleted_at)).toBe(365 * 86_400_000);

    expect((await c.call(`/api/trash/${find(ids.gone).id}`, { method: "DELETE" })).status).toBe(200);
    expect((await c.call(`/api/trash/${find(ids.gone).id}`, { method: "DELETE" })).status).toBe(404);

    expect((await c.call("/api/trash", { method: "DELETE", body: {} })).status).toBe(400);
    expect((await c.json("/api/trash", { method: "DELETE", body: { confirm: "DELETE" } })).deleted).toBe(1);
    const left = (await c.json("/api/trash")).items.map((i: { item_id: string }) => i.item_id);
    expect(left).toEqual([ids.kept]);
  });

  it("purges expired entries and never keeps more than its cap", async () => {
    const c = await loggedIn();
    await inAgent((a) => {
      const s = a.services;
      s.storage.trashLimits.owner.items = 2;
      for (const title of ["first", "second", "third"]) s.notes.delete(s.notes.create({ title }).id);
    });
    expect((await c.json("/api/trash")).items.map((i: { title: string }) => i.title).sort()).toEqual(["second", "third"]);
    await inAgent((a) => a.services.db.run(`UPDATE tal_trash SET expires_at = ? WHERE title = 'second'`, new Date(Date.now() - 1000).toISOString()));
    expect((await c.json("/api/trash")).items.map((i: { title: string }) => i.title)).toEqual(["third"]);
  });

  it("refuses a token's delete when its share is full, and never evicts the owner's entries for it", async () => {
    const token = await inAgent(async (a) => {
      a.services.remote.setEnabled(true);
      return (await a.services.remote.create({ name: "flood", scope: "write" })).token;
    });
    const b = bearer(token);
    const c = await loggedIn();
    const owner = (await c.json("/api/notes", { method: "POST", body: { title: "Owner deleted this" } })).note;
    await c.call(`/api/notes/${owner.id}`, { method: "DELETE" });
    const first = (await b.json("/api/notes", { method: "POST", body: { title: "Real note the token deletes" } })).note;
    expect((await b.call(`/api/notes/${first.id}`, { method: "DELETE" })).status).toBe(200);
    await inAgent((a) => {
      a.services.storage.trashLimits.remote.items = 1;
    });
    const junk = (await b.json("/api/notes", { method: "POST", body: { title: "Junk" } })).note;
    const refused = await b.call(`/api/notes/${junk.id}`, { method: "DELETE" });
    expect(refused.status).toBe(409);
    // The refusal cancels the delete itself, and both earlier entries are still restorable.
    expect((await c.call(`/api/notes/${junk.id}`)).status).toBe(200);
    const items = (await c.json("/api/trash")).items as { item_id: string; actor: string }[];
    expect(items.find((i) => i.item_id === owner.id)?.actor).toBe("owner");
    expect(items.find((i) => i.item_id === first.id)?.actor).toBe("remote");

    // A byte budget too: a large copy is refused once the share's bytes are used up.
    await inAgent((a) => {
      a.services.storage.trashLimits.remote = { items: 100, bytes: 1 };
    });
    expect((await b.call(`/api/notes/${junk.id}`, { method: "DELETE" })).status).toBe(409);
  });

  it("leaves no trashed memory behind when all memories are cleared", async () => {
    const c = await loggedIn();
    const { memory } = await c.json("/api/memories", { method: "POST", body: { content: `Secret to forget ${crypto.randomUUID()}` } });
    await c.call(`/api/memories/${memory.id}`, { method: "DELETE" });
    expect((await c.json("/api/trash")).items.some((i: { item_id: string }) => i.item_id === memory.id)).toBe(true);
    await c.call("/api/memories", { method: "DELETE", body: { confirm: "DELETE" } });
    expect((await c.json("/api/trash")).items.some((i: { kind: string }) => i.kind === "memory")).toBe(false);
  });

  it("won't restore a memory that would duplicate a current one", async () => {
    const c = await loggedIn();
    const content = `Likes green tea ${crypto.randomUUID()}`;
    const { memory } = await c.json("/api/memories", { method: "POST", body: { content } });
    await c.call(`/api/memories/${memory.id}`, { method: "DELETE" });
    const again = (await c.json("/api/memories", { method: "POST", body: { content } })).memory;
    const entry = (await c.json("/api/trash")).items.find((i: { item_id: string }) => i.item_id === memory.id);
    expect((await c.call(`/api/trash/${entry.id}/restore`, { method: "POST" })).status).toBe(409);
    await c.call(`/api/memories/${again.id}`, { method: "DELETE" });
  });

  it("is out of reach of access tokens, even a write token", async () => {
    for (const [method, path] of [["GET", "/api/trash"], ["POST", "/api/trash/0f8fad5b-d9cb-469f-a165-70867728950e/restore"], ["DELETE", "/api/trash"], ["GET", "/api/storage"]] as const) {
      expect(isRemoteAllowed(method, path)).toBe(false);
    }
    const token = await inAgent(async (a) => {
      a.services.remote.setEnabled(true);
      return (await a.services.remote.create({ name: "trash", scope: "write" })).token;
    });
    const b = bearer(token);
    expect((await b.call("/api/trash")).status).toBe(403);
    expect((await b.call("/api/storage")).status).toBe(403);
    // A token's delete still lands in the trash, where the owner can undo it.
    const { task } = await b.json("/api/tasks", { method: "POST", body: { title: "Made by a script" } });
    expect((await b.call(`/api/tasks/${task.id}`, { method: "DELETE" })).status).toBe(200);
    const c = await loggedIn();
    expect((await c.json("/api/trash")).items.some((i: { item_id: string }) => i.item_id === task.id)).toBe(true);
  });
});

describe("storage limits", () => {
  it("keeps its counters in step with the tables through every kind of write", async () => {
    const c = await loggedIn();
    const conv = (await c.json("/api/conversations", { method: "POST", body: {} })).conversation;
    await inAgent((a) => {
      const s = a.services;
      s.conversations.addMessage({ conversation_id: conv.id, role: "user", content: "hi" });
      s.conversations.addMessage({ conversation_id: conv.id, role: "assistant", content: "hello" });
      const t = s.tasks.create({ title: "Counted task" });
      s.tasks.delete(t.id);
      s.notes.create({ title: "Counted note" });
      s.memories.create({ content: `Counted memory ${crypto.randomUUID()}` });
    });
    await c.call(`/api/conversations/${conv.id}`, { method: "DELETE" });
    const tables = { memories: "tal_memories", tasks: "tal_tasks", notes: "tal_notes", projects: "tal_projects", conversations: "tal_conversations", messages: "tal_messages", automations: "tal_automations", trash: "tal_trash" };
    const [counted, real] = await inAgent((a) => {
      const s = a.services;
      const kinds = Object.keys(tables) as (keyof typeof tables)[];
      return [
        Object.fromEntries(kinds.map((k) => [k, s.storage.count(k)])),
        Object.fromEntries(kinds.map((k) => [k, s.db.one<{ n: number }>(`SELECT count(*) AS n FROM ${tables[k]}`)!.n])),
      ];
    });
    expect(counted).toEqual(real);
    const buckets = await inAgent((a) => {
      const s = a.services;
      return (["owner", "remote", "system"] as const).map((actor) => {
        const row = s.db.one<{ n: number; b: number | null }>(`SELECT count(*) AS n, sum(bytes) AS b FROM tal_trash WHERE actor = ?`, actor)!;
        return [s.storage.count(`trash_${actor}`), s.storage.count(`trash_bytes_${actor}`), row.n, row.b ?? 0];
      });
    });
    for (const [n, b, realN, realB] of buckets) expect([n, b]).toEqual([realN, realB]);
  });

  it("refuses a new task, note or memory at the limit with a clear error, and deletes nothing", async () => {
    const c = await loggedIn();
    await fill("tasks");
    await fill("notes");
    await fill("memories");
    const before = await inAgent((a) => a.services.storage.counts());
    for (const [path, body] of [["/api/tasks", { title: "One too many" }], ["/api/notes", { title: "One too many" }], ["/api/memories", { content: `One too many ${crypto.randomUUID()}` }]] as const) {
      const res = await c.call(path, { method: "POST", body });
      expect(res.status).toBe(409);
      const error = ((await res.json()) as { error: { code: string; message: string } }).error;
      expect(error.code).toBe("STORAGE_LIMIT_REACHED");
      expect(error.message).toMatch(/^You reached the limit of \d+ (tasks|notes|memories)\./);
    }
    expect(await inAgent((a) => a.services.storage.counts())).toEqual(before);
  });

  it("refuses a new chat turn at the message limit", async () => {
    const c = await loggedIn();
    await fill("messages", 1);
    const res = await c.call("/api/chat", { method: "POST", body: { message: "hello" } });
    const text = await res.text();
    expect(text).toContain("STORAGE_LIMIT_REACHED");
  });

  it("warns at 80% of a limit", async () => {
    const c = await loggedIn();
    await inAgent((a) => {
      const s = a.services.storage;
      if (s.count("notes") === 0) a.services.notes.create({ title: "Counted" });
      s.limits = { ...s.limits, notes: Math.floor(s.count("notes") / 0.85) || 1 };
    });
    const { storage } = await c.json("/api/storage");
    expect(storage.warnings).toContain("notes");
    expect(storage.kinds.find((k: { kind: string }) => k.kind === "notes")).toMatchObject({ limit: expect.any(Number), count: expect.any(Number) });
    expect(storage.max_bytes).toBeGreaterThan(0);
  });

  it("refuses a restore that would go over the limit", async () => {
    const c = await loggedIn();
    const entryId = await inAgent((a) => {
      const s = a.services;
      const note = s.notes.create({ title: "Comes back later" });
      s.notes.delete(note.id);
      s.storage.limits = { ...s.storage.limits, notes: s.storage.count("notes") };
      return s.storage.listTrash({ kind: "note" })[0]!.id;
    });
    const res = await c.call(`/api/trash/${entryId}/restore`, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await c.json("/api/trash")).items.some((i: { id: string }) => i.id === entryId)).toBe(true);
  });

  it("imports nothing from a backup that would go over a limit", async () => {
    const c = await loggedIn();
    await fill("tasks", 1);
    const stamp = new Date(Date.now() - 60_000).toISOString();
    const tasks = [0, 1].map((n) => ({ id: crypto.randomUUID(), title: `Imported ${n}`, status: "todo", created_at: stamp, updated_at: stamp }));
    const note = { id: crypto.randomUUID(), title: "Imported note", content: "", created_at: stamp, updated_at: stamp };
    const res = await c.call("/api/import", {
      method: "POST",
      body: { format: BACKUP_FORMAT, version: 1, exported_at: stamp, data: { tasks, notes: [note] } },
    });
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect([res.status, body.error.code]).toEqual([409, "STORAGE_LIMIT_REACHED"]);
    expect(await inAgent((a) => [a.services.tasks.get(tasks[0]!.id), a.services.notes.get(note.id)])).toEqual([null, null]);
  });
});

describe("memories sent with an access token", () => {
  it("embed for the history check only within half the daily cap", async () => {
    await inAgent(async (a) => {
      const s = a.services;
      dropSemanticData(s.db);
      deleteSemanticConfig(s.settings);
      s.memories.clear();
      writeSemanticConfig(s.settings, { enabled: true, maxEmbeddingsPerDay: 4 }, s.db);
      invalidateSemanticCache(s);
      try {
        const day = UsageService.day();
        recordEmbeddings(s.db, day, 2, 0);
        const remote = s.memories.create({ content: "Prefers aisle seats", source: "remote" });
        const opts = { minCosine: -1, limit: 5, exclude: new Set<string>() };
        expect(await semanticNeighbors(s, env as unknown as Env, remote, opts)).toEqual([]);
        expect(embeddingsToday(s.db, day)).toBe(2);
        // Saved anyway, waiting for the background index.
        expect(s.memories.get(remote.id)?.content).toBe("Prefers aisle seats");
        // An owner's memory edited with a token counts as the token's.
        const owner = s.memories.create({ content: "Prefers window seats", source: "manual" });
        expect(await semanticNeighbors(s, env as unknown as Env, owner, { ...opts, remote: true })).toEqual([]);
        expect(embeddingsToday(s.db, day)).toBe(2);
        await semanticNeighbors(s, env as unknown as Env, owner, opts);
        expect(embeddingsToday(s.db, day)).toBe(3);
      } finally {
        dropSemanticData(s.db);
        deleteSemanticConfig(s.settings);
        invalidateSemanticCache(s);
        s.memories.clear();
      }
    });
  });
});
