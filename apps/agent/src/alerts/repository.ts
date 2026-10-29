import type { AlertChannel, AlertDelivery, AlertDeliveryReason, AlertDeliveryStatus, Notification } from "@talorys/shared";
import { type Database, newId, now } from "../db/database";

/** Delivery rows are kept this long, and never more than MAX_ROWS of them. */
export const DELIVERY_RETENTION_DAYS = 90;
const MAX_ROWS = 2000;

/** One row per alert and channel: sent, held back or failed. Only metadata, never the body. */
export class AlertDeliveryRepository {
  constructor(private readonly db: Database) {}

  record(
    n: Pick<Notification, "id" | "title" | "priority" | "category">,
    channel: AlertChannel,
    status: AlertDeliveryStatus,
    reason: AlertDeliveryReason | null = null,
    reached = 0,
  ): AlertDelivery {
    const row: AlertDelivery = {
      id: newId(),
      notification_id: n.id,
      title: n.title.slice(0, 200),
      channel,
      priority: n.priority,
      category: n.category,
      status,
      reason,
      reached,
      created_at: now(),
    };
    this.db.run(
      `INSERT INTO tal_alert_deliveries (id, notification_id, title, channel, priority, category, status, reason, reached, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id, row.notification_id, row.title, row.channel, row.priority, row.category, row.status, row.reason, row.reached, row.created_at,
    );
    return row;
  }

  /** Finishes a delivery that was recorded before its background send completed. */
  finish(id: string, status: AlertDeliveryStatus, reason: AlertDeliveryReason | null, reached: number): void {
    this.db.run(`UPDATE tal_alert_deliveries SET status = ?, reason = ?, reached = ? WHERE id = ?`, status, reason, reached, id);
  }

  list(limit = 100): AlertDelivery[] {
    return this.db.all<AlertDelivery>(`SELECT * FROM tal_alert_deliveries ORDER BY created_at DESC, rowid DESC LIMIT ?`, limit);
  }

  /**
   * Messages a channel has sent, or is sending, since `since` (ISO time), for its limits.
   * Critical alerts are not counted: they never wait, so they must not use up the others' room.
   */
  sentSince(channel: AlertChannel, since: string): number {
    return (
      this.db.one<{ n: number }>(
        `SELECT count(*) AS n FROM tal_alert_deliveries
         WHERE channel = ? AND created_at >= ? AND status IN ('sent', 'pending') AND priority != 'critical'`,
        channel, since,
      )?.n ?? 0
    );
  }

  prune(): void {
    const cutoff = new Date(Date.now() - DELIVERY_RETENTION_DAYS * 86_400_000).toISOString();
    this.db.run(`DELETE FROM tal_alert_deliveries WHERE created_at < ?`, cutoff);
    this.db.run(
      `DELETE FROM tal_alert_deliveries WHERE id NOT IN (SELECT id FROM tal_alert_deliveries ORDER BY created_at DESC, rowid DESC LIMIT ?)`,
      MAX_ROWS,
    );
  }
}
