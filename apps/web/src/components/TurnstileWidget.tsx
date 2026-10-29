import { useEffect, useRef } from "react";
import { useI18n } from "../lib/i18n";

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

/** Loads Cloudflare's script once, only when a sign-in needs the check (the CSP allows this one origin). */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile")));
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error("turnstile"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Cloudflare's "not a robot" check on the sign-in form. Gives the token through onToken, and null
 * when it expires or fails. A token works once: remount (change the key) after each try.
 */
export function TurnstileWidget({ siteKey, onToken, onError }: { siteKey: string; onToken: (token: string | null) => void; onError: () => void }) {
  const { language } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  // The latest callbacks, without drawing the widget again when they change.
  const callbacks = useRef({ onToken, onError });
  callbacks.current = { onToken, onError };

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !ref.current) return;
        widgetId = turnstile.render(ref.current, {
          sitekey: siteKey,
          action: "login",
          theme: "auto",
          size: "flexible",
          language: language.toLowerCase(),
          callback: (token: string) => callbacks.current.onToken(token),
          "expired-callback": () => callbacks.current.onToken(null),
          "error-callback": () => {
            callbacks.current.onToken(null);
            callbacks.current.onError();
          },
        });
      })
      .catch(() => {
        if (!cancelled) callbacks.current.onError();
      });
    return () => {
      cancelled = true;
      if (widgetId !== null) window.turnstile?.remove(widgetId);
    };
  }, [siteKey, language]);

  return <div ref={ref} className="min-h-[65px]" />;
}
