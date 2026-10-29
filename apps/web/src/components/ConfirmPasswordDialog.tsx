import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button, Dialog, Input, Label } from "./ui";
import { api, ApiError, onReauthRequired } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useMfaStatus } from "../hooks/queries";

/**
 * Asks for the password again when the server wants it for a sensitive action (export, import,
 * turning on remote access, a new access token). With two-step sign-in on, a code from the
 * authenticator app works too. Once confirmed, the action retries by itself.
 */
export function ConfirmPasswordDialog() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [useCode, setUseCode] = useState(false);
  const mfa = useMfaStatus(open);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  useEffect(
    () =>
      onReauthRequired(
        () =>
          new Promise<boolean>((resolve) => {
            resolver.current?.(false);
            resolver.current = resolve;
            setPassword("");
            setUseCode(false);
            setError(null);
            setOpen(true);
          }),
      ),
    [],
  );

  const finish = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpen(false);
    setPassword("");
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await api("/auth/confirm", { method: "POST", body: useCode ? { code: password } : { password } });
      finish(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={() => finish(false)} title={t("reauth.title")}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm leading-6 text-fg-muted">{t("reauth.description")}</p>
        <div>
          <Label htmlFor="reauth-password">{t(useCode ? "reauth.code" : "reauth.password")}</Label>
          {useCode ? (
            <Input id="reauth-password" key="code" autoComplete="one-time-code" inputMode="numeric" maxLength={10} autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          ) : (
            <Input id="reauth-password" key="password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          )}
          {mfa.data?.enabled && (
            <button
              type="button"
              className="mt-2 text-xs text-fg-muted underline-offset-2 hover:text-fg hover:underline"
              onClick={() => {
                setUseCode(!useCode);
                setPassword("");
                setError(null);
              }}
            >
              {t(useCode ? "reauth.usePassword" : "reauth.useCode")}
            </button>
          )}
          {error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => finish(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" loading={busy} disabled={!password}>
            {t("reauth.confirm")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
