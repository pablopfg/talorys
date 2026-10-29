import { type FormEvent, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { startAuthentication } from "@simplewebauthn/browser";
import { AtSign, Eye, EyeOff, Fingerprint, KeyRound, Lock } from "lucide-react";
import { Logo } from "../components/Logo";
import { TurnstileWidget } from "../components/TurnstileWidget";
import { Button } from "../components/ui";
import type { HumanCheck } from "../hooks/session";
import { api, ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";

export function LoginPage({
  configured,
  ended,
  emailRequired = false,
  humanCheck,
  canRecover = false,
}: { configured: boolean; ended?: "idle" | "ended"; emailRequired?: boolean; humanCheck?: HumanCheck; canRecover?: boolean }) {
  const { t, rich } = useI18n();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [pending, setPending] = useState(false);
  // The second step: after a right password, when two-step sign-in is on.
  const [codeStep, setCodeStep] = useState(false);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [passkey, setPasskey] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  // Kept from the moment the lock screen appeared, so a later session refresh doesn't erase it.
  const [endedReason] = useState(ended);
  // The robot check: shown only when the server says this sign-in looks risky (a recent failure,
  // or an attack in progress). Its site key comes with the session or with the refusal.
  const [humanKey, setHumanKey] = useState<string | null>(humanCheck?.required ? humanCheck.site_key : null);
  const [humanToken, setHumanToken] = useState<string | null>(null);
  const [humanBroken, setHumanBroken] = useState(false);
  // A token works once: a new widget after every try.
  const [humanRound, setHumanRound] = useState(0);
  useEffect(() => {
    if (humanCheck?.required) setHumanKey(humanCheck.site_key);
  }, [humanCheck?.required, humanCheck?.site_key]);
  // A widget that can't load doesn't lock the form: the server decides whether it was needed.
  const humanMissing = humanKey !== null && !humanToken && !humanBroken;
  // "Forgot password": the address (when asked for) and, with Turnstile on, always the robot check.
  const [forgot, setForgot] = useState<"form" | "sent" | null>(null);
  const [forgotToken, setForgotToken] = useState<string | null>(null);
  const [forgotRound, setForgotRound] = useState(0);
  const forgotKey = humanCheck?.site_key ?? null;

  async function requestLink(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || pending || (forgotKey && !forgotToken && !humanBroken)) return;
    setPending(true);
    setError(null);
    const token = forgotToken;
    setForgotToken(null);
    setForgotRound((n) => n + 1);
    try {
      await api("/auth/recovery", { method: "POST", body: { email, ...(token ? { turnstile_token: token } : {}) } });
      setForgot("sent");
    } catch (err) {
      setError(err instanceof ApiError && err.code === "RATE_LIMITED" ? t("login.rateLimited") : err instanceof Error ? err.message : t("login.failed"));
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    if (!retryAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [retryAt]);
  const waitSeconds = retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password || (emailRequired && !email.trim()) || pending || waitSeconds > 0 || humanMissing) return;
    setPending(true);
    setError(null);
    const token = humanToken;
    if (humanKey !== null) {
      setHumanToken(null);
      setHumanRound((n) => n + 1);
    }
    try {
      const body = { password, ...(emailRequired ? { email } : {}), ...(token ? { turnstile_token: token } : {}) };
      const result = await api<{ authenticated: boolean; mfa_required?: boolean; passkey?: boolean }>("/auth/login", { method: "POST", body });
      setPassword("");
      if (result.mfa_required) {
        setCodeStep(true);
        setPasskey(!!result.passkey);
        setCode("");
        setRecovery(false);
        return;
      }
      await qc.invalidateQueries({ queryKey: ["session"] });
    } catch (err) {
      const check = err instanceof ApiError ? (err.details as { human_check?: string; site_key?: string } | undefined) : undefined;
      if (check?.human_check && check.site_key) {
        // The next try from here needs the check (or it must be done again).
        if (humanKey === null) setHumanRound((n) => n + 1);
        setHumanKey(check.site_key);
      }
      if (err instanceof ApiError && err.code === "RATE_LIMITED") {
        const seconds = (err.details as { retry_after?: number } | undefined)?.retry_after ?? 60;
        setRetryAt(Date.now() + seconds * 1000);
        setError(t("login.rateLimited"));
      } else {
        setError(err instanceof Error ? err.message : t("login.failed"));
      }
      setPassword("");
      inputRef.current?.focus();
    } finally {
      setPending(false);
    }
  }

  /** A failed second step: back to the password when the challenge is over, else try again here. */
  function secondStepFailed(err: unknown) {
    setError(err instanceof Error ? err.message : t("login.failed"));
    if (err instanceof ApiError && (err.details as { mfa?: string } | undefined)?.mfa === "expired") {
      setCodeStep(false);
      inputRef.current?.focus();
    } else {
      codeRef.current?.focus();
    }
  }

  async function signInWithPasskey() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const { options } = await api<{ options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>("/auth/mfa/passkey/options", { method: "POST", body: {} });
      const response = await startAuthentication({ optionsJSON: options });
      await api("/auth/mfa/passkey", { method: "POST", body: { response } });
      await qc.invalidateQueries({ queryKey: ["session"] });
    } catch (err) {
      // Closing the browser's prompt isn't a wrong answer: the code is still there to use.
      if (err instanceof Error && (err.name === "NotAllowedError" || err.name === "AbortError")) setError(t("login.passkeyCancelled"));
      else secondStepFailed(err);
    } finally {
      setPending(false);
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    if (!code.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      await api("/auth/mfa", { method: "POST", body: { code } });
      await qc.invalidateQueries({ queryKey: ["session"] });
    } catch (err) {
      setCode("");
      // A challenge that ran out (time or tries) starts again from the password.
      secondStepFailed(err);
    } finally {
      setPending(false);
    }
  }

  const codeForm = (
    <form onSubmit={submitCode} className="space-y-3" noValidate>
      <p className="text-center text-sm leading-6 text-fg-muted">{recovery ? t("login.recoveryHint") : t("login.codeHint")}</p>
      <label htmlFor="code" className="sr-only">
        {recovery ? t("login.recoveryCode") : t("login.code")}
      </label>
      <div className="relative">
        <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
        <input
          ref={codeRef}
          id="code"
          key={recovery ? "recovery" : "totp"}
          type="text"
          autoComplete="one-time-code"
          inputMode={recovery ? "text" : "numeric"}
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={recovery ? 24 : 8}
          autoFocus
          placeholder={recovery ? "XXXX-XXXX-XXXX-XXXX" : "123456"}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? "login-error" : undefined}
          className="h-12 w-full rounded-xl border border-border bg-surface pl-10 pr-3 text-[15px] tracking-widest shadow-sm placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>
      <Button type="submit" className="h-12 w-full justify-center rounded-xl text-[15px]" loading={pending} disabled={!code.trim()}>
        {t("login.verify")}
      </Button>
      {passkey && (
        <Button type="button" variant="outline" className="h-12 w-full justify-center rounded-xl text-[15px]" disabled={pending} onClick={() => void signInWithPasskey()}>
          <Fingerprint className="h-4 w-4" /> {t("login.usePasskey")}
        </Button>
      )}
      {error && (
        <p id="login-error" role="alert" className="text-center text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-between text-sm">
        <button type="button" className="text-fg-muted hover:text-fg" onClick={() => {
            setCodeStep(false);
            setError(null);
          }}>
          {t("login.back")}
        </button>
        <button type="button" className="text-accent hover:underline" onClick={() => {
            setRecovery((r) => !r);
            setCode("");
            setError(null);
          }}>
          {recovery ? t("login.useApp") : t("login.useRecovery")}
        </button>
      </div>
    </form>
  );

  return (
    <div className="flex min-h-full items-center justify-center bg-bg p-6">
      <div className="w-full max-w-[360px] animate-slide-up">
        <div className="mb-10 flex flex-col items-center text-center">
          <Logo className="h-12 w-12" />
          <h1 className="mt-5 font-display text-3xl font-bold tracking-tight">Axis</h1>
          <p className="mt-1.5 text-sm text-fg-muted">{t("login.tagline")}</p>
        </div>

        {!configured ? (
          <div role="alert" className="rounded-lg border border-border bg-surface p-4 text-sm leading-6 text-fg-muted">
            {rich("login.notConfigured", { command: <code className="rounded bg-muted px-1">npx create-talorys@latest</code> })}
          </div>
        ) : codeStep ? (
          codeForm
        ) : forgot ? (
          <form onSubmit={requestLink} className="space-y-3" noValidate>
            <h2 className="text-center text-base font-semibold">{t("login.recoverTitle")}</h2>
            {forgot === "sent" ? (
              <p role="status" className="rounded-lg border border-border bg-surface p-3 text-center text-sm leading-6 text-fg-muted">
                {t("login.recoverSent")}
              </p>
            ) : (
              <>
                <p className="text-center text-sm leading-6 text-fg-muted">{t("login.recoverHint")}</p>
                <div className="relative">
                  <label htmlFor="recover-email" className="sr-only">
                    {t("login.email")}
                  </label>
                  <AtSign className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
                  <input
                    id="recover-email"
                    type="email"
                    autoComplete="username"
                    autoFocus
                    placeholder={t("login.emailPlaceholder")}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-12 w-full rounded-xl border border-border bg-surface pl-10 pr-3 text-[15px] shadow-sm placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                {forgotKey && (
                  <TurnstileWidget
                    key={`${forgotKey}-${forgotRound}`}
                    siteKey={forgotKey}
                    action="recovery"
                    onToken={(value) => {
                      setForgotToken(value);
                      if (value) setHumanBroken(false);
                    }}
                    onError={() => setHumanBroken(true)}
                  />
                )}
                <Button
                  type="submit"
                  className="h-12 w-full justify-center rounded-xl text-[15px]"
                  loading={pending}
                  disabled={!email.trim() || (!!forgotKey && !forgotToken && !humanBroken)}
                >
                  {t("login.recoverSend")}
                </Button>
                {error && (
                  <p id="login-error" role="alert" className="text-center text-sm text-danger">
                    {error}
                  </p>
                )}
              </>
            )}
            <button
              type="button"
              className="w-full text-center text-sm text-fg-muted hover:text-fg"
              onClick={() => {
                setForgot(null);
                setError(null);
              }}
            >
              {t("login.recoverBack")}
            </button>
          </form>
        ) : (
          <form onSubmit={submit} className="space-y-3" noValidate>
            {endedReason && !error && (
              <p role="status" className="rounded-lg border border-border bg-surface p-3 text-center text-sm leading-6 text-fg-muted">
                {endedReason === "idle" ? t("login.endedIdle") : t("login.ended")}
              </p>
            )}
            {emailRequired && (
              <>
                <label htmlFor="email" className="sr-only">
                  {t("login.email")}
                </label>
                <div className="relative">
                  <AtSign className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
                  <input
                    id="email"
                    type="email"
                    autoComplete="username"
                    autoFocus
                    placeholder={t("login.emailPlaceholder")}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-invalid={!!error}
                    aria-describedby={error ? "login-error" : undefined}
                    className="h-12 w-full rounded-xl border border-border bg-surface pl-10 pr-3 text-[15px] shadow-sm placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                  />
                </div>
              </>
            )}
            <label htmlFor="password" className="sr-only">
              {t("login.password")}
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
              <input
                ref={inputRef}
                id="password"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                autoFocus={!emailRequired}
                placeholder={t("login.passwordPlaceholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!error}
                aria-describedby={error ? "login-error" : undefined}
                className="h-12 w-full rounded-xl border border-border bg-surface pl-10 pr-11 text-[15px] shadow-sm placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-fg-subtle hover:text-fg"
                aria-label={show ? t("login.hidePassword") : t("login.showPassword")}
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {humanKey !== null && (
              <div className="space-y-1.5">
                <p className="text-center text-sm leading-6 text-fg-muted">{humanBroken ? t("login.humanCheckBroken") : t("login.humanCheckHint")}</p>
                <TurnstileWidget
                  key={`${humanKey}-${humanRound}`}
                  siteKey={humanKey}
                  onToken={(value) => {
                    setHumanToken(value);
                    if (value) setHumanBroken(false);
                  }}
                  onError={() => setHumanBroken(true)}
                />
              </div>
            )}
            <Button
              type="submit"
              className="h-12 w-full justify-center rounded-xl text-[15px]"
              loading={pending}
              disabled={!password || (emailRequired && !email.trim()) || waitSeconds > 0 || humanMissing}
            >
              {waitSeconds > 0 ? t("login.tryAgainIn", { seconds: waitSeconds }) : t("login.unlock")}
            </Button>
            {error && (
              <p id="login-error" role="alert" className="text-center text-sm text-danger">
                {error}
              </p>
            )}
            {canRecover && (
              <button
                type="button"
                className="w-full text-center text-sm text-accent hover:underline"
                onClick={() => {
                  setForgot("form");
                  setError(null);
                }}
              >
                {t("login.forgot")}
              </button>
            )}
          </form>
        )}

        <p className="mt-10 text-center text-xs leading-5 text-fg-subtle">
          {rich("login.forgotPassword", {
            lineBreak: <br />,
            command: <code className="rounded bg-muted px-1">npx create-talorys@latest reset-password</code>,
          })}
        </p>
      </div>
    </div>
  );
}
