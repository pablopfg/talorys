import { type FormEvent, useState } from "react";
import { checkPasswordStrength } from "@talorys/shared";
import { KeyRound } from "lucide-react";
import { Logo } from "../components/Logo";
import { Button, Input, Label } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { cn } from "../lib/utils";
import { useI18n } from "../lib/i18n";

/**
 * The page the "forgot password" e-mail opens. The token rides in the URL fragment, which browsers
 * never send to a server; it is read once and dropped from the address bar and history.
 */
function takeToken(): string {
  const token = window.location.hash.slice(1);
  if (token) window.history.replaceState(null, "", window.location.pathname);
  return token;
}

export function RecoverPage() {
  const i18n = useI18n();
  const { t } = i18n;
  const [token] = useState(takeToken);
  const [next, setNext] = useState("");
  const [confirmNext, setConfirmNext] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const problem = next ? checkPasswordStrength(next, []) : null;
  const strength = problem && i18n.serverText(problem);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (next !== confirmNext) return setError(t("settings.passwordsMismatch"));
    if (strength) return setError(strength);
    setPending(true);
    setError(null);
    try {
      await api("/auth/recovery/complete", { method: "POST", body: { token, new_password: next, ...(needCode && code ? { code } : {}) } });
      setDone(true);
    } catch (err) {
      const detail = err instanceof ApiError ? (err.details as { recovery?: string } | undefined)?.recovery : undefined;
      if (detail === "code_required") {
        // The link is good; the second step comes next. The first time it is a step, not an error.
        if (needCode) setError(err instanceof Error ? err.message : t("login.failed"));
        setNeedCode(true);
        setCode("");
      } else {
        if (detail === "expired") setExpired(true);
        setError(err instanceof Error ? err.message : t("login.failed"));
      }
    } finally {
      setPending(false);
    }
  }

  const toSignIn = (
    <Button className="h-12 w-full justify-center rounded-xl text-[15px]" onClick={() => window.location.assign("/")}>
      {t("recover.toSignIn")}
    </Button>
  );

  return (
    <div className="flex min-h-full items-center justify-center bg-bg p-6">
      <div className="w-full max-w-[360px] animate-slide-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="h-12 w-12" />
          <h1 className="mt-5 font-display text-2xl font-semibold tracking-tight">{t("recover.title")}</h1>
        </div>
        {done ? (
          <div className="space-y-4">
            <p role="status" className="rounded-lg border border-border bg-surface p-3 text-center text-sm leading-6 text-fg-muted">
              {t("recover.done")}
            </p>
            {toSignIn}
          </div>
        ) : !token || expired ? (
          <div className="space-y-4">
            <p role="alert" className="rounded-lg border border-border bg-surface p-3 text-center text-sm leading-6 text-fg-muted">
              {expired && error ? error : t("recover.missing")}
            </p>
            {toSignIn}
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4" noValidate>
            <p className="text-center text-sm leading-6 text-fg-muted">{t("recover.hint")}</p>
            <input type="text" autoComplete="username" value="owner" readOnly hidden />
            <div>
              <Label htmlFor="recover-new">{t("settings.newPassword")}</Label>
              <Input id="recover-new" type="password" autoComplete="new-password" autoFocus value={next} onChange={(e) => setNext(e.target.value)} />
              {next && <p className={cn("mt-1 text-xs", strength ? "text-warning" : "text-success")}>{strength ?? t("settings.strongEnough")}</p>}
            </div>
            <div>
              <Label htmlFor="recover-confirm">{t("settings.confirmPassword")}</Label>
              <Input id="recover-confirm" type="password" autoComplete="new-password" value={confirmNext} onChange={(e) => setConfirmNext(e.target.value)} />
            </div>
            {needCode && (
              <div>
                <p className="mb-2 text-sm leading-6 text-fg-muted">{t("recover.codeHint")}</p>
                <Label htmlFor="recover-code">{t("recover.code")}</Label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
                  <Input
                    id="recover-code"
                    className="pl-9 tracking-widest"
                    autoComplete="one-time-code"
                    autoCapitalize="characters"
                    spellCheck={false}
                    maxLength={24}
                    autoFocus
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </div>
              </div>
            )}
            {error && (
              <p role="alert" className="text-center text-sm text-danger">
                {error}
              </p>
            )}
            <Button
              type="submit"
              className="h-12 w-full justify-center rounded-xl text-[15px]"
              loading={pending}
              disabled={!next || !confirmNext || (needCode && !code.trim())}
            >
              {t("recover.submit")}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
