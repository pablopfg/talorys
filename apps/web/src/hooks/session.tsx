import { createContext, type ReactNode, useCallback, useContext, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, onUnauthorized } from "../lib/api";
import { broadcast, type LocalDeadlines, onSessionMessage, type SessionDeadlines, toLocal } from "../lib/activity";
import { applyTheme } from "../lib/theme";
import { applyLanguage, type LanguagePreference } from "../lib/i18n";

interface SessionState {
  authenticated: boolean;
  configured: boolean;
  agent_name?: string;
  theme?: "system" | "light" | "dark";
  language?: LanguagePreference;
  /** When the server will end this session (signed in only). */
  deadlines?: SessionDeadlines;
  /** The same deadlines on this browser's clock, from when they arrived. */
  local?: LocalDeadlines;
  /** Why the last session ended here, for the sign-in screen. */
  ended?: "idle" | "ended";
}

/** idle: no use (or the owner chose to leave from the warning); ended: the server ended it; manual: Sign out. */
export type LogoutReason = "idle" | "ended" | "manual";

interface SessionContextValue {
  session: SessionState | undefined;
  loading: boolean;
  error: unknown;
  refresh: () => Promise<unknown>;
  logout: (reason?: LogoutReason) => Promise<void>;
  /** Locks this tab only, without telling the server or the other tabs. */
  lock: (reason: LogoutReason) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["session"],
    queryFn: () => api<SessionState>("/auth/session").then((s) => ({ ...s, local: s.deadlines ? toLocal(s.deadlines) : undefined })),
    staleTime: 60_000,
    retry: 1,
  });

  useEffect(() => {
    if (query.data?.theme) applyTheme(query.data.theme);
  }, [query.data?.theme]);

  useEffect(() => {
    if (query.data?.language) applyLanguage(query.data.language);
  }, [query.data?.language]);

  /** Drops all private data from memory and shows the sign-in screen at once. */
  const signOutHere = useCallback(
    (reason: LogoutReason) => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "session" });
      qc.setQueryData<SessionState>(["session"], (s) => ({
        configured: true,
        ...s,
        authenticated: false,
        deadlines: undefined,
        local: undefined,
        ended: reason === "manual" ? undefined : reason,
      }));
    },
    [qc],
  );

  useEffect(
    () =>
      onUnauthorized(() => {
        if (qc.getQueryData<SessionState>(["session"])?.authenticated) signOutHere("ended");
      }),
    [qc, signOutHere],
  );

  // Signing out in one tab signs out every tab.
  useEffect(() => onSessionMessage((m) => m.type === "logout" && signOutHere(m.reason === "manual" ? "manual" : m.reason)), [signOutHere]);

  // Coming back to a tab (or to a page restored by the Back button) checks the session before any
  // data shows: a session past its deadline locks the screen at once, then the server confirms.
  useEffect(() => {
    const check = () => {
      const s = qc.getQueryData<SessionState>(["session"]);
      if (!s?.authenticated) return;
      const d = s.local;
      if (d && Date.now() >= Math.min(d.idleAt, d.maxAt)) signOutHere(d.idleAt <= d.maxAt ? "idle" : "ended");
      void qc.invalidateQueries({ queryKey: ["session"] });
    };
    const onVisible = () => document.visibilityState === "visible" && check();
    const onPageShow = (e: PageTransitionEvent) => e.persisted && check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [qc, signOutHere]);

  const logout = useCallback(
    async (reason: LogoutReason = "manual") => {
      broadcast({ type: "logout", reason });
      try {
        await api("/auth/logout", { method: "POST", body: {} });
      } catch {
        // The screen locks anyway; the server ends the session on its own deadline.
      } finally {
        signOutHere(reason);
      }
    },
    [signOutHere],
  );

  return (
    <SessionContext.Provider value={{ session: query.data, loading: query.isLoading, error: query.error, refresh: query.refetch, logout, lock: signOutHere }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  // i18n-ignore: a developer error, never shown to the owner.
  if (!ctx) throw new Error("useSession outside SessionProvider");
  return ctx;
}
