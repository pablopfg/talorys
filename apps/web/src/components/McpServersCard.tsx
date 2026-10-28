import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { GITHUB_URL, type McpAuthType, type McpServerInfo, type McpServerStatus, type McpToolInfo, type McpToolPolicy } from "@talorys/shared";
import { ChevronDown, ChevronRight, LogIn, Plug, RefreshCw } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, ErrorNotice, Input, Label, Select, Spinner, Switch } from "./ui";
import { useToast } from "../hooks/toast";
import { keys, useApiMutation, useMcpServers, useMcpTools } from "../hooks/queries";
import { api } from "../lib/api";
import { cn } from "../lib/utils";
import { type I18n, type PlainMessageKey, useI18n } from "../lib/i18n";

const DOCS_URL = `${GITHUB_URL}/blob/main/docs/mcp.md`;

const STATUS: Record<McpServerStatus, { label: PlainMessageKey; tone: "neutral" | "success" | "warning" | "danger" }> = {
  connected: { label: "mcp.statusConnected", tone: "success" },
  connecting: { label: "mcp.statusConnecting", tone: "neutral" },
  auth_required: { label: "mcp.statusAuthRequired", tone: "warning" },
  disconnected: { label: "mcp.statusDisconnected", tone: "neutral" },
  disabled: { label: "mcp.statusOff", tone: "neutral" },
  error: { label: "mcp.statusError", tone: "danger" },
};

function Row({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-xs leading-5 text-fg-subtle">{hint}</div>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}

/** Opens a server's sign-in page. Only https pages are followed (plain http only for a local dev server). */
function openSignIn(url: string) {
  const target = new URL(url);
  const localDev = target.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
  if (target.protocol === "https:" || localDev) window.location.assign(target.href);
}

const AUTH_LABEL: Record<McpAuthType, PlainMessageKey> = { none: "mcp.authNone", bearer: "mcp.authBearer", oauth: "mcp.authOauth" };

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** Settings → Integrations: remote MCP servers and which of their tools Talorys may use. */
export function McpServersCard() {
  const { t } = useI18n();
  const overview = useMcpServers();
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const data = overview.data;
  const servers = data?.servers ?? [];

  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-fg-subtle">{t("mcp.title")}</h2>
      <Card>
        <div className="divide-y divide-border">
          {overview.error ? (
            <div className="px-5 py-4">
              <ErrorNotice error={overview.error} onRetry={() => void overview.refetch()} />
            </div>
          ) : !data ? null : !data.enabled ? (
            <Row label={t("mcp.off")} hint={t("mcp.offHint")} />
          ) : (
            <>
              <Row
                label={t("mcp.intro")}
                hint={
                  <>
                    {t("mcp.introHint")}{" "}
                    <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                      {t("mcp.howItWorks")}
                    </a>
                  </>
                }
              >
                {!adding && (
                  <Button size="sm" onClick={() => setAdding(true)}>
                    <Plug className="h-4 w-4" /> {t("mcp.add")}
                  </Button>
                )}
              </Row>
              {adding && (
                <AddServerForm
                  credentialsAvailable={data.credentials_available}
                  onDone={(server) => {
                    setAdding(false);
                    if (server) setOpen(server.id);
                  }}
                />
              )}
              {servers.length === 0 && !adding && <p className="px-5 py-4 text-sm text-fg-subtle">{t("mcp.empty")}</p>}
              {servers.map((s) => (
                <ServerRow
                  key={s.id}
                  server={s}
                  maxTools={data.max_tools}
                  credentialsAvailable={data.credentials_available}
                  open={open === s.id}
                  onToggle={() => setOpen(open === s.id ? null : s.id)}
                />
              ))}
            </>
          )}
        </div>
      </Card>
    </section>
  );
}

function AddServerForm({ credentialsAvailable, onDone }: { credentialsAvailable: boolean; onDone: (server: McpServerInfo | null) => void }) {
  const { t, rich } = useI18n();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [auth, setAuth] = useState<McpAuthType>("none");
  const [token, setToken] = useState("");
  const create = useApiMutation(
    (input: { name: string; url: string; auth_type: McpAuthType; token?: string }) => api<{ server: McpServerInfo }>("/mcp/servers", { method: "POST", body: input }),
    {
      invalidate: [keys.mcpServers],
      success: (r) =>
        r.server.status === "connected"
          ? t("mcp.connectedTo", { name: r.server.name })
          : r.server.authorize_url
            ? t("mcp.openingSignIn", { name: r.server.name })
            : t("mcp.savedNotConnected", { name: r.server.name }),
      onSuccess: (r) => {
        onDone(r.server);
        if (r.server.authorize_url) openSignIn(r.server.authorize_url);
      },
    },
  );
  const needsToken = auth === "bearer";
  const blocked = auth !== "none" && !credentialsAvailable;
  const ready = name.trim() && url.trim() && (!needsToken || token.trim()) && !blocked;
  return (
    <form
      className="space-y-3 bg-subtle px-5 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) create.mutate({ name: name.trim(), url: url.trim(), auth_type: auth, ...(needsToken ? { token: token.trim() } : {}) });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="mcp-name">{t("mcp.name")}</Label>
          <Input id="mcp-name" value={name} maxLength={64} placeholder={t("mcp.namePlaceholder")} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="mcp-auth">{t("mcp.auth")}</Label>
          <Select id="mcp-auth" value={auth} onChange={(e) => setAuth(e.target.value as McpAuthType)}>
            <option value="none">{t("mcp.authOptionNone")}</option>
            <option value="bearer">{t("mcp.authBearer")}</option>
            <option value="oauth">{t("mcp.authOptionOauth")}</option>
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="mcp-url" hint={t("mcp.urlHint")}>
          {t("mcp.url")}
        </Label>
        <Input id="mcp-url" type="url" inputMode="url" value={url} maxLength={2048} placeholder="https://example.com/mcp" onChange={(e) => setUrl(e.target.value)} />
      </div>
      {needsToken && (
        <div>
          <Label htmlFor="mcp-token" hint={t("mcp.tokenHint")}>
            {t("mcp.authBearer")}
          </Label>
          <Input id="mcp-token" type="password" autoComplete="off" value={token} maxLength={4096} onChange={(e) => setToken(e.target.value)} />
        </div>
      )}
      {auth === "oauth" && !blocked && (
        <p className="text-xs leading-5 text-fg-subtle">
          {t("mcp.oauthHint")}
        </p>
      )}
      {blocked && (
        <p className="text-xs leading-5 text-warning">
          {rich("mcp.noCredentials", { command: <code>npx create-talorys update</code> })}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => onDone(null)}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" size="sm" loading={create.isPending} disabled={!ready}>
          {t("mcp.connect")}
        </Button>
      </div>
    </form>
  );
}

function ServerRow({
  server,
  maxTools,
  credentialsAvailable,
  open,
  onToggle,
}: {
  server: McpServerInfo;
  maxTools: number;
  credentialsAvailable: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const { t, serverText } = useI18n();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [token, setToken] = useState("");
  const status = STATUS[server.status];
  const invalidate = [keys.mcpServers, keys.mcpTools(server.id)] as const;
  const connect = useApiMutation(() => api<{ server: McpServerInfo }>(`/mcp/servers/${server.id}/connect`, { method: "POST", body: {} }), {
    invalidate,
    success: (r) => (r.server.status === "connected" ? t("mcp.reconnected", { name: r.server.name }) : t("mcp.couldNotConnect", { name: r.server.name })),
  });
  const update = useApiMutation(
    (patch: { enabled?: boolean; token?: string }) => api<{ server: McpServerInfo }>(`/mcp/servers/${server.id}`, { method: "PATCH", body: patch }),
    { invalidate, onSuccess: () => setToken("") },
  );
  const remove = useApiMutation(() => api(`/mcp/servers/${server.id}`, { method: "DELETE" }), {
    invalidate: [keys.mcpServers],
    success: t("mcp.removed", { name: server.name }),
    onSuccess: () => setConfirmRemove(false),
  });
  const auth = t(server.auth_type === "bearer" ? (server.has_credential ? "mcp.tokenSet" : "mcp.tokenMissing") : AUTH_LABEL[server.auth_type]);
  return (
    <div>
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 items-start gap-2 text-left">
          {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" />}
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {server.name} <Badge tone={status.tone}>{t(status.label)}</Badge>
              {server.review_count > 0 && <Badge tone="warning">{t("mcp.toReview", { count: server.review_count })}</Badge>}
            </span>
            <span className="mt-0.5 block break-words text-xs leading-5 text-fg-subtle">
              {host(server.url)} · {t("mcp.toolsOn", { on: server.enabled_tool_count, total: server.tool_count })} · {auth}
            </span>
            {server.error && (
              <span className={cn("mt-0.5 block text-xs leading-5", server.status === "connected" ? "text-fg-muted" : "text-warning")}>{serverText(server.error)}</span>
            )}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {server.authorize_url && server.enabled && (
            <Button size="sm" onClick={() => openSignIn(server.authorize_url!)}>
              <LogIn className="h-3.5 w-3.5" /> {t("mcp.signIn")}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onToggle}>
            {t("mcp.manage")}
          </Button>
          <Button variant="ghost" size="sm" aria-label={t("mcp.reconnect", { name: server.name })} loading={connect.isPending} disabled={!server.enabled} onClick={() => connect.mutate(undefined)}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Switch checked={server.enabled} onChange={(on) => update.mutate({ enabled: on })} label={t("mcp.use", { name: server.name })} disabled={update.isPending} />
        </div>
      </div>
      {open && (
        <div className="space-y-4 border-t border-border bg-subtle px-5 py-4">
          <ToolList server={server} maxTools={maxTools} />
          {server.auth_type === "bearer" && (
            <form
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                if (token.trim()) update.mutate({ token: token.trim() });
              }}
            >
              <div className="flex-1">
                <Label htmlFor={`mcp-token-${server.id}`} hint={t("mcp.replaceTokenHint")}>
                  {server.has_credential ? t("mcp.replaceToken") : t("mcp.addToken")}
                </Label>
                <Input id={`mcp-token-${server.id}`} type="password" autoComplete="off" value={token} maxLength={4096} disabled={!credentialsAvailable} onChange={(e) => setToken(e.target.value)} />
              </div>
              <Button type="submit" variant="outline" size="sm" loading={update.isPending} disabled={!token.trim() || !credentialsAvailable}>
                {t("mcp.saveToken")}
              </Button>
            </form>
          )}
          <div className="flex justify-end">
            <Button variant="outline" size="sm" className="text-danger" onClick={() => setConfirmRemove(true)}>
              {t("mcp.removeServer")}
            </Button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmRemove}
        title={t("mcp.removeTitle", { name: server.name })}
        message={t("mcp.removeMessage")}
        confirmLabel={t("mcp.remove")}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => remove.mutate(undefined)}
        loading={remove.isPending}
      />
    </div>
  );
}

function hintText(tool: McpToolInfo, t: I18n["t"]): string | null {
  const { readOnly, destructive } = tool.hints;
  if (destructive) return t("mcp.hintDestructive");
  if (readOnly) return t("mcp.hintReadOnly");
  return null;
}

function ToolList({ server, maxTools }: { server: McpServerInfo; maxTools: number }) {
  const { t, serverText } = useI18n();
  const tools = useMcpTools(server.id);
  const save = useApiMutation(
    ({ tool, patch }: { tool: McpToolInfo; patch: { enabled?: boolean; policy?: McpToolPolicy } }) =>
      api<{ tool: McpToolInfo }>(`/mcp/servers/${server.id}/tools/${tool.id}`, { method: "PATCH", body: patch }),
    { invalidate: [keys.mcpServers, keys.mcpTools(server.id)] },
  );
  if (tools.error) return <ErrorNotice error={tools.error} onRetry={() => void tools.refetch()} />;
  if (!tools.data) return null;
  if (tools.data.length === 0) {
    return <p className="text-sm text-fg-subtle">{server.status === "connected" ? t("mcp.noTools") : t("mcp.connectToSee")}</p>;
  }
  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-fg-subtle">
        {t("mcp.toolsHint", { max: maxTools })}
      </p>
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {tools.data.map((tool) => {
          const hint = hintText(tool, t);
          const usable = tool.status === "available";
          return (
            <li key={tool.id} className="space-y-2 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 break-all text-sm font-medium">
                    {tool.title ?? tool.name}
                    {tool.title && <span className="font-mono text-xs font-normal text-fg-subtle">{tool.name}</span>}
                    {tool.status === "removed" && <Badge>{t("mcp.toolRemoved")}</Badge>}
                    {tool.status === "invalid" && <Badge tone="danger">{t("mcp.toolInvalid")}</Badge>}
                    {tool.needs_review && <Badge tone="warning">{t("mcp.toolChanged")}</Badge>}
                  </p>
                  {tool.description && <p className="mt-0.5 line-clamp-3 break-words text-xs leading-5 text-fg-muted">{tool.description}</p>}
                  {tool.invalid_reason && <p className="mt-0.5 text-xs leading-5 text-danger">{serverText(tool.invalid_reason)}</p>}
                  {tool.needs_review && <p className="mt-0.5 text-xs leading-5 text-warning">{t("mcp.toolChangedHint")}</p>}
                  {hint && <p className="mt-0.5 text-xs leading-5 text-fg-subtle">{hint}</p>}
                </div>
                <Switch
                  checked={tool.enabled && !tool.needs_review}
                  onChange={(on) => save.mutate({ tool, patch: { enabled: on } })}
                  label={t("mcp.use", { name: tool.name })}
                  disabled={save.isPending || (!usable && !tool.enabled)}
                />
              </div>
              {tool.enabled && usable && (
                <div className="space-y-1">
                  <Select
                    aria-label={t("mcp.policyLabel", { name: tool.name })}
                    value={tool.policy}
                    className="sm:w-64"
                    disabled={save.isPending}
                    onChange={(e) => save.mutate({ tool, patch: { policy: e.target.value as McpToolPolicy } })}
                  >
                    <option value="approve">{t("mcp.policyApprove")}</option>
                    <option value="auto">{t("mcp.policyAuto")}</option>
                  </Select>
                  {tool.policy === "auto" && <p className="text-xs leading-5 text-warning">{t("mcp.autoWarning")}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Where an MCP server's OAuth sign-in returns. It forwards the code and state to the backend with
 * the owner's session (the cross-site redirect itself carries no session cookie), then goes back
 * to Settings.
 */
export function McpOAuthCallback() {
  const { t, serverText } = useI18n();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const sent = useRef(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    const state = params.get("state");
    if (!state) {
      setError(new Error(t("mcp.callbackNoState")));
      return;
    }
    const pick = (k: string) => {
      const v = params.get(k);
      return v ? { [k]: v } : {};
    };
    api<{ server: McpServerInfo }>("/mcp/oauth/callback", { method: "POST", body: { state, ...pick("code"), ...pick("iss"), ...pick("error") } })
      .then(async ({ server }) => {
        await qc.invalidateQueries({ queryKey: keys.mcpServers });
        if (server.status === "connected") toast(t("mcp.signedIn", { name: server.name }));
        else toast(server.error ? serverText(server.error) : t("mcp.signInFailed", { name: server.name }), "error");
        navigate("/settings?tab=Integrations", { replace: true });
      })
      .catch(setError);
  }, [params, navigate, toast, qc, t, serverText]);

  return (
    <div className="mx-auto w-full max-w-md px-4 py-16">
      {error ? (
        <div className="space-y-4">
          <ErrorNotice error={error} />
          <Link to="/settings?tab=Integrations" className="text-sm text-accent hover:underline">
            {t("mcp.backToIntegrations")}
          </Link>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-sm text-fg-muted">
          <Spinner />
          {t("mcp.finishing")}
        </div>
      )}
    </div>
  );
}
