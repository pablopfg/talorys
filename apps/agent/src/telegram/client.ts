import { hmacSha256Hex, timingSafeEqual } from "@talorys/shared";

const API = "https://api.telegram.org";
const TIMEOUT_MS = 10_000;

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
