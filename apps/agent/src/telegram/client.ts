import { hmacSha256Hex, timingSafeEqual } from "@talorys/shared";

const API = "https://api.telegram.org";
const TIMEOUT_MS = 10_000;
/** A voice file of a few megabytes downloads well within this. */
const DOWNLOAD_TIMEOUT_MS = 30_000;
/** The file_path getFile returns: Telegram's own folders and names, never a way out of them. */
const FILE_PATH = /^[\w-]+(?:\/[\w.-]+)*$/;

/** A refusal from the Bot API. The message never carries the token. */
export class TelegramError extends Error {
  constructor(
    readonly code: number,
    readonly description: string,
    /** Seconds Telegram asked to wait (HTTP 429), if any. */
    readonly retryAfter?: number,
  ) {
    super(`Telegram ${code}: ${description}`);
  }
}

/** Minimal Bot API client: JSON in, `result` out. Requests never follow redirects. */
export class TelegramClient {
  /** Replaced in tests. */
  fetcher: typeof fetch = (input, init) => fetch(input, init);

  constructor(private readonly token: string) {}

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetcher(`${API}/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(params),
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new TelegramError(0, "network error");
    }
    let data: { ok?: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } } = {};
    try {
      data = await res.json();
    } catch {
      // Not JSON: a proxy or an outage page.
    }
    if (!res.ok || !data.ok) {
      throw new TelegramError(data.error_code ?? res.status, String(data.description ?? "request failed").slice(0, 200), data.parameters?.retry_after);
    }
    return data.result as T;
  }

  /**
   * Downloads a file the bot received (a voice message), by the file_path getFile returned.
   * The read stops past `maxBytes`, so a file larger than Telegram said is never held in memory.
   */
  async download(filePath: string, maxBytes: number): Promise<Uint8Array> {
    if (!FILE_PATH.test(filePath) || filePath.split("/").some((part) => part === "." || part === "..")) {
      throw new TelegramError(400, "unexpected file path");
    }
    let res: Response;
    try {
      res = await this.fetcher(`${API}/file/bot${this.token}/${filePath}`, { redirect: "manual", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    } catch {
      throw new TelegramError(0, "network error");
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => undefined);
      throw new TelegramError(res.status, "download failed");
    }
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) {
      await res.body.cancel().catch(() => undefined);
      throw new TelegramError(413, "file too large");
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new TelegramError(413, "file too large");
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof TelegramError) throw error;
      throw new TelegramError(0, "network error");
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.byteLength;
    }
    return out;
  }
}

/** Base64 of raw bytes, in slices so a large file never overflows the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * The secret Telegram sends back in X-Telegram-Bot-Api-Secret-Token with every update. It is
 * derived from SESSION_SECRET, so there is no extra secret to set; rotating SESSION_SECRET
 * means pressing "Reconnect" in Settings → Alerts.
 */
export async function telegramWebhookSecret(sessionSecret: string): Promise<string> {
  return hmacSha256Hex(sessionSecret, "talorys:telegram-webhook:v1");
}

/** Constant-time check of the header Telegram sent. */
export async function isTelegramWebhook(header: string | null | undefined, sessionSecret: string | undefined): Promise<boolean> {
  if (!header || !sessionSecret) return false;
  const expected = await telegramWebhookSecret(sessionSecret);
  const enc = new TextEncoder();
  return timingSafeEqual(enc.encode(header), enc.encode(expected));
}

export const TELEGRAM_WEBHOOK_PATH = "/api/telegram/webhook";

/** Escapes text for Telegram's HTML parse mode. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
