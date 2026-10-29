import { z } from "zod";

/** Most devices one owner can register for push; each notification is sent to every one. */
export const MAX_PUSH_DEVICES = 10;

/** A browser subscribed to Web Push. The endpoint and keys stay on the server. */
export interface PushDevice {
  id: string;
  label: string;
  /** Host of the push service (e.g. fcm.googleapis.com), shown to tell devices apart. */
  service: string;
  created_at: string;
  last_success_at: string | null;
  failures: number;
}

export interface PushStatus {
  /** False until the Worker has VAPID keys; everything else keeps working without them. */
  available: boolean;
  public_key: string | null;
  devices: PushDevice[];
  max_devices: number;
}

/** The browser's PushSubscription.toJSON(), plus an optional device label. */
export const pushSubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  // Exactly what RFC 8291 needs: an uncompressed P-256 point (65 bytes, so it starts with 0x04 = "B")
  // and a 16-byte secret, base64url with or without padding.
  keys: z.object({
    p256dh: z.string().regex(/^B[A-Za-z0-9_-]{86}=?$/, "Must be a 65-byte P-256 key in base64url"),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}(==)?$/, "Must be 16 bytes in base64url"),
  }),
  label: z.string().trim().max(100).optional(),
});

export const pushUnsubscribeSchema = z.object({ endpoint: z.string().url().max(2048) });
