import { ACTIVITY_HEADER, CSRF_HEADER, type ApiErrorBody, type ApiErrorCode, type ChatStreamEvent } from "@talorys/shared";
import { noteReported, recentlyUsed } from "./activity";
import { currentI18n } from "./i18n";

/** Headers on every API call; the activity header only on calls the owner's input started. */
function baseHeaders(): Record<string, string> {
  if (!recentlyUsed()) return { [CSRF_HEADER]: "1" };
  noteReported();
  return { [CSRF_HEADER]: "1", [ACTIVITY_HEADER]: "1" };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
export function onUnauthorized(fn: Listener): () => void {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

/** The server now asks for a new password (PASSWORD_CHANGE_REQUIRED): the app reloads the session to show that screen. */
const passwordChangeListeners = new Set<Listener>();
export function onPasswordChangeRequired(fn: Listener): () => void {
  passwordChangeListeners.add(fn);
  return () => passwordChangeListeners.delete(fn);
}

/** Asks the owner for the password again; resolves true once confirmed, false if they cancel. */
type ReauthHandler = () => Promise<boolean>;
let reauthHandler: ReauthHandler | null = null;
export function onReauthRequired(fn: ReauthHandler): () => void {
  reauthHandler = fn;
  return () => {
    if (reauthHandler === fn) reauthHandler = null;
  };
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> = {};
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    /* non-JSON error */
  }
  const code = body.error?.code ?? (res.status === 401 ? "UNAUTHORIZED" : "INTERNAL_ERROR");
  const { t, serverText } = currentI18n();
  const message = body.error?.message ? serverText(body.error.message) : res.status >= 500 ? t("api.unavailable") : t("api.requestFailed", { status: String(res.status) });
  return new ApiError(res.status, code, message, body.error?.details);
}

/**
 * Same-origin JSON API call. Cookies carry the session; the custom header defeats CSRF.
 * A sensitive action the server wants the password for asks the owner once, then retries.
 */
export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  try {
    return await request<T>(path, init);
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "REAUTH_REQUIRED" || !reauthHandler) throw error;
    if (!(await reauthHandler())) throw error;
    return request<T>(path, init);
  }
}

async function request<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? "GET",
    credentials: "same-origin",
    headers: {
      ...baseHeaders(),
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  });
  if (!res.ok) {
    const error = await toApiError(res);
    if (res.status === 401 && !path.startsWith("/auth/")) for (const fn of unauthorizedListeners) fn();
    if (error.code === "PASSWORD_CHANGE_REQUIRED") for (const fn of passwordChangeListeners) fn();
    throw error;
  }
  return (await res.json()) as T;
}

/**
 * POSTs a chat message and consumes the Server-Sent Events response incrementally.
 */
export async function streamChat(
  payload: { conversation_id?: string; message: string; retry?: boolean },
  onEvent: (event: ChatStreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    credentials: "same-origin",
    headers: { ...baseHeaders(), "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok || !res.body) {
    const error = await toApiError(res);
    if (res.status === 401) for (const fn of unauthorizedListeners) fn();
    throw error;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = raw
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        onEvent(JSON.parse(data) as ChatStreamEvent);
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}
