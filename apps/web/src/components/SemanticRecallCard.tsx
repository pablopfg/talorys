import { type ReactNode, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Trash2 } from "lucide-react";
import { Button, Card, ConfirmDialog, ErrorNotice, Input, Switch } from "./ui";
import { useApiMutation } from "../hooks/queries";
import { api } from "../lib/api";
import { statusRefetchInterval } from "./semanticPolling";
import { isValidCap } from "./semanticCaps";
import { type PlainMessageKey, useI18n } from "../lib/i18n";

// Local mirrors of the /api/semantic/* responses (apps/agent/src/semantic/routes.ts).
interface SemanticConfig {
  enabled: boolean;
  model: string;
  maxEmbeddingsPerDay: number;
  maxItemEmbeddingsPerDay: number;
}

interface SemanticStatus {
  enabled: boolean;
  ever_enabled: boolean;
  embedder: "workers-ai" | "mock" | "none";
  vectors: number;
  pending: number;
  embeddings_today: number;
  cap: number;
  items?: { vectors: number; pending: number; by_type: { task: number; note: number; automation: number }; items_today: number; items_cap: number; indexing: boolean };
}

interface ReindexReport {
  embedded: number;
  pending: number;
  capped: boolean;
  error?: string;
  surfaces?: { embedded: number; pending: number };
}

const DEFAULT_CAP = 500;
const DEFAULT_ITEM_CAP = 50;
const EMBEDDERS: Record<SemanticStatus["embedder"], PlainMessageKey> = { "workers-ai": "semantic.embedderWorkersAi", mock: "semantic.embedderMock", none: "settings.notAvailable" };

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-xs leading-5 text-fg-subtle">{hint}</p>}
      </div>
      <div className="shrink-0 sm:w-64">{children}</div>
    </div>
  );
}

/**
 * Settings card for semantic memory recall: the opt-in switch, the daily embedding cap,
 * index status (polled while memories are pending or an item pass runs) and the reindex and delete actions.
 */
export function SemanticRecallCard() {
  const { t, rich } = useI18n();
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const config = useQuery({
    queryKey: ["semantic", "config"],
    queryFn: () => api<{ config: SemanticConfig | null; ever_enabled: boolean }>("/semantic/config"),
  });
  const enabled = config.data?.config?.enabled === true;
  const status = useQuery({
    queryKey: ["semantic", "status"],
    queryFn: () => api<SemanticStatus>("/semantic/status"),
    enabled,
    refetchOnMount: "always",
    refetchInterval: (q) => statusRefetchInterval(q.state.data),
  });
  const savedCap = config.data?.config?.maxEmbeddingsPerDay ?? DEFAULT_CAP;
  const [cap, setCap] = useState(savedCap);
  useEffect(() => setCap(savedCap), [savedCap]);
  const savedItemCap = config.data?.config?.maxItemEmbeddingsPerDay ?? DEFAULT_ITEM_CAP;
  const [itemCapInput, setItemCapInput] = useState(savedItemCap);
  useEffect(() => setItemCapInput(savedItemCap), [savedItemCap]);
  const savedModel = config.data?.config?.model ?? "";
  const [model, setModel] = useState(savedModel);
  useEffect(() => setModel(savedModel), [savedModel]);

  const saveConfig = useApiMutation((patch: Partial<SemanticConfig>) => api<{ config: SemanticConfig }>("/semantic/config", { method: "PUT", body: patch }), {
    success: (r) => (r.config.enabled ? t("semantic.saved") : t("semantic.turnedOff")),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["semantic"] }),
  });
  const reindex = useApiMutation(() => api<ReindexReport>("/semantic/reindex", { method: "POST" }), {
    invalidate: [["semantic"]],
    success: (r) => t("semantic.reindexed", { embedded: r.embedded, pending: r.pending }),
  });
  const wipe = useApiMutation(() => api("/semantic/data", { method: "DELETE", body: { confirm: "DELETE" } }), {
    invalidate: [["semantic"]],
    success: t("semantic.deleted"),
    onSuccess: () => setConfirmDelete(false),
  });

  const validCap = isValidCap(cap);
  const submitCap = () => {
    if (validCap && cap !== savedCap) saveConfig.mutate({ maxEmbeddingsPerDay: cap });
  };
  const validItemCap = isValidCap(itemCapInput);
  const submitItemCap = () => {
    if (validItemCap && itemCapInput !== savedItemCap) saveConfig.mutate({ maxItemEmbeddingsPerDay: itemCapInput });
  };
  const s = status.data;
  const itemCap = s?.items?.items_cap ?? DEFAULT_ITEM_CAP;
  // The first item names the stat for tests (data-stat) and stays in English.
  const stats: [string, string, string][] = s
    ? [
        ["Embedder", t("semantic.embedder"), EMBEDDERS[s.embedder] ? t(EMBEDDERS[s.embedder]) : s.embedder],
        ["Vectors", t("semantic.vectors"), String(s.vectors)],
        ["Pending", t("semantic.pending"), String(s.pending)],
        ["Embeddings today", t("semantic.embeddingsToday"), `${s.embeddings_today} / ${s.cap}`],
      ]
    : [["Status", t("semantic.status"), t("semantic.loading")]];
  const itemsIndexed = s?.items ? s.items.by_type.task + s.items.by_type.note + s.items.by_type.automation : 0;
  const itemsPending = s?.items?.pending ?? 0;
  const busy = reindex.isPending || wipe.isPending;

  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-fg-subtle">{t("semantic.title")}</h2>
      <Card>
        <div className="divide-y divide-border">
          <Row label={t("semantic.title")} hint={t("semantic.hint", { cap: savedCap, itemCap })}>
            <div className="flex justify-end">
              <Switch
                checked={enabled}
                onChange={(v) => saveConfig.mutate({ enabled: v })}
                label={t("semantic.title")}
                disabled={config.isLoading || saveConfig.isPending}
              />
            </div>
          </Row>
          {config.error && (
            <div className="px-5 py-4">
              <ErrorNotice error={config.error} onRetry={() => void config.refetch()} />
            </div>
          )}
          {enabled && (
            <>
              {status.error ? (
                <div className="px-5 py-4">
                  <ErrorNotice error={status.error} onRetry={() => void status.refetch()} />
                </div>
              ) : (
                <div role="group" aria-label={t("semantic.statusLabel")} className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
                  {stats.map(([id, label, value]) => (
                    <div key={id} className="bg-surface px-5 py-4">
                      <p className="text-xs text-fg-subtle">{label}</p>
                      <p className="mt-1 truncate text-sm font-medium tabular-nums" data-stat={id} title={value}>
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {s && !status.error && (
                <div className="flex items-center justify-between gap-3 px-5 py-4 text-sm">
                  <p className="text-xs text-fg-subtle">{t("semantic.items")}</p>
                  <p className="font-medium tabular-nums">
                    {rich("semantic.itemsIndexed", { indexed: itemsIndexed, pending: <span data-stat="Items pending">{itemsPending}</span> })}
                  </p>
                </div>
              )}
              {s?.items && !status.error && (
                <div className="flex items-center justify-between gap-3 px-5 py-4 text-sm">
                  <p className="text-xs text-fg-subtle">{t("semantic.itemEmbeddingsToday")}</p>
                  <p className="font-medium tabular-nums" data-stat="Item embeddings today">
                    {s.items.items_today} / {itemCap}
                  </p>
                </div>
              )}
              <Row label={t("semantic.model")} hint={t("semantic.modelHint", { model: "@cf/baai/bge-m3" })}>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (model.trim() !== savedModel) saveConfig.mutate({ model: model.trim() });
                  }}
                >
                  <Input value={model} onChange={(e) => setModel(e.target.value)} aria-label={t("semantic.modelId")} className="font-mono text-xs" />
                  <Button type="submit" variant="outline" disabled={!model.trim() || model.trim() === savedModel}>
                    {t("common.save")}
                  </Button>
                </form>
              </Row>
              <Row label={t("semantic.cap")} hint={t("semantic.capHint")}>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitCap();
                  }}
                >
                  <Input type="number" min={0} max={10_000} step={1} value={cap} onChange={(e) => setCap(Number(e.target.value))} onBlur={submitCap} aria-label={t("semantic.cap")} />
                  <Button type="submit" variant="outline" disabled={!validCap || cap === savedCap} loading={saveConfig.isPending}>
                    {t("common.save")}
                  </Button>
                </form>
              </Row>
              <Row label={t("semantic.itemCap")} hint={t("semantic.itemCapHint")}>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitItemCap();
                  }}
                >
                  <Input
                    type="number"
                    min={0}
                    max={10_000}
                    step={1}
                    value={itemCapInput}
                    onChange={(e) => setItemCapInput(Number(e.target.value))}
                    onBlur={submitItemCap}
                    aria-label={t("semantic.itemCap")}
                  />
                  <Button type="submit" variant="outline" disabled={!validItemCap || itemCapInput === savedItemCap} loading={saveConfig.isPending}>
                    {t("common.save")}
                  </Button>
                </form>
              </Row>
              <Row label={t("semantic.reindex")} hint={t("semantic.reindexHint")}>
                <Button variant="outline" className="w-full justify-center" loading={reindex.isPending} disabled={busy} onClick={() => reindex.mutate(undefined)}>
                  <RefreshCw className="h-4 w-4" /> {t("semantic.reindex")}
                </Button>
              </Row>
            </>
          )}
          {config.data?.ever_enabled && (
            <Row label={t("semantic.delete")} hint={t("semantic.deleteHint")}>
              <Button variant="outline" className="w-full justify-center text-danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4" /> {t("semantic.delete")}
              </Button>
            </Row>
          )}
        </div>
      </Card>
      <ConfirmDialog
        open={confirmDelete}
        title={t("semantic.deleteTitle")}
        message={t("semantic.deleteHint")}
        confirmLabel={t("common.delete")}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => wipe.mutate(undefined)}
        loading={wipe.isPending}
      />
    </section>
  );
}
