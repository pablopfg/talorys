import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button, Dialog, Input, Label } from "./ui";
import { api, ApiError, onReauthRequired } from "../lib/api";
import { useI18n } from "../lib/i18n";

/**
 * Asks for the password again when the server wants it for a sensitive action (export, import,
 * turning on remote access, a new access token). Once confirmed, the action retries by itself.
 */
export function ConfirmPasswordDialog() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
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
      await api("/auth/confirm", { method: "POST", body: { password } });
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
          <Label htmlFor="reauth-password">{t("reauth.password")}</Label>
          <Input id="reauth-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
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
