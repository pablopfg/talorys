import { useState } from "react";
import type { StorageKind, TrashItem } from "@talorys/shared";
import { RotateCcw, Trash2 } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, ErrorNotice, Spinner, Switch } from "./ui";
import { keys, useApiMutation, useSettings, useStorage, useTrash } from "../hooks/queries";
import { api } from "../lib/api";
import { cn, relativeTime } from "../lib/utils";
import { type PlainMessageKey, useI18n } from "../lib/i18n";

const KIND_LABELS: Record<StorageKind, PlainMessageKey> = {
  memories: "storage.kind.memories",
  tasks: "storage.kind.tasks",
  notes: "storage.kind.notes",
  projects: "storage.kind.projects",
  conversations: "storage.kind.conversations",
  messages: "storage.kind.messages",
  automations: "storage.kind.automations",
};
const ITEM_LABELS: Record<TrashItem["kind"], PlainMessageKey> = { memory: "storage.itemKind.memory", task: "storage.itemKind.task", note: "storage.itemKind.note" };
const REASON_LABELS: Record<TrashItem["reason"], PlainMessageKey> = { deleted: "storage.reason.deleted", archived: "storage.reason.archived", compacted: "storage.reason.compacted" };

function formatBytes(bytes: number, locale: string): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit < 2 ? 0 : 1 }).format(value)} ${units[unit]}`;
}

function Meter({ label, detail, ratio }: { label: string; detail: string; ratio: number }) {
  const pct = Math.min(100, Math.round(ratio * 100));
  return (
    <div className="px-5 py-3">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-xs tabular-nums text-fg-subtle">{detail}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn("h-full rounded-full", ratio >= 0.8 ? "bg-danger" : "bg-accent")} style={{ width: `${Math.max(pct, ratio > 0 ? 1 : 0)}%` }} />
      </div>
    </div>
  );
}

/** Privacy tab: how full each kind of data is, and the trash with restore and permanent delete. */
export function StorageCard() {
  const i18n = useI18n();
  const { t } = i18n;
  const storage = useStorage();
  const trash = useTrash();
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState<TrashItem | null>(null);
  const invalidate = [keys.storage, keys.tasks, ["memories"], ["notes"]] as const;
  const restore = useApiMutation((id: string) => api(`/trash/${encodeURIComponent(id)}/restore`, { method: "POST" }), {
    invalidate,
    success: t("storage.restored"),
  });
  const purge = useApiMutation((id: string) => api(`/trash/${encodeURIComponent(id)}`, { method: "DELETE" }), {
    invalidate: [keys.storage],
    onSuccess: () => setConfirmPurge(null),
  });
  const empty = useApiMutation(() => api<{ deleted: number }>("/trash", { method: "DELETE", body: { confirm: "DELETE" } }), {
    invalidate: [keys.storage],
    success: (r) => t("settings.deletedItems", { count: r.deleted }),
    onSuccess: () => setConfirmEmpty(false),
  });

  const settings = useSettings();
  const autoCleanup = useApiMutation((on: boolean) => api("/settings", { method: "PATCH", body: { autoCleanup: on } }), {
    invalidate: [keys.settings],
    success: t("settings.saved"),
  });
  const usage = storage.data?.storage;
  const retention = storage.data?.retention;
  const items = trash.data ?? [];
  const warned = usage?.warnings.map((w) => (w === "bytes" ? t("storage.database") : t(KIND_LABELS[w]))) ?? [];
  const busy = restore.isPending || purge.isPending;

  return (
    <>
      <section className="space-y-2">
        <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-fg-subtle">{t("storage.title")}</h2>
        <Card>
          <div className="divide-y divide-border">
            <div className="px-5 py-4 text-sm leading-6 text-fg-muted">{t("storage.description")}</div>
            {warned.length > 0 && (
              <div role="alert" className="bg-danger-soft px-5 py-3 text-sm text-danger">
                {t("storage.warning", { kinds: warned.join(", ") })}
              </div>
            )}
            {storage.error ? (
              <div className="px-5 py-4">
                <ErrorNotice error={storage.error} onRetry={() => void storage.refetch()} />
              </div>
            ) : !usage ? (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            ) : (
              <div className="py-1">
                {usage.kinds.map((k) => (
                  <Meter key={k.kind} label={t(KIND_LABELS[k.kind])} detail={t("storage.of", { count: k.count, limit: k.limit })} ratio={k.count / k.limit} />
                ))}
                {usage.bytes !== null && (
                  <Meter
                    label={t("storage.database")}
                    detail={t("storage.bytesOf", { used: formatBytes(usage.bytes, i18n.locale), limit: formatBytes(usage.max_bytes, i18n.locale) })}
                    ratio={usage.bytes / usage.max_bytes}
                  />
                )}
              </div>
            )}
            <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t("storage.autoCleanup")}</p>
                <p className="mt-0.5 text-xs leading-5 text-fg-subtle">{t("storage.autoCleanupHint")}</p>
                {retention && (retention.last_cleanup || retention.last_compaction) && (
                  <p className="mt-1 text-xs text-fg-subtle">
                    {t("storage.lastRuns", {
                      cleanup: retention.last_cleanup ? relativeTime(retention.last_cleanup, i18n) : t("storage.never"),
                      compaction: retention.last_compaction ? relativeTime(retention.last_compaction, i18n) : t("storage.never"),
                    })}
                  </p>
                )}
              </div>
              <Switch
                checked={settings.data?.autoCleanup ?? true}
                disabled={!settings.data || autoCleanup.isPending}
                onChange={(on) => autoCleanup.mutate(on)}
                label={t("storage.autoCleanup")}
              />
            </div>
          </div>
        </Card>
      </section>
      <section className="space-y-2">
        <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-fg-subtle">{t("storage.trash")}</h2>
        <Card>
          <div className="divide-y divide-border">
            <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm leading-6 text-fg-muted">{t("storage.trashDescription")}</p>
              <Button
                variant="outline"
                className="shrink-0 text-danger"
                disabled={!items.some((i) => i.reason !== "archived")}
                onClick={() => setConfirmEmpty(true)}
              >
                <Trash2 className="h-4 w-4" /> {t("storage.emptyTrash")}
              </Button>
            </div>
            {trash.error ? (
              <div className="px-5 py-4">
                <ErrorNotice error={trash.error} onRetry={() => void trash.refetch()} />
              </div>
            ) : trash.isLoading ? (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            ) : items.length === 0 ? (
              <p className="px-5 py-4 text-sm text-fg-subtle">{t("storage.trashEmpty")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((item) => (
                  <li key={item.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium" title={item.title}>
                        {item.title || "—"}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-fg-subtle">
                        <Badge>{t(ITEM_LABELS[item.kind])}</Badge>
                        <Badge tone={item.reason === "archived" ? "neutral" : "warning"}>{t(REASON_LABELS[item.reason])}</Badge>
                        <span>{relativeTime(item.deleted_at, i18n)}</span>
                        <span aria-hidden>·</span>
                        <span>{t("storage.expires", { when: relativeTime(item.expires_at, i18n) })}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button variant="outline" disabled={busy} onClick={() => restore.mutate(item.id)}>
                        <RotateCcw className="h-4 w-4" /> {t("storage.restore")}
                      </Button>
                      <Button variant="ghost" className="text-danger" disabled={busy} aria-label={`${t("storage.deleteForGood")}: ${item.title}`} onClick={() => setConfirmPurge(item)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {usage && usage.trash.items > items.length && (
              <p className="px-5 py-3 text-xs text-fg-subtle">{t("storage.showing", { shown: items.length, total: usage.trash.items })}</p>
            )}
          </div>
        </Card>
      </section>
      <ConfirmDialog
        open={confirmEmpty}
        title={t("storage.emptyTrashTitle")}
        message={t("storage.emptyTrashMessage")}
        confirmLabel={t("storage.emptyTrash")}
        onCancel={() => setConfirmEmpty(false)}
        onConfirm={() => empty.mutate()}
        loading={empty.isPending}
      />
      <ConfirmDialog
        open={!!confirmPurge}
        title={t("storage.deleteForGoodTitle")}
        message={t("storage.deleteForGoodMessage", { title: confirmPurge?.title ?? "" })}
        confirmLabel={t("storage.deleteForGood")}
        onCancel={() => setConfirmPurge(null)}
        onConfirm={() => confirmPurge && purge.mutate(confirmPurge.id)}
        loading={purge.isPending}
      />
    </>
  );
}
