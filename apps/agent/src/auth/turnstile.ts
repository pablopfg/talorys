/**
 * Cloudflare Turnstile, the "not a robot" check the sign-in form shows only when a sign-in looks
 * risky (see AuthService.humanCheckRequired). Free, and it sends no cookie of its own to Talorys.
 *
 * The browser solves the widget and sends its token with the password; the Worker confirms it
 * with siteverify before anything else. A token works once, for about five minutes.
 */
export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** The widget's action on each form: a token made for another form (or another site's widget) is refused. */
export const TURNSTILE_ACTION = "login";
export const TURNSTILE_RECOVERY_ACTION = "recovery";
/** Longest token Cloudflare issues. */
export const TURNSTILE_TOKEN_MAX = 2048;
const VERIFY_TIMEOUT_MS = 5000;

/** ok: a person. failed: no token, a wrong or used one. unavailable: siteverify did not answer. */
export type HumanCheckResult = "ok" | "failed" | "unavailable";

export interface HumanCheck {
  /** Public key the widget is drawn with. */
  siteKey: string;
  verify(token: string | undefined, remoteIp: string | undefined, action?: string): Promise<HumanCheckResult>;
}

/** Site keys and secrets are short base64url-like strings; anything else is a configuration slip. */
const KEY = /^[0-9A-Za-z_-]{10,128}$/;

/**
 * The check for this deployment, or undefined when it is off (either key missing or malformed).
 * With allowed hosts, a token solved on any other hostname is refused too.
 */
export function turnstile(
  siteKey: string | undefined,
  secret: string | undefined,
  allowedHosts: readonly string[] = [],
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): HumanCheck | undefined {
  const site = siteKey?.trim() ?? "";
  const key = secret?.trim() ?? "";
  if (!KEY.test(site) || !KEY.test(key)) {
    // Off, as without the keys; worth a line in the logs when only one was set or one is malformed.
    if (site || key) console.warn("Turnstile is off: set both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY, each 10-128 letters, digits, - or _.");
    return undefined;
  }
  const hosts = allowedHosts.map((h) => h.toLowerCase());
  return {
    siteKey: site,
    async verify(token, remoteIp, action = TURNSTILE_ACTION) {
      if (!token || token.length > TURNSTILE_TOKEN_MAX) return "failed";
      const form = new FormData();
      form.set("secret", key);
      form.set("response", token);
      if (remoteIp) form.set("remoteip", remoteIp);
      let outcome: { success?: unknown; action?: unknown; hostname?: unknown; "error-codes"?: unknown };
      try {
        const res = await fetcher(TURNSTILE_VERIFY_URL, { method: "POST", body: form, signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS), redirect: "manual" });
        if (!res.ok) return "unavailable";
        outcome = await res.json();
      } catch {
        return "unavailable";
      }
      if (!outcome || typeof outcome !== "object") return "unavailable";
      if (outcome.success !== true) {
        // Cloudflare's own trouble, not the visitor's answer.
        const codes = Array.isArray(outcome["error-codes"]) ? outcome["error-codes"] : [];
        return codes.includes("internal-error") ? "unavailable" : "failed";
      }
      if (outcome.action !== action) return "failed";
      if (hosts.length > 0 && !(typeof outcome.hostname === "string" && hosts.includes(outcome.hostname.toLowerCase()))) return "failed";
      return "ok";
    },
  };
}
