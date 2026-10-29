/**
 * Storage limits and the trash. The limits are a safety net that keeps one owner's database
 * well inside the Cloudflare free plan (5 GB of Durable Object storage per account): a leaked
 * write token or repeated imports can fill a kind up to its limit, never the whole account.
 */

/** Most records of each kind. Creating one more is refused; nothing is ever deleted to make room. */
export const STORAGE_LIMITS = {
  memories: 10_000,
  tasks: 20_000,
  notes: 5_000,
  projects: 1_000,
  conversations: 5_000,
  messages: 200_000,
  automations: 500,
} as const;

export type StorageKind = keyof typeof STORAGE_LIMITS;
export const STORAGE_KINDS = Object.keys(STORAGE_LIMITS) as StorageKind[];

/** Largest database the app writes to (4 GiB), whatever the per-kind counts. */
export const STORAGE_MAX_BYTES = 4 * 1024 ** 3;

/** Share of a limit at which Settings warns. */
export const STORAGE_WARN_RATIO = 0.8;

/** Days a deleted item stays in the trash, and an archived one in the archive, before it is purged. */
export const TRASH_RETENTION_DAYS = 30;
export const ARCHIVE_RETENTION_DAYS = 365;

/**
 * Who sent an item to the trash: the owner (or an agent action the owner approved), an access
 * token, or Axis itself (archiving and compaction).
 */
export type TrashActor = "owner" | "remote" | "system";

/**
 * Room in the trash for each actor, in entries and in bytes of the stored copies. Past the owner's
 * room, the owner's oldest entries go first. An access token is refused instead, so a leaked token
 * can never push the owner's deleted items out of the trash, nor fill the database through it.
 */
export const TRASH_LIMITS: Record<TrashActor, { items: number; bytes: number }> = {
  owner: { items: 10_000, bytes: 256 * 1024 ** 2 },
  remote: { items: 2_000, bytes: 64 * 1024 ** 2 },
  // A year of archived tasks (up to 500 a week) plus combined memories.
  system: { items: 50_000, bytes: 256 * 1024 ** 2 },
};

export type TrashKind = "memory" | "task" | "note";
/** deleted: by the owner or an approved agent action; archived: by cleanup; compacted: merged into a newer memory. */
export type TrashReason = "deleted" | "archived" | "compacted";

export interface TrashItem {
  id: string;
  kind: TrashKind;
  item_id: string;
  /** A short label: the task or note title, or the start of the memory. */
  title: string;
  reason: TrashReason;
  actor: TrashActor;
  deleted_at: string;
  expires_at: string;
}

export interface StorageKindUsage {
  kind: StorageKind;
  count: number;
  limit: number;
}

export interface StorageUsage {
  kinds: StorageKindUsage[];
  /** Database size in bytes, or null where the runtime does not report it. */
  bytes: number | null;
  max_bytes: number;
  /** Kinds (and "bytes") at or above STORAGE_WARN_RATIO of their limit. */
  warnings: (StorageKind | "bytes")[];
  trash: { items: number };
}
