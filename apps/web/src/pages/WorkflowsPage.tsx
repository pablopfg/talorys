import { useState } from "react";
import { type ScheduleSpec, WORKFLOW_LIMITS, type Workflow, type WorkflowKey, type WorkflowRun, describeSchedule } from "@talorys/shared";
import { Activity, ChevronDown, Pencil, Play, Rss, Workflow as WorkflowIcon } from "lucide-react";
import { Badge, Button, Card, Dialog, ErrorNotice, Input, Label, PageHeader, Select, Spinner, Switch, Textarea } from "../components/ui";
import { keys, useApiMutation, useWorkflows } from "../hooks/queries";
import { api } from "../lib/api";
import { cn, formatDateTime, relativeTime } from "../lib/utils";
import { type PlainMessageKey, useI18n } from "../lib/i18n";

const META: Record<WorkflowKey, { name: PlainMessageKey; description: PlainMessageKey; urls: PlainMessageKey; urlsHint: "workflows.sitesHint" | "workflows.feedsHint"; icon: typeof Rss }> = {
  site_monitor: {
    name: "workflows.siteMonitor",
    description: "workflows.siteMonitorHint",
    urls: "workflows.sitesLabel",
    urlsHint: "workflows.sitesHint",
    icon: Activity,
  },
  feed_digest: {
    name: "workflows.feedDigest",
    description: "workflows.feedDigestHint",
    urls: "workflows.feedsLabel",
    urlsHint: "workflows.feedsHint",
    icon: Rss,
  },
};

const RUN_TONE = { success: "success", error: "danger", skipped: "warning", running: "accent" } as const;
const RUN_LABEL: Record<WorkflowRun["status"], PlainMessageKey> = {
  success: "automations.success",
  error: "automations.failed",
  skipped: "automations.skipped",
  running: "automations.running",
};

/** Intervals offered in the form, in minutes; the platform minimum is 15. */
const INTERVALS = [15, 30, 60, 180, 360, 720, 1440];

const urlsOf = (w: Workflow) => ("urls" in w.config ? w.config.urls : w.config.feeds);

export default function WorkflowsPage() {
  const i18n = useI18n();
  const { t } = i18n;
  const { data, isLoading, error, refetch } = useWorkflows();
  const [editing, setEditing] = useState<Workflow | null>(null);
  const tz = data?.timezone ?? "UTC";

  const toggle = useApiMutation(
    (w: Workflow) => api<{ workflow: Workflow }>(`/workflows/${w.key}`, { method: "PATCH", body: { enabled: !w.enabled } }),
    {
      invalidate: [keys.workflows],
      success: ({ workflow }) => t(workflow.enabled ? "workflows.turnedOn" : "workflows.turnedOff", { name: t(META[workflow.key].name) }),
    },
  );
  const runNow = useApiMutation((w: Workflow) => api<{ run: WorkflowRun }>(`/workflows/${w.key}/run`, { method: "POST" }), {
    invalidate: [keys.workflows],
    success: ({ run }) =>
      run.status === "error"
        ? t("automations.runFailed", { error: run.error ? i18n.serverText(run.error) : t("automations.unknownError") })
        : run.status === "skipped"
          ? t("automations.runSkipped")
          : t("workflows.started"),
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-8">
      <PageHeader title={t("nav.workflows")} description={t("workflows.description", { timezone: tz })} />
      {error ? (
        <ErrorNotice error={error} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-8">
          {!data.available && (
            <p role="status" className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
              {t("workflows.unavailable")}
            </p>
          )}
          <Card>
            <ul className="divide-y divide-border">
              {data.workflows.map((w) => {
                const meta = META[w.key];
                const Icon = meta.icon;
                const name = t(meta.name);
                const count = urlsOf(w).length;
                return (
                  <li key={w.key} className="flex items-start gap-3 px-4 py-4">
                    <div className={cn("mt-0.5 rounded-lg p-2", w.enabled ? "bg-accent-soft text-accent" : "bg-muted text-fg-subtle")}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{name}</p>
                        {w.last_status === "running" && <Badge tone="accent">{t("automations.running")}</Badge>}
                        {w.last_status === "error" && <Badge tone="danger">{t("automations.lastRunFailed")}</Badge>}
                      </div>
                      <p className="mt-0.5 text-sm text-fg-muted">{t(meta.description)}</p>
                      <p className="mt-1 text-xs text-fg-subtle">
                        {describeSchedule(w.schedule, i18n.language)} · {t("workflows.addressCount", { count })}
                      </p>
                      <p className="mt-0.5 text-xs text-fg-subtle">
                        {w.enabled && w.next_run
                          ? t("automations.next", { when: formatDateTime(w.next_run, tz, i18n.locale), relative: relativeTime(w.next_run, i18n) })
                          : t("workflows.off")}
                        {w.last_run && ` · ${t("automations.lastRun", { when: relativeTime(w.last_run, i18n) })}`}
                      </p>
                      {w.last_status !== "running" && (w.last_error || w.last_result) && (
                        <p className={cn("mt-1 text-xs", w.last_error ? "text-danger" : "text-fg-muted")}>{i18n.serverText(w.last_error ?? w.last_result ?? "")}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => runNow.mutate(w)}
                        disabled={!data.available || count === 0 || w.last_status === "running" || (runNow.isPending && runNow.variables?.key === w.key)}
                        aria-label={t("automations.runNamedNow", { name })}
                        title={t("automations.runNow")}
                      >
                        {runNow.isPending && runNow.variables?.key === w.key ? <Spinner className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setEditing(w)} aria-label={t("automations.edit", { name })}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Switch
                        checked={w.enabled}
                        disabled={(!data.available && !w.enabled) || toggle.isPending}
                        onChange={() => (count === 0 && !w.enabled ? setEditing(w) : toggle.mutate(w))}
                        label={w.enabled ? t("workflows.turnOff", { name }) : t("workflows.turnOn", { name })}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
          <section>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-subtle">{t("automations.recent")}</h2>
            {data.runs.length === 0 ? (
              <p className="text-sm text-fg-subtle">{t("automations.nothingRun")}</p>
            ) : (
              <Card>
                <ul className="divide-y divide-border">
                  {data.runs.map((r) => (
                    <RunItem key={r.id} run={r} tz={tz} />
                  ))}
                </ul>
              </Card>
            )}
          </section>
          <p className="flex items-start gap-2 text-xs text-fg-subtle">
            <WorkflowIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t("workflows.freePlan")}
          </p>
        </div>
      )}
      <WorkflowForm key={editing?.key ?? "none"} workflow={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function RunItem({ run, tz }: { run: WorkflowRun; tz: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [open, setOpen] = useState(false);
  const detail = i18n.serverText(run.error ?? run.result ?? (run.status === "running" ? t("automations.runningEllipsis") : ""));
  return (
    <li className="text-sm">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-subtle">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {t(META[run.workflow_key].name)}
            {run.trigger === "manual" && <span className="font-normal text-fg-subtle"> · {t("workflows.manual")}</span>}
          </p>
          <p className={cn("text-xs", open ? "whitespace-pre-wrap break-words" : "truncate", run.status === "error" ? "text-danger" : "text-fg-subtle")}>{detail}</p>
        </div>
        <div className="shrink-0 text-right">
          <Badge tone={RUN_TONE[run.status]}>{t(RUN_LABEL[run.status])}</Badge>
          <p className="mt-0.5 text-xs text-fg-subtle" title={formatDateTime(run.started_at, tz, i18n.locale)}>
            {relativeTime(run.started_at, i18n)}
          </p>
        </div>
        <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-fg-subtle transition-transform", open && "rotate-180")} />
      </button>
    </li>
  );
}

function WorkflowForm({ workflow, onClose }: { workflow: Workflow | null; onClose: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const meta = workflow ? META[workflow.key] : null;
  const [urls, setUrls] = useState(() => (workflow ? urlsOf(workflow).join("\n") : ""));
  const [maxItems, setMaxItems] = useState(() => (workflow && "max_items" in workflow.config ? workflow.config.max_items : 10));
  const [schedule, setSchedule] = useState<ScheduleSpec>(() => workflow?.schedule ?? { type: "interval", minutes: 60 });
  const [enable, setEnable] = useState(() => workflow?.enabled ?? false);

  const list = urls.split(/\s+/).map((u) => u.trim()).filter(Boolean);
  const save = useApiMutation(
    () => {
      const key = workflow?.key ?? "site_monitor";
      const config = key === "site_monitor" ? { urls: list } : { feeds: list, max_items: maxItems };
      return api<{ workflow: Workflow }>(`/workflows/${key}`, { method: "PATCH", body: { config, schedule, enabled: enable && list.length > 0 } });
    },
    { invalidate: [keys.workflows], success: t("workflows.saved"), onSuccess: onClose },
  );

  if (!workflow || !meta) return null;
  const daily = schedule.type === "daily";
  return (
    <Dialog open onClose={onClose} title={t(meta.name)}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <p className="text-sm text-fg-muted">{t(meta.description)}</p>
        <div>
          <Label htmlFor="wf-urls" hint={t(meta.urlsHint, { max: WORKFLOW_LIMITS.maxUrls })}>
            {t(meta.urls)}
          </Label>
          <Textarea id="wf-urls" rows={4} value={urls} onChange={(e) => setUrls(e.target.value)} placeholder="https://" spellCheck={false} autoCapitalize="off" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="wf-when">{t("workflows.when")}</Label>
            <Select
              id="wf-when"
              value={daily ? "daily" : String(schedule.type === "interval" ? schedule.minutes : 60)}
              onChange={(e) => setSchedule(e.target.value === "daily" ? { type: "daily", time: "08:00" } : { type: "interval", minutes: Number(e.target.value) })}
            >
              {INTERVALS.map((m) => (
                <option key={m} value={m}>
                  {describeSchedule({ type: "interval", minutes: m }, i18n.language)}
                </option>
              ))}
              <option value="daily">{t("workflows.daily")}</option>
            </Select>
          </div>
          {daily && (
            <div>
              <Label htmlFor="wf-time">{t("workflows.time")}</Label>
              <Input id="wf-time" type="time" required value={schedule.time} onChange={(e) => setSchedule({ type: "daily", time: e.target.value })} />
            </div>
          )}
          {workflow.key === "feed_digest" && (
            <div>
              <Label htmlFor="wf-max">{t("workflows.maxItems")}</Label>
              <Input
                id="wf-max"
                type="number"
                min={1}
                max={WORKFLOW_LIMITS.maxItemsPerAlert}
                value={maxItems}
                onChange={(e) => setMaxItems(Math.min(WORKFLOW_LIMITS.maxItemsPerAlert, Math.max(1, Number(e.target.value) || 1)))}
              />
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg bg-subtle px-3 py-2">
          <span className="text-sm">{t("workflows.enableLabel")}</span>
          <Switch checked={enable && list.length > 0} disabled={list.length === 0} onChange={setEnable} label={t("workflows.enableLabel")} />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={save.isPending || list.length > WORKFLOW_LIMITS.maxUrls}>
            {save.isPending && <Spinner className="h-4 w-4" />}
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
