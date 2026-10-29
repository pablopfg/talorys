import { type ReactNode, useState } from "react";
import { GITHUB_URL, type RemoteScope, type RemoteTokenInfo, REMOTE_TOKEN_PREFIX } from "@talorys/shared";
import { Copy, KeyRound } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, ErrorNotice, Input, Label, Select, Switch } from "./ui";
import { keys, useApiMutation, useRemoteStatus, useRemoteTokens } from "../hooks/queries";
import { useToast } from "../hooks/toast";
import { api } from "../lib/api";
import { relativeTime } from "../lib/utils";
import { useI18n } from "../lib/i18n";

const DOCS_URL = `${GITHUB_URL}/blob/main/docs/remote-access.md`;

/** A ready-to-run request for the once-only panel, against this install. */
function curlExample(token: string): string {
  return `curl -H "Authorization: Bearer ${token}" ${window.location.origin}/api/tasks`;
}

function Row({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-xs leading-5 text-fg-subtle">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Settings card for personal access tokens: the on/off switch, a generate form, the once-only plaintext and the token list. */
export function RemoteAccessCard() {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const status = useRemoteStatus();
  const tokens = useRemoteTokens();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<RemoteScope>("read");
  // The plaintext lives only here: the create mutation returns the name, never the token.
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const enabled = status.data?.enabled === true;
  const list = tokens.data ?? [];

  const toggle = useApiMutation((on: boolean) => api<{ enabled: boolean }>("/remote/status", { method: "PATCH", body: { enabled: on } }), {
    invalidate: [keys.remoteStatus],
    success: (r) => (r.enabled ? t("remote.turnedOn") : t("remote.turnedOff")),
  });
  const create = useApiMutation(
    async (input: { name: string; scope: RemoteScope }) => {
      const r = await api<{ token: RemoteTokenInfo & { token: string } }>("/remote/tokens", { method: "POST", body: input });
      // Cleared with the panel's appearance, not after the list refetch: by then the owner may have typed the next name.
      setName("");
      setPlaintext(r.token.token);
      return r.token.name;
    },
    { invalidate: [keys.remoteTokens], success: (n) => t("remote.created", { name: n }) },
  );
  const revoke = useApiMutation((token: RemoteTokenInfo) => api(`/remote/tokens/${token.id}`, { method: "DELETE" }), {
    invalidate: [keys.remoteTokens],
    success: t("remote.revoked"),
  });
  const revokeAll = useApiMutation(() => api<{ revoked: number }>("/remote/tokens", { method: "DELETE" }), {
    invalidate: [keys.remoteTokens],
    success: (r) => t("remote.revokedCount", { count: r.revoked }),
    onSuccess: () => setConfirmAll(false),
  });

  async function copy(text: string, done = t("remote.tokenCopied")) {
    try {
      await navigator.clipboard.writeText(text);
      toast(done);
    } catch {
      toast(t("remote.copyFailed"), "error");
    }
  }

  const error = status.error ?? tokens.error;
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-fg-subtle">{t("remote.title")}</h2>
      <Card>
        <div className="divide-y divide-border">
          {error ? (
            <div className="px-5 py-4">
              <ErrorNotice error={error} onRetry={() => void Promise.all([status.refetch(), tokens.refetch()])} />
            </div>
          ) : !status.data ? null : (
            <>
              <Row
                label={
                  <span className="flex items-center gap-2">
                    {t("remote.title")} {!enabled && <Badge tone="warning">{t("remote.suspended")}</Badge>}
                  </span>
                }
                hint={
                  <>
                    {t("remote.description")}{" "}
                    <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                      {t("remote.howTo")}
                    </a>
                    {!enabled && (
                      <>
                        {" "}
                        {t("remote.suspendedHint")}
                      </>
                    )}
                  </>
                }
              >
                <Switch checked={enabled} onChange={(on) => toggle.mutate(on)} label={t("remote.title")} disabled={toggle.isPending} />
              </Row>
              <form
                className="space-y-3 px-5 py-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (enabled && name.trim()) create.mutate({ name: name.trim(), scope });
                }}
              >
                <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                  <div>
                    <Label htmlFor="remote-token-name">{t("remote.tokenName")}</Label>
                    <Input id="remote-token-name" value={name} maxLength={64} placeholder={t("remote.tokenNamePlaceholder")} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="remote-token-scope">{t("remote.scope")}</Label>
                    <Select id="remote-token-scope" value={scope} onChange={(e) => setScope(e.target.value as RemoteScope)}>
                      <option value="read">read</option>
                      <option value="write">write</option>
                    </Select>
                  </div>
                </div>
                {scope === "write" && <p className="text-xs leading-5 text-warning">{t("remote.writeHint")}</p>}
                <div className="flex justify-end">
                  <Button type="submit" loading={create.isPending} disabled={!enabled || !name.trim()}>
                    <KeyRound className="h-4 w-4" /> {t("remote.generate")}
                  </Button>
                </div>
              </form>
              {plaintext && (
                <div className="space-y-3 bg-subtle px-5 py-4" role="region" aria-label={t("remote.newToken")}>
                  <p className="text-sm font-medium text-warning">{t("remote.copyNow")}</p>
                  <code className="block break-all rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm">{plaintext}</code>
                  <p className="text-xs leading-5 text-fg-subtle">
                    {t("remote.useAsBearer")}{" "}
                    <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                      {t("remote.docs")}
                    </a>
                  </p>
                  <code
                    data-testid="remote-token-example"
                    className="block break-all rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs"
                  >
                    {curlExample(plaintext)}
                  </code>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => void copy(plaintext)}>
                      <Copy className="h-3.5 w-3.5" /> {t("chat.copy")}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void copy(curlExample(plaintext), t("remote.exampleCopied"))}>
                      <Copy className="h-3.5 w-3.5" /> {t("remote.copyExample")}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setPlaintext(null)}>
                      {t("memory.done")}
                    </Button>
                  </div>
                </div>
              )}
              {list.length === 0 ? (
                <p className="px-5 py-4 text-sm text-fg-subtle">{t("remote.empty")}</p>
              ) : (
                list.map((token) => (
                  <Row
                    key={token.id}
                    label={token.name}
                    hint={`${REMOTE_TOKEN_PREFIX}…${token.hint} · ${t("remote.tokenTimes", {
                      created: relativeTime(token.created_at, i18n),
                      used: token.last_used_at ? relativeTime(token.last_used_at, i18n) : t("remote.never"),
                    })} · ${t("remote.expires", { date: new Date(token.expires_at).toLocaleDateString(i18n.locale) })}`}
                  >
                    <div className="flex items-center gap-2">
                      <Badge tone={token.scope === "write" ? "warning" : "neutral"}>{token.scope}</Badge>
                      <Button variant="ghost" size="sm" aria-label={t("remote.revokeNamed", { name: token.name })} onClick={() => revoke.mutate(token)} disabled={revoke.isPending}>
                        {t("remote.revoke")}
                      </Button>
                    </div>
                  </Row>
                ))
              )}
              <div className="flex justify-between gap-2 px-5 py-3">
                <p className="self-center text-xs text-fg-subtle">
                  {t("remote.count", { count: list.length, max: status.data.max_tokens })}
                </p>
                <Button variant="outline" size="sm" className="text-danger" onClick={() => setConfirmAll(true)} disabled={list.length === 0}>
                  {t("remote.revokeAll")}
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>
      <ConfirmDialog
        open={confirmAll}
        title={t("remote.revokeAllTitle")}
        message={t("remote.revokeAllMessage")}
        confirmLabel={t("remote.revokeAll")}
        onCancel={() => setConfirmAll(false)}
        onConfirm={() => revokeAll.mutate(undefined)}
        loading={revokeAll.isPending}
      />
    </section>
  );
}
