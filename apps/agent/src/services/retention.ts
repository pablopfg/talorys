import type { Memory, Task } from "@talorys/shared";
import type { Database } from "../db/database";
import type { MemoryRepository } from "../db/repositories/memories";
import type { NoteRepository } from "../db/repositories/notes";
import type { TaskRepository } from "../db/repositories/tasks";
import type { AlertService } from "../alerts/service";
import { AppError } from "../api/errors";
import type { SettingsService } from "./settings";
import type { StorageService } from "./storage";
import type { ActivityLog } from "./usage";

const DAY_MS = 86_400_000;

/** How often each routine runs, and the ages it looks for. */
export const RETENTION = {
  /** The first run waits this long after the feature arrives, with a notice, so nothing goes unannounced. */
  firstRunAfterDays: 7,
  cleanupEveryDays: 7,
  compactEveryDays: 15,
  /** Done tasks are archived this long after they were completed. */
  archiveTasksAfterDays: 90,
  /** Empty notes go to the trash once untouched this long, so one being written now is never taken. */
  emptyNoteAfterDays: 7,
  /** Notes unchanged this long are named in the report, as a suggestion only. */
  staleNoteAfterDays: 180,
  /** Chat messages this old that the conversation's summary really covers are removed. */
  compactMessagesAfterDays: 180,
  /** Compaction waits for this many memories saved since the last one... */
  compactAfterNewMemories: 50,
  /** ...unless the memories use this share of their limit. */
  compactAtRatio: 0.7,
  /** Cosine at or above which two memories may be the same fact (the wording must agree too). */
  duplicateCosine: 0.95,
  /** Share of words two copies must have in common to count as the same fact. */
  sameWords: 0.8,
  /** Work per run, so one alarm stays short; the rest waits for the next round. */
  batch: { tasks: 500, notes: 200, messages: 5_000, memories: 50, repeatGroups: 200 },
} as const;

interface Cursor {
  created_at: string;
  id: string;
}

export interface RetentionState {
  /** Nothing runs before this (set, with a notice, the first time the cleanup could run). */
  starts_at: string | null;
  last_cleanup: string | null;
  last_compaction: string | null;
  /** While a compaction is under way: when it started, the last memory it checked, what it combined. */
  compaction_started: string | null;
  compaction_cursor: Cursor | null;
  compaction_combined: number;
  /** When it last looked whether a compaction is due (at most once a day), or was stopped for room. */
  last_check: string | null;
  /** The stale-note count last reported, so the same suggestion isn't repeated every week. */
  stale_notes_reported: number;
}

export interface CleanupReport {
  tasks_archived: number;
  notes_trashed: number;
  stale_notes: number;
  messages_removed: number;
}

export interface CompactionReport {
  checked: number;
  combined: number;
  done: boolean;
}

/**
 * For each memory, the ids of memories whose stored vector is at least `minCosine` from its own
 * (no new embedding). Null when semantic recall is off: compaction then compares text only.
 */
export type DuplicateFinder = (memories: Memory[], minCosine: number) => Promise<Map<string, string[]> | null>;

const STATE_KEY = "retention.state";
const NEGATIONS = new Set(["not", "no", "never", "dont", "doesnt", "isnt", "cant", "wont", "nao", "nunca", "nem", "sem", "nenhum", "nenhuma", "jamais"]);

/** Lower-case words without accents or punctuation: "Não gosta de chá." → ["nao", "gosta", "de", "cha"]. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[’']/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Whether two close memories say the same thing, not just something alike: the same numbers, the
 * same negation, and most words in common. "Allergic to penicillin" and "Not allergic to
 * penicillin", or "School starts at 8:00" and "8:30", are never the same fact.
 */
export function sameFact(a: string, b: string): boolean {
  const wa = words(a);
  const wb = words(b);
  const digits = (w: string[]) => w.filter((x) => /\d/.test(x)).sort().join(" ");
  const negated = (w: string[]) => w.some((x) => NEGATIONS.has(x));
  if (digits(wa) !== digits(wb) || negated(wa) !== negated(wb)) return false;
  const sa = new Set(wa);
  const sb = new Set(wb);
  const common = [...sa].filter((x) => sb.has(x)).length;
  const union = new Set([...sa, ...sb]).size;
  return union > 0 && common / union >= RETENTION.sameWords;
}

/**
 * The automatic cleanup (weekly) and memory compaction (every 15 days). Nothing is deleted
 * outright: archived tasks, empty notes and combined memories go to the trash or archive, where
 * the owner can restore them. Only chat messages that the conversation's summary covers without a
 * gap are removed for good. Compaction only ever removes memories the agent saved and nobody
 * edited since; the owner's own, imported and token-sent memories are never removed.
 */
export class RetentionService {
  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly tasks: TaskRepository,
    private readonly notes: NoteRepository,
    private readonly memories: MemoryRepository,
    private readonly alerts: AlertService,
    private readonly activity: ActivityLog,
    /** Removes a combined memory's vector. */
    private readonly forgetVector: (memoryId: string) => void = () => {},
  ) {}

  state(): RetentionState {
    return {
      starts_at: null,
      last_cleanup: null,
      last_compaction: null,
      compaction_started: null,
      compaction_cursor: null,
      compaction_combined: 0,
      last_check: null,
      stale_notes_reported: 0,
      ...(this.settings.getJson<Partial<RetentionState>>(STATE_KEY) ?? {}),
    };
  }

  private save(patch: Partial<RetentionState>): void {
    this.settings.setJson(STATE_KEY, { ...this.state(), ...patch });
  }

  /** Called by the 15-minute watch: runs whatever is due. */
  async runDue(findDuplicates?: DuplicateFinder, at = new Date()): Promise<void> {
    if (!this.settings.get().autoCleanup) return;
    const state = this.state();
    if (!state.starts_at) {
      const starts = new Date(at.getTime() + RETENTION.firstRunAfterDays * DAY_MS).toISOString();
      this.save({ starts_at: starts });
      this.alerts.raise({
        title: "Automatic cleanup",
        body: "Automatic cleanup starts in 7 days: finished tasks older than 90 days go to the archive, empty notes to the trash, and repeated memories saved by the agent are combined. You can turn it off in Settings → Privacy.",
        category: "system",
        priority: "low",
        dedupeKey: "retention-start",
        cooldownMinutes: 7 * 24 * 60,
      });
      return;
    }
    if (at.getTime() < Date.parse(state.starts_at)) return;
    if (!state.last_cleanup || at.getTime() - Date.parse(state.last_cleanup) >= RETENTION.cleanupEveryDays * DAY_MS) {
      this.cleanup(at);
    }
    if (this.compactionDue(this.state(), at)) await this.compact(findDuplicates, at);
  }

  private compactionDue(state: RetentionState, at: Date): boolean {
    // Counting new memories reads the table, so the check runs at most once a day; a run stopped
    // for lack of room waits for the next day too.
    if (state.last_check && at.getTime() - Date.parse(state.last_check) < DAY_MS) return false;
    if (state.compaction_cursor) return true;
    this.save({ last_check: at.toISOString() });
    const since = state.last_compaction;
    if (this.storage.count("memories") >= this.storage.limits.memories * RETENTION.compactAtRatio) return true;
    if (since && at.getTime() - Date.parse(since) < RETENTION.compactEveryDays * DAY_MS) return false;
    const added = this.db.one<{ n: number }>(`SELECT count(*) AS n FROM tal_memories WHERE created_at > ?`, since ?? "")?.n ?? 0;
    return added >= RETENTION.compactAfterNewMemories;
  }

  /** The weekly cleanup. Returns what it did; reports it to the owner when it did anything. */
  cleanup(at = new Date()): CleanupReport {
    const report: CleanupReport = { tasks_archived: 0, notes_trashed: 0, stale_notes: 0, messages_removed: 0 };
    const before = (days: number) => new Date(at.getTime() - days * DAY_MS).toISOString();
    let full = false;
    try {
      // Open tasks are never touched: only work finished long ago moves to the archive.
      const done = this.db.all<Task>(
        `SELECT * FROM tal_tasks WHERE status = 'done' AND completed_at IS NOT NULL AND completed_at < ? ORDER BY completed_at LIMIT ?`,
        before(RETENTION.archiveTasksAfterDays), RETENTION.batch.tasks,
      );
      for (const task of done) {
        if (!this.keepGoing(() => this.tasks.delete(task.id, { reason: "archived" }))) {
          full = true;
          break;
        }
        report.tasks_archived++;
      }

      // A note with neither text nor a title of its own is an accident, never content.
      const empty = this.db.all<{ id: string }>(
        `SELECT id FROM tal_notes WHERE trim(content) = '' AND (trim(title) = '' OR title IN ('Untitled', 'Sem título', '제목 없음')) AND updated_at < ? LIMIT ?`,
        before(RETENTION.emptyNoteAfterDays), RETENTION.batch.notes,
      );
      for (const note of empty) {
        if (full || !this.keepGoing(() => this.notes.delete(note.id, { actor: "system" }))) {
          full = true;
          break;
        }
        report.notes_trashed++;
      }
      report.stale_notes = this.db.one<{ n: number }>(`SELECT count(*) AS n FROM tal_notes WHERE updated_at < ?`, before(RETENTION.staleNoteAfterDays))?.n ?? 0;

      // Old turns the summary holds without a gap (summary_from..summary_upto); never imported ones,
      // and never a conversation whose coverage isn't known.
      report.messages_removed = this.db.all(
        `DELETE FROM tal_messages WHERE id IN (
           SELECT m.id FROM tal_messages m JOIN tal_conversations c ON c.id = m.conversation_id
           WHERE c.summary IS NOT NULL AND c.summary_from IS NOT NULL AND c.summary_upto IS NOT NULL
             AND m.created_at >= c.summary_from AND m.created_at <= c.summary_upto AND m.created_at < ? AND m.source != 'import'
           LIMIT ?) RETURNING id`,
        before(RETENTION.compactMessagesAfterDays), RETENTION.batch.messages,
      ).length;
    } finally {
      this.save({ last_cleanup: at.toISOString() });
    }

    const parts = [
      report.tasks_archived ? `${report.tasks_archived} finished task(s) archived` : "",
      report.notes_trashed ? `${report.notes_trashed} empty note(s) moved to the trash` : "",
      report.messages_removed ? `${report.messages_removed} old chat message(s) compacted into their summaries` : "",
    ].filter(Boolean);
    if (parts.length) this.activity.record("retention.cleanup", `Weekly cleanup: ${parts.join("; ")}`);
    // The stale-note suggestion only when there are more such notes than last reported.
    const staleNews = report.stale_notes > this.state().stale_notes_reported;
    this.save({ stale_notes_reported: report.stale_notes });
    if (parts.length || staleNews) {
      this.alerts.raise({
        title: "Weekly cleanup",
        body: [
          ...parts,
          staleNews ? `${report.stale_notes} note(s) unchanged for 6 months: consider deleting the ones you no longer need` : "",
          parts.length ? "Archived and deleted items can be restored in Settings → Privacy" : "",
        ].filter(Boolean).join("\n"),
        category: "system",
        priority: "low",
        dedupeKey: "retention-cleanup",
        cooldownMinutes: 24 * 60,
      });
    }
    if (full) this.archiveFull();
    return report;
  }

  /**
   * One round of compaction. The first round combines exact repeats (same text, ignoring case).
   * Then each round checks up to RETENTION.batch.memories memories saved since the last compaction,
   * newest first, against close copies found by their stored vectors whose wording says the same
   * thing (sameFact). Later rounds continue until every new memory is checked; the owner gets one
   * report at the end.
   */
  async compact(findDuplicates?: DuplicateFinder, at = new Date()): Promise<CompactionReport> {
    const state = this.state();
    const started = state.compaction_started ?? at.toISOString();
    const report: CompactionReport = { checked: 0, combined: 0, done: false };
    let room = true;

    if (!state.compaction_cursor) {
      // Same text (ignoring case) and category, with at least one agent-made copy.
      const groups = this.db.all<{ k: string; category: string }>(
        `SELECT lower(content) AS k, category FROM tal_memories WHERE status = 'active' AND source = 'agent' GROUP BY k, category
         HAVING count(*) > 1 OR k || char(0) || category IN (
           SELECT lower(content) || char(0) || category FROM tal_memories WHERE status = 'active' AND source != 'agent')
         LIMIT ?`,
        RETENTION.batch.repeatGroups,
      );
      for (const { k, category } of groups) {
        const copies = this.db.all<Memory>(
          `SELECT * FROM tal_memories WHERE status = 'active' AND lower(content) = ? AND category = ? ORDER BY created_at DESC, id DESC`,
          k, category,
        );
        const kept = copies.find((m) => m.source !== "remote");
        if (!kept) continue;
        for (const other of copies) {
          if (other.id === kept.id || !this.removable(other, kept)) continue;
          if (!(room = this.combine(other, report))) break;
        }
        if (!room) break;
      }
    }

    let batch: Memory[] = [];
    if (room && findDuplicates) {
      const cursor = state.compaction_cursor ?? { created_at: "9999", id: "" };
      batch = this.db.all<Memory>(
        `SELECT * FROM tal_memories WHERE status = 'active' AND source != 'remote' AND created_at > ?
           AND (created_at < ? OR (created_at = ? AND id < ?))
         ORDER BY created_at DESC, id DESC LIMIT ?`,
        state.last_compaction ?? "", cursor.created_at, cursor.created_at, cursor.id, RETENTION.batch.memories,
      );
      const found = batch.length ? await findDuplicates(batch, RETENTION.duplicateCosine) : null;
      if (!found) batch = [];
      for (const snapshot of batch) {
        report.checked++;
        // Re-read after the wait: the owner or the agent may have changed it meanwhile.
        const kept = this.memories.get(snapshot.id);
        if (kept?.updated_at !== snapshot.updated_at || kept.status !== "active" || this.inReview(kept.id)) continue;
        for (const id of found?.get(kept.id) ?? []) {
          const other = this.memories.get(id);
          if (!other || !this.removable(other, kept) || !sameFact(other.content, kept.content)) continue;
          if (!(room = this.combine(other, report))) break;
        }
        if (!room) break;
      }
    }

    const combined = state.compaction_combined + report.combined;
    if (!room) {
      // Stopped for lack of room: keep the place, try again tomorrow, and say why.
      this.save({ compaction_started: started, compaction_combined: combined, last_check: at.toISOString() });
      this.archiveFull();
      return report;
    }
    const last = batch.at(-1);
    report.done = batch.length < RETENTION.batch.memories || !last;
    if (!report.done && last) {
      this.save({ compaction_started: started, compaction_cursor: { created_at: last.created_at, id: last.id }, compaction_combined: combined });
      return report;
    }
    // Memories saved while it ran are newer than `started`, so the next compaction checks them.
    this.save({ compaction_started: null, compaction_cursor: null, compaction_combined: 0, last_compaction: started });
    if (combined) {
      this.activity.record("retention.compaction", `Memory compaction: combined ${combined} repeated memory(ies)`);
      this.alerts.raise({
        title: "Memories combined",
        body: `Talorys combined ${combined} repeated memory(ies), keeping the newest of each. The older copies stay in the trash for 30 days (Settings → Privacy).`,
        category: "system",
        priority: "low",
        dedupeKey: "retention-compaction",
        cooldownMinutes: 24 * 60,
      });
    }
    return report;
  }

  /**
   * Whether `other` may be combined into `kept`: an older, current memory the agent saved and nobody
   * changed since, with the same category and dates, not in a review, not the successor of a past
   * fact (that link would be lost), kept by a copy that wasn't sent with an access token.
   */
  private removable(other: Memory, kept: Memory): boolean {
    if (other.source !== "agent" || other.status !== "active" || other.updated_at !== other.created_at) return false;
    if (kept.source === "remote" || kept.status !== "active" || other.created_at > kept.created_at) return false;
    if (other.category !== kept.category) return false;
    if ((other.valid_from && other.valid_from !== kept.valid_from) || (other.valid_until && other.valid_until !== kept.valid_until)) return false;
    if (this.inReview(other.id)) return false;
    return !this.db.one(`SELECT 1 AS x FROM tal_memories WHERE superseded_by = ? LIMIT 1`, other.id);
  }

  private inReview(id: string): boolean {
    return !!this.db.one(`SELECT 1 AS x FROM tal_memory_reviews WHERE memory_id = ? OR other_id = ? LIMIT 1`, id, id);
  }

  /** Moves one copy to the trash, with its vector and the activity line that quoted it. False when the archive is full. */
  private combine(other: Memory, report: CompactionReport): boolean {
    if (!this.keepGoing(() => this.memories.delete(other.id, { keep: "compacted" }))) return false;
    this.forgetVector(other.id);
    this.db.run(`DELETE FROM tal_activity WHERE type = 'memory.created' AND summary = ?`, `Agent remembered: ${other.content}`.slice(0, 500));
    report.combined++;
    return true;
  }

  private archiveFull(): void {
    this.alerts.raise({
      title: "Automatic cleanup paused",
      body: "The archive is full. Delete archived items in Settings → Privacy so the cleanup can continue.",
      category: "system",
      priority: "normal",
      dedupeKey: "retention-full",
      cooldownMinutes: 7 * 24 * 60,
    });
  }

  /** Runs one move to the trash or archive; false when there is no more room, which ends the run. */
  private keepGoing(move: () => void): boolean {
    try {
      move();
      return true;
    } catch (error) {
      if (error instanceof AppError && error.code === "STORAGE_LIMIT_REACHED") return false;
      throw error;
    }
  }
}
