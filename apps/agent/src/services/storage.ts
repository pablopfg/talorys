import {
  ARCHIVE_RETENTION_DAYS,
  STORAGE_KINDS,
  STORAGE_LIMITS,
  STORAGE_MAX_BYTES,
  STORAGE_WARN_RATIO,
  type StorageKind,
  type StorageUsage,
  type TrashActor,
  TRASH_LIMITS,
  TRASH_RETENTION_DAYS,
  type TrashItem,
  type TrashKind,
  type TrashReason,
} from "@talorys/shared";
import { type Database, newId, now, type Row } from "../db/database";
import { AppError, NotFoundError } from "../api/errors";

/** Where a trashed row goes back to, and the only columns a restore writes (never taken from the payload's keys). */
const RESTORE: Record<TrashKind, { kind: StorageKind; table: string; columns: readonly string[] }> = {
  memory: {
    kind: "memories",
    table: "tal_memories",
    columns: ["id", "content", "category", "source", "status", "superseded_by", "valid_from", "valid_until", "created_at", "updated_at"],
  },
  task: {
    kind: "tasks",
    table: "tal_tasks",
    columns: ["id", "title", "description", "status", "priority", "due_at", "project_id", "created_at", "updated_at", "completed_at"],
  },
  note: { kind: "notes", table: "tal_notes", columns: ["id", "title", "content", "project_id", "created_at", "updated_at"] },
};

const DAY_MS = 86_400_000;

/** Columns that are NOT NULL in every restorable table. */
const REQUIRED = new Set(["id", "content", "category", "source", "status", "title", "description", "priority", "created_at", "updated_at"]);

function limitError(kind: StorageKind, limit: number): AppError {
  switch (kind) {
    case "memories":
      return new AppError("STORAGE_LIMIT_REACHED", `You reached the limit of ${limit} memories. Delete the ones you no longer need to save new ones.`);
    case "tasks":
      return new AppError("STORAGE_LIMIT_REACHED", `You reached the limit of ${limit} tasks. Delete finished tasks you no longer need to add new ones.`);
    case "notes":
      return new AppError("STORAGE_LIMIT_REACHED", `You reached the limit of ${limit} notes. Delete notes you no longer need to add new ones.`);
    case "projects":
      return new AppError("STORAGE_LIMIT_REACHED", `You reached the limit of ${limit} projects. Delete projects you no longer need to add new ones.`);
    case "conversations":
      return new AppError("STORAGE_LIMIT_REACHED", `You reached the limit of ${limit} conversations. Delete old conversations to start new ones.`);
    case "messages":
      return new AppError("STORAGE_LIMIT_REACHED", `You reached the limit of ${limit} chat messages. Delete old conversations to keep chatting.`);
    case "automations":
      return new AppError("STORAGE_LIMIT_REACHED", `You reached the limit of ${limit} automations. Delete automations you no longer need to add new ones.`);
  }
}

/**
 * Storage limits and the trash. Limits only ever refuse new records: nothing is deleted to make
 * room. Deleted tasks, notes and memories wait in the trash (archived ones in the archive) until
 * they expire, so a mistaken or hostile delete can be undone.
 */
export class StorageService {
  /** Replaceable in tests. */
  limits: Record<StorageKind, number> = { ...STORAGE_LIMITS };
  maxBytes = STORAGE_MAX_BYTES;
  trashLimits: Record<TrashActor, { items: number; bytes: number }> = structuredClone(TRASH_LIMITS);

  constructor(private readonly db: Database) {}

  /** Rows of `kind`, from the counter triggers keep (migration 29): one row read, not a table scan. */
  count(kind: StorageKind | "trash" | `trash_${TrashActor}` | `trash_bytes_${TrashActor}`): number {
    return this.db.one<{ n: number }>(`SELECT n FROM tal_counts WHERE kind = ?`, kind)?.n ?? 0;
  }

  /** Throws STORAGE_LIMIT_REACHED unless `adding` more records of `kind` fit. */
  assertRoom(kind: StorageKind, adding = 1): void {
    const limit = this.limits[kind];
    if (this.count(kind) + adding > limit) throw limitError(kind, limit);
    const bytes = this.db.size();
    if (bytes !== null && bytes >= this.maxBytes) {
      // The Durable Object's file shrinks as rows are deleted, so freeing space lifts this.
      throw new AppError("STORAGE_LIMIT_REACHED", "Axis storage is full. Empty the trash or delete old conversations, notes or memories to add more.");
    }
  }

  /** Record counts per kind, to compare against after a bulk write. */
  counts(): Record<StorageKind, number> {
    return Object.fromEntries(STORAGE_KINDS.map((kind) => [kind, this.count(kind)])) as Record<StorageKind, number>;
  }

  /**
   * Throws when a bulk write (an import, inside its transaction, so the throw rolls it back) took a
   * kind over its limit. A kind that was already over and did not grow is left alone.
   */
  assertGrewWithinLimits(before: Record<StorageKind, number>): void {
    for (const kind of STORAGE_KINDS) {
      const count = this.count(kind);
      if (count > this.limits[kind] && count > before[kind]) throw limitError(kind, this.limits[kind]);
    }
  }

  usage(): StorageUsage {
    const kinds = STORAGE_KINDS.map((kind) => ({ kind, count: this.count(kind), limit: this.limits[kind] }));
    const bytes = this.db.size();
    const warnings: StorageUsage["warnings"] = kinds.filter((k) => k.count >= k.limit * STORAGE_WARN_RATIO).map((k) => k.kind);
    if (bytes !== null && bytes >= this.maxBytes * STORAGE_WARN_RATIO) warnings.push("bytes");
    this.purgeExpired();
    return { kinds, bytes, max_bytes: this.maxBytes, warnings, trash: { items: this.trashCount() } };
  }

  // ---------- Trash ----------

  /**
   * Keeps a copy of `row` for later restore. Call it in the same transaction as the delete, so a
   * refusal here also cancels the delete. Archived items stay ARCHIVE_RETENTION_DAYS, everything
   * else TRASH_RETENTION_DAYS. Archiving and compaction always count as `system`.
   *
   * Each actor has its own room (TRASH_LIMITS). Past the owner's, the owner's oldest entries go
   * first. An access token, or Axis itself, is refused instead: a leaked token can never push
   * what it deleted (or the owner's own deletes) out of the trash, nor fill the database through it.
   */
  keep(kind: TrashKind, row: object, title: string, opts: { reason?: TrashReason; actor?: TrashActor } = {}): TrashItem {
    const reason = opts.reason ?? "deleted";
    const actor: TrashActor = reason === "deleted" ? (opts.actor ?? "owner") : "system";
    const ts = now();
    const days = reason === "archived" ? ARCHIVE_RETENTION_DAYS : TRASH_RETENTION_DAYS;
    const payload = JSON.stringify(row);
    const bytes = new TextEncoder().encode(payload).length;
    const item: TrashItem = {
      id: newId(),
      kind,
      item_id: String((row as { id: unknown }).id),
      title: title.replace(/\s+/g, " ").trim().slice(0, 120),
      reason,
      actor,
      deleted_at: ts,
      expires_at: new Date(Date.parse(ts) + days * DAY_MS).toISOString(),
    };
    this.purgeExpired();
    const room = this.trashLimits[actor];
    if (actor !== "owner" && (this.count(`trash_${actor}`) + 1 > room.items || this.count(`trash_bytes_${actor}`) + bytes > room.bytes)) {
      throw actor === "remote"
        ? new AppError("STORAGE_LIMIT_REACHED", "The trash has no more room for items deleted with access tokens. Restore or delete them in Settings → Privacy first.")
        : new AppError("STORAGE_LIMIT_REACHED", "The archive is full. Delete archived items in Settings → Privacy first.");
    }
    this.db.run(
      `INSERT INTO tal_trash (id, kind, item_id, title, payload, reason, actor, bytes, deleted_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      item.id, item.kind, item.item_id, item.title, payload, item.reason, item.actor, bytes, item.deleted_at, item.expires_at,
    );
    if (actor === "owner") this.evictOwner();
    return item;
  }

  /** Drops the owner's oldest entries until they fit the owner's room again (the newest always stays). */
  private evictOwner(): void {
    const room = this.trashLimits.owner;
    const over = this.count("trash_owner") - room.items;
    if (over > 0) {
      this.db.run(`DELETE FROM tal_trash WHERE id IN (SELECT id FROM tal_trash WHERE actor = 'owner' ORDER BY deleted_at ASC LIMIT ?)`, over);
    }
    while (this.count("trash_bytes_owner") > room.bytes && this.count("trash_owner") > 1) {
      this.db.run(`DELETE FROM tal_trash WHERE id = (SELECT id FROM tal_trash WHERE actor = 'owner' ORDER BY deleted_at ASC LIMIT 1)`);
    }
  }

  listTrash(opts: { kind?: TrashKind; limit?: number } = {}): TrashItem[] {
    this.purgeExpired();
    const where = opts.kind ? "WHERE kind = ?" : "";
    return this.db.all<TrashItem>(
      `SELECT id, kind, item_id, title, reason, actor, deleted_at, expires_at FROM tal_trash ${where} ORDER BY deleted_at DESC LIMIT ?`,
      ...(opts.kind ? [opts.kind] : []),
      opts.limit ?? 200,
    );
  }

  trashCount(): number {
    return this.count("trash");
  }

  /**
   * Puts an item back as it was. Links to a project or memory that no longer exists are dropped,
   * and the storage limit still applies. Returns the restored kind and id.
   */
  restore(id: string): { kind: TrashKind; item_id: string } {
    const entry = this.db.one<Row & { kind: TrashKind; item_id: string; payload: string }>(`SELECT * FROM tal_trash WHERE id = ?`, id);
    if (!entry) throw new NotFoundError("This item is no longer in the trash.");
    const target = RESTORE[entry.kind];
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(entry.payload) as Record<string, unknown>;
    } catch {
      throw new AppError("CONFLICT", "This item can't be restored.");
    }
    if (payload.id !== entry.item_id) throw new AppError("CONFLICT", "This item can't be restored.");
    if (this.db.one(`SELECT 1 AS x FROM ${target.table} WHERE id = ?`, entry.item_id)) {
      throw new AppError("CONFLICT", "An item with the same id already exists.");
    }
    if (entry.kind === "memory" && typeof payload.content === "string" &&
      this.db.one(`SELECT 1 AS x FROM tal_memories WHERE lower(content) = lower(?) AND status != 'historical'`, payload.content.trim())) {
      throw new AppError("CONFLICT", "Axis already has a current memory with the same text.");
    }
    this.assertRoom(target.kind);
    const values = target.columns.map((c) => {
      const v = payload[c];
      return typeof v === "string" || typeof v === "number" ? v : null;
    });
    // Every stored copy has these; anything else was not written by Axis.
    if (target.columns.some((c, i) => REQUIRED.has(c) && values[i] === null)) throw new AppError("CONFLICT", "This item can't be restored.");
    const at = (column: string) => target.columns.indexOf(column);
    if (at("project_id") >= 0 && values[at("project_id")] && !this.db.one(`SELECT 1 AS x FROM tal_projects WHERE id = ?`, values[at("project_id")])) {
      values[at("project_id")] = null;
    }
    if (at("superseded_by") >= 0 && values[at("superseded_by")] && !this.db.one(`SELECT 1 AS x FROM tal_memories WHERE id = ?`, values[at("superseded_by")])) {
      values[at("superseded_by")] = null;
      // A past fact whose successor is gone is current again.
      if (values[at("status")] === "historical") values[at("status")] = "active";
    }
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO ${target.table} (${target.columns.join(", ")}) VALUES (${target.columns.map(() => "?").join(", ")})`,
        ...values,
      );
      this.db.run(`DELETE FROM tal_trash WHERE id = ?`, id);
    });
    return { kind: entry.kind, item_id: entry.item_id };
  }

  /** Deletes one entry for good. */
  purge(id: string): void {
    if (this.db.run(`DELETE FROM tal_trash WHERE id = ?`, id).changes === 0) throw new NotFoundError("This item is no longer in the trash.");
  }

  /** Drops every trashed copy of a memory (with "clear all memories", which must leave nothing behind). */
  forgetMemories(): void {
    this.db.run(`DELETE FROM tal_trash WHERE kind = 'memory'`);
  }

  /** Empties the trash (and, with `includeArchive`, the archive too). Returns how many entries went. */
  empty(opts: { includeArchive?: boolean } = {}): number {
    const where = opts.includeArchive ? "" : "WHERE reason != 'archived'";
    const n = this.db.one<{ n: number }>(`SELECT count(*) AS n FROM tal_trash ${where}`)?.n ?? 0;
    this.db.run(`DELETE FROM tal_trash ${where}`);
    return n;
  }

  purgeExpired(): number {
    return this.db.run(`DELETE FROM tal_trash WHERE expires_at <= ?`, now()).changes;
  }
}
