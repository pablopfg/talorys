import { useEffect, useState } from "react";
import { checkPasswordStrength } from "@talorys/shared";
import { Button, Input, Label } from "./ui";
import { useApiMutation, keys } from "../hooks/queries";
import { api, ApiError } from "../lib/api";
import { cn } from "../lib/utils";
import { useI18n } from "../lib/i18n";

/**
 * Current password, new password twice. The strength hint follows the server's rule; the server
 * still decides (breach check, the owner's e-mail address) and its refusal shows under the form.
 */
export function ChangePasswordForm({ agentName, onChanged }: { agentName?: string; onChanged?: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmNext, setConfirmNext] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const problem = next ? checkPasswordStrength(next, agentName ? [agentName] : []) : null;
  const strength = problem && i18n.serverText(problem);
  const change = useApiMutation(() => api("/auth/password", { method: "POST", body: { current_password: current, new_password: next } }), {
    invalidate: [keys.sessions],
    success: t("settings.passwordChanged"),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setConfirmNext("");
      onChanged?.();
    },
  });
  useEffect(() => setFormError(change.error instanceof ApiError ? change.error.message : null), [change.error]);

  return (
    <form
      className="space-y-4 px-5 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (next !== confirmNext) return setFormError(t("settings.passwordsMismatch"));
        if (strength) return setFormError(strength);
        setFormError(null);
        change.mutate(undefined);
      }}
    >
      <input type="text" autoComplete="username" value="owner" readOnly hidden />
      <div>
        <Label htmlFor="pw-current">{t("settings.currentPassword")}</Label>
        <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="pw-new">{t("settings.newPassword")}</Label>
          <Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          {next && <p className={cn("mt-1 text-xs", strength ? "text-warning" : "text-success")}>{strength ?? t("settings.strongEnough")}</p>}
        </div>
        <div>
          <Label htmlFor="pw-confirm">{t("settings.confirmPassword")}</Label>
          <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirmNext} onChange={(e) => setConfirmNext(e.target.value)} />
        </div>
      </div>
      {formError && <p className="text-sm text-danger">{formError}</p>}
      <div className="flex justify-end">
        <Button type="submit" loading={change.isPending} disabled={!current || !next || !confirmNext}>
          {t("settings.changePassword")}
        </Button>
      </div>
    </form>
  );
}
