import type { PushDevice, PushStatus } from "@talorys/shared";
import { api } from "./api";
import { currentI18n } from "./i18n";

/** Why this browser cannot turn on push right now, or null when it can. */
export type PushBlocker = "unsupported" | "ios-not-installed" | "denied" | null;

const DEVICE_KEY = "talorys.pushDevice";
/** When this browser last told the server it still uses its push subscription. */
const SEEN_KEY = "talorys.pushSeen";
const SEEN_EVERY_MS = 60 * 60_000;

export function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function pushBlocker(): PushBlocker {
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  // iOS and iPadOS only offer Web Push to web apps opened from the Home Screen.
  if (isIos() && !standalone) return "ios-not-installed";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return null;
}

/** This browser's current push subscription, if it has one. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const bin = atob(base64url.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Asks permission (must run from a click), subscribes this browser, and registers it with Axis. */
export async function enablePush(publicKey: string): Promise<{ device: PushDevice; status: PushStatus }> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(currentI18n().t("push.notAllowed"));
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with an older key cannot be reused after the keys change.
  const existingKey = sub?.options.applicationServerKey;
  if (sub && existingKey && !sameKey(existingKey, keyBytes(publicKey))) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  const result = await api<{ device: PushDevice; status: PushStatus }>("/push/subscriptions", { method: "POST", body: sub.toJSON() });
  remember(result.device.id);
  return result;
}

export async function disablePush(): Promise<PushStatus> {
  const sub = await currentSubscription();
  remember(null);
  if (!sub) return api<PushStatus>("/push");
  const status = await api<PushStatus>("/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } });
  await sub.unsubscribe();
  return status;
}

/**
 * Tells the server this browser still opens Axis, so its push subscription is kept: devices
 * silent for PUSH_INACTIVE_DAYS are removed. At most once an hour unless `force`. Resolves to
 * whether the server still has this browser's subscription, or null when there is none to report
 * (or the check could not be made).
 */
export async function reportPushSeen(force = false): Promise<boolean | null> {
  try {
    if (!force && Date.now() - Number(localStorage.getItem(SEEN_KEY) ?? 0) < SEEN_EVERY_MS) return null;
  } catch {
    /* storage unavailable: report every time it is asked */
  }
  const sub = await currentSubscription().catch(() => null);
  if (!sub) return null;
  try {
    const { known } = await api<{ known: boolean }>("/push/seen", { method: "POST", body: { endpoint: sub.endpoint } });
    try {
      localStorage.setItem(SEEN_KEY, String(Date.now()));
    } catch {
      /* storage unavailable */
    }
    if (!known) {
      // Removed on the server (inactive, or from another device): drop the local subscription too.
      remember(null);
      await sub.unsubscribe().catch(() => {});
    }
    return known;
  } catch {
    return null;
  }
}

function sameKey(a: ArrayBuffer, b: Uint8Array): boolean {
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

/** The device id this browser registered as, to mark it in the device list. */
export function thisDeviceId(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
}

function remember(id: string | null) {
  try {
    if (id) localStorage.setItem(DEVICE_KEY, id);
    else localStorage.removeItem(DEVICE_KEY);
  } catch {
    /* storage unavailable (private mode); only the "this device" marker is lost */
  }
}
