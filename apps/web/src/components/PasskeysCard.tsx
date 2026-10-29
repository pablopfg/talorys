import { type FormEvent, useState } from "react";
import { MAX_PASSKEYS, PASSKEY_NAME_MAX, type PasskeyInfo } from "@talorys/shared";
import { startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { useQueryClient } from "@tanstack/react-query";
import { Fingerprint, Trash2 } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, Input, Label, Spinner } from "./ui";
import { keys, useApiMutation, usePasskeys } from "../hooks/queries";
import { errorMessage, useToast } from "../hooks/toast";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/utils";
import { useI18n } from "../lib/i18n";

/** A cancelled or timed-out browser prompt: nothing to report beyond "try again". */
function cancelled(error: unknown): boolean {
  return error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError");
}

/**
 * Settings → Security: passkeys as a second sign-in step, next to the authenticator app. Shown
 * only while two-step sign-in is on, whose recovery codes are the way back if they're all lost.
 */
export function PasskeysCard({ timezone }: { timezone: string }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const passkeys = usePasskeys();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<PasskeyInfo | null>(null);
  const supported = browserSupportsWebAuthn();

  const refresh = () => Promise.all([keys.passkeys, keys.authActivity].map((key) => qc.invalidateQueries({ queryKey: key })));
  const remove = useApiMutation((id: string) => api(`/auth/passkeys/${encodeURIComponent(id)}`, { method: "DELETE" }), {
    success: t("passkeys.removed"),
    onSuccess: () => {
      setRemoving(null);
      void refresh();
    },
  });

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { options } = await api<{ options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>("/auth/passkeys/options", { method: "POST", body: {} });
      const response = await startRegistration({ optionsJSON: options });
      await api("/auth/passkeys", { method: "POST", body: { name: name.trim(), response } });
      setAdding(false);
      setName("");
      toast(t("passkeys.added"));
      void refresh();
    } catch (err) {
      setError(cancelled(err) ? t("passkeys.cancelled") : errorMessage(err, t("common.somethingWentWrong")));
    } finally {
      setBusy(false);
    }
  }

  const list = passkeys.data ?? [];
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-fg-subtle">{t("passkeys.title")}</h2>
      <Card>
        {passkeys.isLoading ? (
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        ) : (
          <div className="divide-y divide-border">
            <p className="px-5 py-4 text-sm leading-6 text-fg-muted">{supported ? t("passkeys.intro") : t("passkeys.unsupported")}</p>
            {list.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="flex min-w-0 items-start gap-3">
                  <Fingerprint className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" />
                  <div className="min-w-0 text-sm">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      <span className="truncate">{p.name}</span>
                      {p.synced && <Badge>{t("passkeys.synced")}</Badge>}
                      {!p.usable_here && <Badge tone="warning">{t("passkeys.otherAddress")}</Badge>}
                    </p>
                    <p className="text-xs text-fg-subtle">
                      {p.last_used_at
                        ? t("passkeys.lastUsed", { date: formatDateTime(p.last_used_at, timezone, locale) })
                        : t("passkeys.addedOn", { date: formatDateTime(p.created_at, timezone, locale) })}
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" aria-label={t("passkeys.removeLabel", { name: p.name })} onClick={() => setRemoving(p)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {supported &&
              (adding ? (
                <form onSubmit={add} className="space-y-3 px-5 py-4">
                  <div>
                    <Label htmlFor="passkey-name" hint={t("passkeys.nameHint")}>
                      {t("passkeys.name")}
                    </Label>
                    <Input id="passkey-name" autoFocus maxLength={PASSKEY_NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
                    {error && (
                      <p role="alert" className="mt-2 text-sm text-danger">
                        {error}
                      </p>
                    )}
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setAdding(false);
                        setError(null);
                      }}
                    >
                      {t("common.cancel")}
                    </Button>
                    <Button type="submit" loading={busy} disabled={!name.trim()}>
                      {t("passkeys.create")}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex justify-end px-5 py-3">
                  <Button variant="outline" size="sm" disabled={list.length >= MAX_PASSKEYS} onClick={() => setAdding(true)}>
                    <Fingerprint className="h-3.5 w-3.5" /> {t("passkeys.add")}
                  </Button>
                </div>
              ))}
          </div>
        )}
      </Card>
      <ConfirmDialog
        open={!!removing}
        title={t("passkeys.removeTitle")}
        message={t("passkeys.removeMessage", { name: removing?.name ?? "" })}
        confirmLabel={t("passkeys.remove")}
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
}
