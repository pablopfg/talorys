import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Dialog } from "./ui";
import { useSession } from "../hooks/session";
import { api } from "../lib/api";
import { broadcast, type LocalDeadlines, lastReportedAt, lastUseAt, markUse, noteReported, onSessionMessage, type SessionDeadlines, toLocal } from "../lib/activity";
import { useI18n } from "../lib/i18n";

/** The tab holding this lock sends the presence signal for all of them. */
const LEADER_LOCK = "talorys-heartbeat";
const HEARTBEAT_MS = 60_000;
/** The warning shows this long before the session ends for lack of use. */
const WARN_MS = 2 * 60_000;
// Not "scroll": the app scrolls by itself (a chat reply streaming in), and that is not use.
const INPUT_EVENTS = ["pointerdown", "keydown", "touchstart", "wheel"] as const;
/** A tab must be in front this long before its own count may sign the whole browser out. */
const SETTLE_MS = 5_000;

const formatCountdown = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/**
 * Ends the session in the browser when the server will (section 17 of the plan): notices real use,
 * sends one presence signal a minute for all open tabs, warns two minutes before the session ends
 * for lack of use, and signs out every tab when it does. The server enforces the same deadlines on
 * every request; this only makes the end visible and clean.
 */
export function SessionGuard() {
  const { t } = useI18n();
  const { session, logout, lock, refresh } = useSession();
  const [deadlines, setDeadlines] = useState<LocalDeadlines | undefined>(session?.local);
  const [now, setNow] = useState(Date.now());
  const lastBeat = useRef(Date.now());
  const ending = useRef(false);
  const visibleSince = useRef(Date.now());

  useEffect(() => setDeadlines(session?.local), [session?.local]);

  const beat = useCallback(
    async (active: boolean) => {
      lastBeat.current = Date.now();
      if (active) noteReported();
      try {
        const { deadlines } = await api<{ deadlines: SessionDeadlines }>("/auth/heartbeat", { method: "POST", body: { active } });
        const local = toLocal(deadlines);
        setDeadlines(local);
        broadcast({ type: "deadlines", deadlines: local });
      } catch {
        // A 401 signs out through the API client; a network error waits for the next beat.
      }
    },
    [],
  );

  // Real use: only the time is kept.
  useEffect(() => {
    const onInput = () => markUse();
    for (const name of INPUT_EVENTS) window.addEventListener(name, onInput, { passive: true, capture: true });
    return () => {
      for (const name of INPUT_EVENTS) window.removeEventListener(name, onInput, { capture: true });
    };
  }, []);

  // Deadlines another tab learned.
  useEffect(() => onSessionMessage((m) => m.type === "deadlines" && setDeadlines(m.deadlines)), []);

  // One tab (the lock holder) sends the presence signal; without Web Locks every tab does.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const lead = () => {
      timer = setInterval(() => void beat(lastUseAt() > lastBeat.current), HEARTBEAT_MS);
    };
    const release = new AbortController();
    if (typeof navigator !== "undefined" && navigator.locks) {
      navigator.locks
        .request(LEADER_LOCK, { signal: release.signal }, () => {
          if (stopped) return;
          lead();
          // Held until this tab goes away or the component unmounts.
          return new Promise<void>((resolve) => release.signal.addEventListener("abort", () => resolve()));
        })
        .catch(() => {
          /* aborted on unmount */
        });
    } else {
      lead();
    }
    return () => {
      stopped = true;
      clearInterval(timer);
      release.abort();
    };
  }, [beat]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") visibleSince.current = Date.now();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // The clock for the warning.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // The server's deadline, or this browser's own count from the last use it reported, whichever is
  // sooner: they agree within a minute, and the own count holds even if the clocks disagree.
  const idleAt = deadlines ? Math.min(deadlines.idleAt, lastReportedAt() + deadlines.idleMs) : Number.POSITIVE_INFINITY;
  const maxAt = deadlines?.maxAt ?? Number.POSITIVE_INFINITY;
  const endsAt = Math.min(idleAt, maxAt);
  const remaining = endsAt - now;
  // Use the server hasn't heard of yet (reading, scrolling) renews it before any warning shows.
  const unreported = lastUseAt() > lastBeat.current;
  const warn = remaining <= WARN_MS && !(unreported && idleAt < maxAt);

  useEffect(() => {
    if (remaining <= WARN_MS && unreported && idleAt < maxAt && Date.now() - lastBeat.current > 5_000) void beat(true);
  }, [remaining, unreported, idleAt, maxAt, beat]);

  useEffect(() => {
    if (remaining > 0 || ending.current) return;
    ending.current = true;
    // A maximum-length end is not about inactivity, so it gets the general message.
    const reason = idleAt <= maxAt ? "idle" : "ended";
    // A tab just back from the background (or from being frozen) may count from stale news. It
    // locks only itself and asks the server, so it never signs out a session in use elsewhere.
    if (document.visibilityState !== "visible" || Date.now() - visibleSince.current < SETTLE_MS) {
      lock(reason);
      void refresh();
      return;
    }
    void logout(reason);
  }, [remaining, idleAt, maxAt, logout, lock, refresh]);

  if (!warn || remaining <= 0) return null;
  const maxReached = maxAt <= idleAt;
  return (
    <Dialog open onClose={() => void beat(true)} title={t("sessionGuard.title")}>
      <div className="space-y-4">
        <p className="text-sm leading-6 text-fg-muted" aria-live="polite" aria-atomic="true">
          {maxReached ? t("sessionGuard.maxMessage", { time: formatCountdown(remaining) }) : t("sessionGuard.idleMessage", { time: formatCountdown(remaining) })}
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => void logout("manual")}>
            {t("sessionGuard.signOut")}
          </Button>
          {!maxReached && (
            <Button type="button" autoFocus onClick={() => void beat(true)}>
              {t("sessionGuard.stay")}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
