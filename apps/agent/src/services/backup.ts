import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type Backup,
  MEMORY_CATEGORIES,
  MEMORY_STATUSES,
  TALORYS_VERSION,
  backupSchema,
  languagePreferenceSchema,
  MAX_MCP_SERVERS,
  MCP_AUTH_TYPES,
  scheduleSpecSchema,
} from "@talorys/shared";
import type { Services } from "./container";
import { raiseSecurityAlert } from "../alerts/security";
import { ValidationError } from "../api/errors";
import { decodeTools } from "../db/repositories/conversations";
import { validateEndpoint } from "../mcp/url";
import { REMOTE_ID_PATTERN } from "../remote/allowlist";
import { clip } from "./text";

/**
 * Settings a backup may never change: they control cost, model behaviour (the agent's name and
 * instructions go into every prompt) and how long a session lasts, and a backup file is untrusted input. The owner changes them in Settings instead.
 */
export const IMPORT_IGNORED_SETTINGS = ["model", "aiProvider", "aiFallback", "anthropicModel", "openaiModel", "limits", "demoMode", "autoMemory", "customInstructions", "agentName", "memoryHistory", "session"] as const;

/** Builds a portable backup. Sessions, login attempts and credentials are never exported. */
export function exportData(s: Services): Backup {
  const db = s.db;
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    app_version: TALORYS_VERSION,
    data: {
      settings: s.settings.get(),
      conversations: db.all(`SELECT id, title, summary, summary_upto, created_at, updated_at FROM tal_conversations ORDER BY created_at`),
      messages: db.all(`SELECT id, conversation_id, role, content, tools, status, error, created_at FROM tal_messages ORDER BY created_at`),
      // Lifecycle fields travel with each memory; embeddings are derived data and are rebuilt after import.
      memories: db.all(
        `SELECT id, content, category, source, status, superseded_by, valid_from, valid_until, created_at, updated_at FROM tal_memories ORDER BY created_at`,
      ),
      tasks: db.all(`SELECT * FROM tal_tasks ORDER BY created_at`),
      notes: db.all(`SELECT * FROM tal_notes ORDER BY created_at`),
      projects: db.all(`SELECT * FROM tal_projects ORDER BY created_at`),
      automations: db
        .all<Record<string, unknown>>(`SELECT id, name, kind, message, schedule, enabled, priority, sentinel, calendar_gate, created_at, updated_at FROM tal_automations`)
        .map((a) => ({ ...a, schedule: JSON.parse(String(a.schedule)), enabled: a.enabled === 1, sentinel: a.sentinel === 1 })),
      // Where each server is and how it authenticates; never the credential, a session or tool choices.
      mcp_servers: db.all(`SELECT id, name, url, auth_type, created_at FROM tal_mcp_servers ORDER BY created_at`),
    },
  } as unknown as Backup;
}

export interface ImportSummary {
  conversations: number;
  messages: number;
  memories: number;
  tasks: number;
  notes: number;
  projects: number;
  automations: number;
  /** Imported automations always arrive paused; the owner enables them. */
  automations_paused: number;
  /** Imported MCP servers arrive disabled, without credentials or enabled tools. */
  mcp_servers: number;
  ignored_settings: string[];
}

/** Largest backup file the import route reads. */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/** Most records of each kind one import may carry; a real backup stays far below these. */
export const MAX_IMPORT_RECORDS = {
  conversations: 5_000,
  messages: 50_000,
  memories: 5_000,
  tasks: 20_000,
  notes: 10_000,
  projects: 1_000,
  automations: 500,
  mcp_servers: 50,
} as const;

/** How far ahead of this Worker's clock a backup timestamp may be, for clock drift between devices. */
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

/**
 * A backup timestamp, normalized, or null when it can't be trusted: unreadable, or further in the
 * future than clock drift explains. A forged future date would otherwise win every "newer copy wins"
 * comparison against later local edits.
 */
function trustedStamp(v: unknown, now: string): string | null {
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  if (Number.isNaN(ms) || ms > Date.parse(now) + MAX_CLOCK_SKEW_MS) return null;
  return new Date(ms).toISOString();
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** A full ISO date-time with a zone, as the API stores due dates; anything else is dropped. */
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
function dueDate(v: unknown): string | null {
  if (typeof v !== "string" || !ISO_DATE_TIME.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Longest memory, as the API accepts it. */
const MAX_MEMORY_CHARS = 2_000;
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

/**
 * Merges a backup into the current data inside one transaction. Records are
 * upserted by id, so importing the same backup twice is harmless, nothing
 * that exists only locally is deleted, and a record edited after the backup was
 * made keeps the newer local version. A backup is untrusted input: new automations
 * arrive paused, existing automations and the settings in IMPORT_IGNORED_SETTINGS are
 * never changed, and imported messages can never be retried as owner input.
 */
export async function importData(s: Services, raw: unknown): Promise<ImportSummary> {
  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const backup = parsed.data;
  if (backup.version > BACKUP_VERSION) {
    throw new ValidationError(`This backup was made by a newer Talorys (format v${backup.version}). Update Talorys first.`);
  }
  const previousTimezone = s.settings.get().timezone;
  const d = backup.data;
  for (const [kind, max] of Object.entries(MAX_IMPORT_RECORDS) as [keyof typeof MAX_IMPORT_RECORDS, number][]) {
    if (d[kind].length > max) throw new ValidationError(`This backup is too large to import (${kind}: more than ${max}).`);
  }
  const db = s.db;
  const now = new Date().toISOString();
  /** Stored dates: an untrusted one becomes the import time. */
  const at = (v: unknown) => trustedStamp(v, now) ?? now;
  /** 1 when an `updated_at` can take part in "newer copy wins"; an untrusted one never replaces a local record. */
  const newer = (v: unknown) => (trustedStamp(v, now) ? 1 : 0);

  let paused = 0; // existing automations this backup paused
  const summary = db.transaction((): ImportSummary => {
    for (const p of d.projects) {
      db.run(
        `INSERT INTO tal_projects (id, name, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, status = excluded.status, updated_at = excluded.updated_at
         WHERE excluded.updated_at > tal_projects.updated_at AND ? = 1`,
        p.id, p.name, str(p.description), pick(p.status, ["active", "paused", "completed", "archived"], "active"), at(p.created_at), at(p.updated_at), newer(p.updated_at),
      );
    }
    const projectExists = (id: unknown) => typeof id === "string" && !!db.one(`SELECT 1 AS x FROM tal_projects WHERE id = ?`, id);
    /**
     * Conversations imported messages may join: ones this import creates, or ones that hold only
     * imported messages. A backup can never add turns to a chat the owner had here.
     */
    const importedOnly = (id: string) =>
      !!db.one(`SELECT 1 AS x FROM tal_messages WHERE conversation_id = ? LIMIT 1`, id) &&
      !db.one(`SELECT 1 AS x FROM tal_messages WHERE conversation_id = ? AND source IS NOT 'import' LIMIT 1`, id);
    const importable = new Set<string>();
    for (const c of d.conversations) {
      const exists = !!db.one(`SELECT 1 AS x FROM tal_conversations WHERE id = ?`, c.id);
      if (exists && !importedOnly(c.id)) continue;
      // Summaries go into the system prompt but are invisible in the UI, so imported ones are
      // dropped and regenerated from the (visible) messages when needed.
      db.run(
        `INSERT INTO tal_conversations (id, title, summary, summary_upto, created_at, updated_at) VALUES (?, ?, NULL, NULL, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at
         WHERE excluded.updated_at > tal_conversations.updated_at AND ? = 1`,
        c.id, c.title, at(c.created_at), at(c.updated_at), newer(c.updated_at),
      );
      importable.add(c.id);
    }
    let messages = 0;
    for (const m of d.messages) {
      if (!importable.has(m.conversation_id)) continue;
      db.run(
        `INSERT INTO tal_messages (id, conversation_id, role, content, tools, status, error, created_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'import') ON CONFLICT(id) DO NOTHING`,
        // Approvals and task plans refer to drafts in the exporting instance; an imported one could only mislead.
        m.id, m.conversation_id, m.role, m.content, JSON.stringify(decodeTools(m.tools).map(({ approval: _a, plan: _p, ...t }) => t)),
        pick(m.status, ["complete", "error", "cancelled"], "complete"), strOrNull(m.error), at(m.created_at),
      );
      messages++;
    }
    const statedDate = (v: unknown) => (typeof v === "string" && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(v) ? v : null);
    const importedLinks: { id: string; superseded_by: string }[] = [];
    for (const m of d.memories) {
      const existing = db.one<{ content: string; updated_at: string }>(`SELECT content, updated_at FROM tal_memories WHERE id = ?`, m.id);
      const updatedAt = at(m.updated_at);
      // Never overwrite a newer local edit with an older (or untrustworthy) backup copy.
      if (existing && (!newer(m.updated_at) || existing.updated_at >= updatedAt)) continue;
      const content = clip(m.content.trim(), MAX_MEMORY_CHARS);
      if (!content) continue;
      // Older backups (before Smart Memory) have no lifecycle fields: those memories stay current.
      const status = pick(m.status, MEMORY_STATUSES, "active");
      db.run(
        `INSERT INTO tal_memories (id, content, category, source, status, superseded_by, valid_from, valid_until, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET content = excluded.content, category = excluded.category, status = excluded.status,
           valid_from = excluded.valid_from, valid_until = excluded.valid_until, updated_at = excluded.updated_at`,
        m.id, content, pick(m.category, MEMORY_CATEGORIES, "other"), "import", status,
        statedDate(m.valid_from), statedDate(m.valid_until), at(m.created_at), updatedAt,
      );
      if (typeof m.superseded_by === "string" && m.superseded_by) importedLinks.push({ id: m.id, superseded_by: m.superseded_by });
    }
    // Relationships are restored only when they point at an existing memory and don't form a cycle.
    for (const link of importedLinks) {
      if (!db.one(`SELECT 1 AS x FROM tal_memories WHERE id = ?`, link.superseded_by)) continue;
      if (s.memoryHistory.lifecycle.wouldCycle(link.id, link.superseded_by)) continue;
      db.run(`UPDATE tal_memories SET superseded_by = ? WHERE id = ?`, link.superseded_by, link.id);
    }
    for (const t of d.tasks) {
      db.run(
        `INSERT INTO tal_tasks (id, title, description, status, priority, due_at, project_id, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description, status = excluded.status,
           priority = excluded.priority, due_at = excluded.due_at, project_id = excluded.project_id, updated_at = excluded.updated_at,
           completed_at = excluded.completed_at
         WHERE excluded.updated_at > tal_tasks.updated_at AND ? = 1`,
        t.id, t.title, str(t.description), pick(t.status, ["todo", "in_progress", "done"], "todo"),
        pick(t.priority, ["low", "medium", "high", "urgent"], "medium"), dueDate(t.due_at),
        projectExists(t.project_id) ? t.project_id : null, at(t.created_at), at(t.updated_at), t.completed_at ? at(t.completed_at) : null, newer(t.updated_at),
      );
    }
    for (const n of d.notes) {
      db.run(
        `INSERT INTO tal_notes (id, title, content, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, content = excluded.content, project_id = excluded.project_id, updated_at = excluded.updated_at
         WHERE excluded.updated_at > tal_notes.updated_at AND ? = 1`,
        n.id, n.title, n.content, projectExists(n.project_id) ? n.project_id : null, at(n.created_at), at(n.updated_at), newer(n.updated_at),
      );
    }
    let automations = 0;
    for (const a of d.automations) {
      const schedule = scheduleSpecSchema.safeParse(a.schedule);
      if (!schedule.success) continue;
      const kind = pick(a.kind, ["reminder", "task_digest", "agent_prompt"], "reminder");
      // An imported AI prompt must not start running on its own, and an existing automation keeps the
      // owner's version. The one change a backup may make to it is the safe one: pausing it.
      if (db.one(`SELECT 1 AS x FROM tal_automations WHERE id = ?`, a.id)) {
        if (a.enabled === false) {
          paused += db.run(`UPDATE tal_automations SET enabled = 0, status = 'paused', updated_at = ? WHERE id = ? AND enabled = 1`, now, a.id).changes > 0 ? 1 : 0;
        }
        continue;
      }
      db.run(
        // A calendar condition is kept as written: until that calendar is open again, runs are skipped with an alert.
        `INSERT INTO tal_automations (id, name, kind, message, schedule, enabled, priority, sentinel, calendar_gate, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'paused', ?, ?)`,
        a.id, a.name, kind, str(a.message), JSON.stringify(schedule.data),
        pick(a.priority, ["low", "normal", "high"], "normal"), kind === "agent_prompt" && (a.sentinel === true || a.sentinel === 1) ? 1 : 0,
        typeof a.calendar_gate === "string" && a.calendar_gate.length <= 1024 ? a.calendar_gate : null, at(a.created_at), now,
      );
      automations++;
    }
    let mcpServers = 0;
    for (const m of d.mcp_servers) {
      // An imported server never connects or exposes a tool on its own: it arrives disabled, with no
      // credential and no tools, and an existing server keeps the owner's version. Unsafe URLs are skipped.
      // Ids end up inside approval targets ("server/tool") and OAuth state ("server.nonce"), so
      // only servers with the UUIDs Talorys mints are imported.
      if (!REMOTE_ID_PATTERN.test(m.id)) continue;
      if (db.one(`SELECT 1 AS x FROM tal_mcp_servers WHERE id = ?`, m.id) || s.mcp.repo.count() >= MAX_MCP_SERVERS) continue;
      let url: string;
      try {
        url = validateEndpoint(m.url, { development: false }).href;
      } catch {
        continue;
      }
      s.mcp.repo.create({
        id: m.id,
        name: m.name.slice(0, 64),
        url,
        auth_type: pick(m.auth_type, MCP_AUTH_TYPES, "none"),
        enabled: false,
        created_at: at(m.created_at),
      });
      mcpServers++;
    }
    const settings: Record<string, unknown> = { ...d.settings };
    const ignored = IMPORT_IGNORED_SETTINGS.filter((key) => key in settings);
    for (const key of ignored) delete settings[key];
    // A backup from a newer version may name a language this one doesn't have; keep the current one.
    if ("language" in settings && !languagePreferenceSchema.safeParse(settings.language).success) delete settings.language;
    if (Object.keys(settings).length > 0) {
      // Validated merge; invalid fields are rejected with a clear error.
      s.settings.update(settings as never);
    }
    return {
      conversations: importable.size,
      messages,
      memories: d.memories.length,
      tasks: d.tasks.length,
      notes: d.notes.length,
      projects: d.projects.length,
      automations,
      automations_paused: automations,
      mcp_servers: mcpServers,
      ignored_settings: [...ignored],
    };
  });

  // The data is in: the owner hears about it even if re-arming the schedules fails below.
  raiseSecurityAlert(s.alerts, "data_imported");
  // Disarm automations the backup paused; a new timezone also moves the owner's existing schedules.
  if (paused > 0 || s.settings.get().timezone !== previousTimezone) await s.automations.rearmAll();
  if (s.settings.get().timezone !== previousTimezone) await s.workflows.rearmAll();
  s.activity.record("data.imported", `Imported backup from ${backup.exported_at}`);
  return summary;
}
