import {
  ALERT_PRIORITIES,
  type AlertCategory,
  type AlertPriority,
  type AlertProfile,
  type AutomationPriority,
  LEARNING,
  type Notification,
  type PriorityReason,
  priorityRank,
} from "@talorys/shared";
import { type Database, newId, now } from "../db/database";
import type { AlertSignal, NotificationRepository } from "../db/repositories/automations";
import type { ActivityLog } from "../services/usage";
import { clip } from "../services/text";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** Category names already in the server-text catalog (the Telegram topics use them too). */
const CATEGORY_NAMES: Record<AlertCategory, string> = {
  reminder: "Reminders", digest: "Digests", routine: "Routines", task: "Tasks", system: "System", security: "Security", event: "Events",
};
/** Corrections kept; the agent reads the latest reminder ones. */
const MAX_CORRECTIONS = 100;
/** Profiles kept: one per routine and kind of alert, so a few hundred at most in practice. */
const MAX_PROFILES = 500;

/** What each signal says about how loud the alerts of a profile should be, from -1 to 1. */
export const SIGNAL_VALUES: Record<AlertSignal, number> = {
  fast: 0.7,
  read: 0.1,
  slow: -0.3,
  snooze: 0.2,
  mute: -0.6,
  ignored: -0.8,
  task: 0.8,
};

/** Weight of a new signal in the moving average; the owner's own correction weighs most. */
const BEHAVIOUR_WEIGHT = 0.3;
const CORRECTION_WEIGHT = 0.6;

/** A correction the owner made, as the agent reads it when it picks a reminder's priority. */
export interface AlertCorrection {
  text: string;
  from: AlertPriority;
  to: AlertPriority;
  created_at: string;
}

const PROFILE_COLUMNS = "id, key, category, label, shift, pinned, score, samples, changed_at, last_change, updated_at";

/**
 * The priority that learns. Each kind of alert (category + origin) has a profile; what the owner
 * does with its alerts (read fast, ignore, snooze, mute, correct, finish the task) moves a moving
 * average that raises or lowers the profile one level at a time, at most once a week. Fixed rules
 * come first: security alerts are always critical and never learn; external events never go
 * above high; a reminder never learns its way down to low (it would stay in the app).
 */
export class AlertLearning {
  constructor(
    private readonly db: Database,
    private readonly notifications: NotificationRepository,
    private readonly activity?: ActivityLog,
  ) {}

  /**
   * The profile of an alert: one per automation (its routine or reminder), otherwise the kind of
   * alert (the dedupe key's prefix, e.g. `task-overdue`), otherwise the category alone.
   */
  static profileKey(input: { category: AlertCategory; automationId?: string | null; dedupeKey?: string; profileKind?: string }): string {
    if (input.automationId && !input.profileKind) return `${input.category}:automation:${input.automationId}`;
    const kind = (input.profileKind ?? input.dedupeKey?.split(":")[0])?.replace(/[^\w-]/g, "").slice(0, 40);
    return `${input.category}:${kind || "general"}`;
  }

  /** The priority an alert goes out with, and why. `asked` is what its source asked for. */
  decide(category: AlertCategory, asked: AlertPriority, key: string | null, label: string | null): { priority: AlertPriority; reason: PriorityReason } {
    // Rule: security is always critical, whatever asked for less.
    if (category === "security") return { priority: "critical", reason: asked === "critical" ? "default" : "rule" };
    let priority = asked;
    let reason: PriorityReason = "default";
    const profile = key ? this.touch(key, category, label) : null;
    if (profile?.pinned) {
      priority = profile.pinned;
      reason = "pinned";
    } else if (profile && profile.shift !== 0 && priorityRank(asked) < priorityRank("high")) {
      // Learning moves low and normal alerts only, and at most up to high: an alert that asked to
      // insist (high) or a critical one keeps what it asked for.
      const rank = Math.min(Math.max(priorityRank(asked) + profile.shift, priorityRank("low")), priorityRank("high"));
      priority = ALERT_PRIORITIES[rank]!;
      if (priority !== asked) reason = profile.shift > 0 ? "raised" : "lowered";
    }
    // Rule: a reminder the owner scheduled always leaves the app; learning never makes it low
    // (the owner may still pin one at low on purpose).
    if (category === "reminder" && priority === "low" && asked !== "low" && reason !== "pinned") {
      priority = "normal";
      reason = "default";
    }
    // Rule: what comes from outside Talorys is never louder than high.
    if (category === "event" && priorityRank(priority) > priorityRank("high")) {
      priority = "high";
      reason = "rule";
    }
    return { priority, reason };
  }

  /**
   * A new alert of a profile was raised: older ones nobody read in LEARNING.ignoredHours count as
   * ignored. Checked here, so no timer is needed for it.
   */
  sweepIgnored(key: string): void {
    const before = new Date(Date.now() - LEARNING.ignoredHours * HOUR_MS).toISOString();
    // A low alert stays in the app: nobody was told, so leaving it unread says nothing. Counting
    // it would also keep a kind that learned its way down to low there for good.
    for (const n of this.notifications.unanswered(key, before)) if (n.priority !== "low") this.observe(n, "ignored");
  }

  /** The owner read or answered an alert: how fast says how much it mattered. */
  read(n: Notification): void {
    const minutes = (Date.now() - Date.parse(n.created_at)) / MINUTE_MS;
    const signal: AlertSignal = minutes <= LEARNING.fastMinutes ? "fast" : minutes <= LEARNING.slowHours * 60 ? "read" : "slow";
    this.observe(n, signal);
  }

  /** One behaviour signal per alert: the first thing the owner did with it. */
  observe(n: Notification, signal: AlertSignal): void {
    if (!n.profile || n.category === "security") return;
    if (!this.notifications.claimSignal(n.id, signal)) return;
    this.learn(n.profile, SIGNAL_VALUES[signal], BEHAVIOUR_WEIGHT, false);
  }

  /** A task was finished: the alert about it, if one came shortly before, was acted upon. */
  taskCompleted(taskId: string): void {
    const n = this.notifications.latestForTask(taskId, new Date(Date.now() - LEARNING.taskMinutes * MINUTE_MS).toISOString());
    if (n) this.observe(n, "task");
  }

  /**
   * The owner changed an alert's priority: the strongest signal, and a note for the agent. Only
   * the first correction of an alert teaches the profile; changing it again just updates the
   * note (and changing it back removes it), so tapping through the buttons can't add up.
   */
  corrected(n: Notification, to: AlertPriority): void {
    if (!n.profile || n.category === "security" || n.priority === to) return;
    const earlier = this.db.one<{ id: string; from_priority: AlertPriority }>(
      `SELECT id, from_priority FROM tal_alert_corrections WHERE notification_id = ?`,
      n.id,
    );
    if (earlier) {
      if (earlier.from_priority === to) this.db.run(`DELETE FROM tal_alert_corrections WHERE id = ?`, earlier.id);
      else this.db.run(`UPDATE tal_alert_corrections SET to_priority = ?, created_at = ? WHERE id = ?`, to, now(), earlier.id);
      return;
    }
    this.db.run(
      `INSERT INTO tal_alert_corrections (id, notification_id, profile, category, text, from_priority, to_priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      newId(), n.id, n.profile, n.category, clip(n.category === "reminder" ? n.body : n.title, 200), n.priority, to, now(),
    );
    this.db.run(
      `DELETE FROM tal_alert_corrections WHERE id NOT IN (SELECT id FROM tal_alert_corrections ORDER BY created_at DESC, rowid DESC LIMIT ?)`,
      MAX_CORRECTIONS,
    );
    this.learn(n.profile, priorityRank(to) > priorityRank(n.priority) ? 1 : -1, CORRECTION_WEIGHT, true);
  }

  /** The owner's latest corrections of reminders, newest first, from the last 90 days. */
  reminderCorrections(limit = 20): AlertCorrection[] {
    const since = new Date(Date.now() - 90 * DAY_MS).toISOString();
    return this.db.all<AlertCorrection>(
      `SELECT text, from_priority AS "from", to_priority AS "to", created_at FROM tal_alert_corrections
       WHERE category = 'reminder' AND created_at >= ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      since, limit,
    );
  }

  /** Every profile that learned something or was pinned, most recently changed first. */
  list(): AlertProfile[] {
    return this.db.all<AlertProfile>(
      `SELECT ${PROFILE_COLUMNS} FROM tal_alert_profiles
       WHERE samples > 0 OR shift != 0 OR pinned IS NOT NULL ORDER BY coalesce(changed_at, updated_at) DESC LIMIT 200`,
    );
  }

  get(id: string): AlertProfile | null {
    return this.db.one<AlertProfile>(`SELECT ${PROFILE_COLUMNS} FROM tal_alert_profiles WHERE id = ?`, id) ?? null;
  }

  /** Profiles whose level moved since `since` (ISO time), for the weekly summary. */
  changedSince(since: string): AlertProfile[] {
    return this.db.all<AlertProfile>(`SELECT ${PROFILE_COLUMNS} FROM tal_alert_profiles WHERE changed_at >= ? ORDER BY changed_at DESC`, since);
  }

  /** The owner fixes a profile at a priority (null: learn again from where it is). */
  pin(id: string, pinned: AutomationPriority | null): AlertProfile | null {
    this.db.run(`UPDATE tal_alert_profiles SET pinned = ?, score = 0, samples = 0, updated_at = ? WHERE id = ? AND category != 'security'`, pinned, now(), id);
    return this.get(id);
  }

  /** Forgets what a profile learned: back to the priority its alerts ask for. */
  reset(id: string): AlertProfile | null {
    this.db.run(
      `UPDATE tal_alert_profiles SET shift = 0, pinned = NULL, score = 0, samples = 0, changed_at = NULL, last_change = NULL, updated_at = ? WHERE id = ?`,
      now(), id,
    );
    this.db.run(`DELETE FROM tal_alert_corrections WHERE profile = (SELECT key FROM tal_alert_profiles WHERE id = ?)`, id);
    return this.get(id);
  }

  /** The profile for a key, created on first use; its label follows the automation's latest name. */
  private touch(key: string, category: AlertCategory, label: string | null): AlertProfile {
    const ts = now();
    this.db.run(
      `INSERT INTO tal_alert_profiles (id, key, category, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET label = coalesce(excluded.label, tal_alert_profiles.label)`,
      newId(), key, category, label ? clip(label, 120) : null, ts, ts,
    );
    const count = this.db.one<{ n: number }>(`SELECT count(*) AS n FROM tal_alert_profiles`)?.n ?? 0;
    if (count > MAX_PROFILES) {
      // Profiles that never learned anything go first; the oldest of them.
      this.db.run(
        `DELETE FROM tal_alert_profiles WHERE id IN (
           SELECT id FROM tal_alert_profiles WHERE shift = 0 AND pinned IS NULL AND key != ? ORDER BY updated_at LIMIT ?)`,
        key, count - MAX_PROFILES,
      );
    }
    return this.db.one<AlertProfile>(`SELECT ${PROFILE_COLUMNS} FROM tal_alert_profiles WHERE key = ?`, key)!;
  }

  /**
   * Adds a signal to a profile's moving average, and moves its level one step when the average
   * crosses LEARNING.threshold, with enough signals, and not within LEARNING.lockDays of the last
   * move. After a move the average starts again, so the next one needs fresh evidence.
   */
  private learn(key: string, value: number, weight: number, correction: boolean): void {
    const p = this.db.one<AlertProfile>(`SELECT ${PROFILE_COLUMNS} FROM tal_alert_profiles WHERE key = ?`, key);
    // A pinned profile stays where the owner put it.
    if (!p || p.pinned || p.category === "security") return;
    const score = p.score + weight * (value - p.score);
    const samples = p.samples + 1;
    const ts = now();
    const locked = p.changed_at !== null && Date.now() - Date.parse(p.changed_at) < LEARNING.lockDays * DAY_MS;
    const direction = score >= LEARNING.threshold ? 1 : score <= -LEARNING.threshold ? -1 : 0;
    const shift = Math.max(-LEARNING.maxShift, Math.min(LEARNING.maxShift, p.shift + direction));
    if (direction !== 0 && !locked && (samples >= LEARNING.minSamples || correction) && shift !== p.shift) {
      this.db.run(
        `UPDATE tal_alert_profiles SET shift = ?, score = 0, samples = 0, changed_at = ?, last_change = ?, updated_at = ? WHERE id = ?`,
        shift, ts, direction, ts, p.id,
      );
      const name = p.label ? `“${clip(p.label, 80)}”` : CATEGORY_NAMES[p.category];
      this.activity?.record("alerts.learned", direction > 0 ? `Alert priority learned: ${name} one level louder` : `Alert priority learned: ${name} one level quieter`);
      return;
    }
    this.db.run(`UPDATE tal_alert_profiles SET score = ?, samples = ?, updated_at = ? WHERE id = ?`, score, samples, ts, p.id);
  }
}
