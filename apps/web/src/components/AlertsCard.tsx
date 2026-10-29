import { type ReactNode, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ALERT_CATEGORIES,
  ALERT_CHANNELS,
  ALERT_LIMIT_BOUNDS,
  type AlertCategory,
  type AlertChannel,
  type AlertDelivery,
  type AlertPreferences,
  type AlertsOverview,
} from "@talorys/shared";
import { Badge, Button, Card, ErrorNotice, Input, Switch } from "./ui";
import { useApiMutation } from "../hooks/queries";
import { api } from "../lib/api";
import { relativeTime } from "../lib/utils";
import { type PlainMessageKey, useI18n } from "../lib/i18n";
import { PRIORITY_LABELS, PRIORITY_TONES } from "../lib/alerts";

export const ALERTS_KEY = ["alerts"] as const;

export const CATEGORY_LABELS: Record<AlertCategory, PlainMessageKey> = {
  reminder: "alerts.category.reminder",
  digest: "alerts.category.digest",
  routine: "alerts.category.routine",
  task: "alerts.category.task",
  system: "alerts.category.system",
  security: "alerts.category.security",
  event: "alerts.category.event",
};

const CATEGORY_HINTS: Record<AlertCategory, PlainMessageKey> = {
  reminder: "alerts.categoryHint.reminder",
  digest: "alerts.categoryHint.digest",
  routine: "alerts.categoryHint.routine",
  task: "alerts.categoryHint.task",
  system: "alerts.categoryHint.system",
  security: "alerts.categoryHint.security",
  event: "alerts.categoryHint.event",
};

const CHANNEL_LABELS: Record<AlertChannel, PlainMessageKey> = {
  push: "alerts.channel.push",
  telegram: "alerts.channel.telegram",
};

const STATUS_TEXT: Record<AlertDelivery["status"], PlainMessageKey> = {
  pending: "alerts.status.pending",
  sent: "alerts.status.sent",
  failed: "alerts.status.failed",
  skipped: "alerts.status.skipped",
};

const STATUS_TONES = { pending: "neutral", sent: "success", failed: "danger", skipped: "warning" } as const;

const REASON_TEXT: Record<NonNullable<AlertDelivery["reason"]>, PlainMessageKey> = {
  low_priority: "alerts.reason.low_priority",
  rate_limited: "alerts.reason.rate_limited",
  not_configured: "alerts.reason.not_configured",
  no_device: "alerts.reason.no_device",
  unreachable: "alerts.reason.unreachable",
};

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-xs leading-5 text-fg-subtle">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-3">{children}</div>
    </div>
  );
}

/**
 * Settings → Alerts: which categories reach which channels outside the app, how many messages a
 * channel may send, and what happened to the latest alerts.
 */
export function AlertsCard() {
  const { t } = useI18n();
  const overview = useQuery({ queryKey: ALERTS_KEY, queryFn: () => api<AlertsOverview>("/alerts") });
  const data = overview.data;
  return (
    <>
      <section className="space-y-2">
        <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-fg-subtle">{t("alerts.routesTitle")}</h2>
        <Card>
          <div className="divide-y divide-border">
            {overview.error ? (
              <div className="px-5 py-4"><ErrorNotice error={overview.error} onRetry={() => void overview.refetch()} /></div>
            ) : data ? (
              <PreferencesForm overview={data} />
            ) : null}
          </div>
        </Card>
      </section>
      {data && <DeliveryHistory deliveries={data.deliveries} />}
    </>
  );
}

function PreferencesForm({ overview }: { overview: AlertsOverview }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [prefs, setPrefs] = useState<AlertPreferences>(overview.preferences);
  useEffect(() => setPrefs(overview.preferences), [overview.preferences]);
  const save = useApiMutation(
    (next: AlertPreferences) => api<{ preferences: AlertPreferences }>("/alerts/preferences", { method: "PUT", body: next }),
    {
      success: t("alerts.saved"),
      onSuccess: (r) => qc.setQueryData<AlertsOverview>(ALERTS_KEY, (old) => (old ? { ...old, preferences: r.preferences } : old)),
    },
  );
  // A switch saves at once, with the saved limits: unsaved limit edits stay in their fields.
  const toggle = (category: AlertCategory, channel: AlertChannel, on: boolean) => {
    const current = prefs.routes[category];
    const routes = { ...prefs.routes, [category]: on ? [...current, channel] : current.filter((c) => c !== channel) };
    setPrefs({ ...prefs, routes });
    save.mutate({ routes, limits: overview.preferences.limits, fullText: prefs.fullText });
  };
  const toggleFullText = (category: AlertCategory, on: boolean) => {
    const fullText = on ? [...prefs.fullText, category] : prefs.fullText.filter((c) => c !== category);
    setPrefs({ ...prefs, fullText });
    save.mutate({ routes: prefs.routes, limits: overview.preferences.limits, fullText });
  };
  // A refused save puts the switches back to what the server has.
  useEffect(() => {
    if (save.isError) setPrefs((p) => ({ ...p, routes: overview.preferences.routes, fullText: overview.preferences.fullText }));
  }, [save.isError, overview.preferences.routes, overview.preferences.fullText]);
  const limitsChanged = prefs.limits.perHour !== overview.preferences.limits.perHour || prefs.limits.perDay !== overview.preferences.limits.perDay;
  const limitsValid =
    Number.isInteger(prefs.limits.perHour) && prefs.limits.perHour >= ALERT_LIMIT_BOUNDS.perHour.min && prefs.limits.perHour <= ALERT_LIMIT_BOUNDS.perHour.max &&
    Number.isInteger(prefs.limits.perDay) && prefs.limits.perDay >= ALERT_LIMIT_BOUNDS.perDay.min && prefs.limits.perDay <= ALERT_LIMIT_BOUNDS.perDay.max;
  return (
    <>
      <p className="px-5 py-4 text-xs leading-5 text-fg-subtle">{t("alerts.routesHint")}</p>
      {ALERT_CATEGORIES.map((category) => (
        <Row key={category} label={t(CATEGORY_LABELS[category])} hint={t(category === "security" ? "alerts.securityAlways" : CATEGORY_HINTS[category])}>
          {ALERT_CHANNELS.map((channel) => (
            <span key={channel} className="flex items-center gap-2 text-xs text-fg-muted">
              {t(CHANNEL_LABELS[channel])}
              <Switch
                checked={category === "security" || prefs.routes[category].includes(channel)}
                onChange={(on) => toggle(category, channel, on)}
                label={t("alerts.routeAria", { category: t(CATEGORY_LABELS[category]), channel: t(CHANNEL_LABELS[channel]) })}
                disabled={category === "security" || save.isPending}
              />
            </span>
          ))}
          <span className="flex items-center gap-2 text-xs text-fg-muted">
            {t("alerts.fullText")}
            <Switch
              checked={prefs.fullText.includes(category)}
              onChange={(on) => toggleFullText(category, on)}
              label={t("alerts.fullTextAria", { category: t(CATEGORY_LABELS[category]) })}
              disabled={save.isPending}
            />
          </span>
        </Row>
      ))}
      <p className="px-5 py-4 text-xs leading-5 text-fg-subtle">{t("alerts.fullTextHint")}</p>
      <Row label={t("alerts.limitsTitle")} hint={t("alerts.limitsHint")}>
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          {t("alerts.perHour")}
          <Input
            id="alerts-per-hour"
            type="number"
            inputMode="numeric"
            className="h-9 w-20"
            min={ALERT_LIMIT_BOUNDS.perHour.min}
            max={ALERT_LIMIT_BOUNDS.perHour.max}
            value={Number.isNaN(prefs.limits.perHour) ? "" : prefs.limits.perHour}
            onChange={(e) => setPrefs({ ...prefs, limits: { ...prefs.limits, perHour: e.target.valueAsNumber } })}
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          {t("alerts.perDay")}
          <Input
            id="alerts-per-day"
            type="number"
            inputMode="numeric"
            className="h-9 w-20"
            min={ALERT_LIMIT_BOUNDS.perDay.min}
            max={ALERT_LIMIT_BOUNDS.perDay.max}
            value={Number.isNaN(prefs.limits.perDay) ? "" : prefs.limits.perDay}
            onChange={(e) => setPrefs({ ...prefs, limits: { ...prefs.limits, perDay: e.target.valueAsNumber } })}
          />
        </label>
        <Button variant="outline" onClick={() => save.mutate(prefs)} disabled={!limitsChanged || !limitsValid || save.isPending}>
          {t("common.save")}
        </Button>
      </Row>
      {!overview.channels.push.available && (
        <p className="px-5 py-4 text-xs leading-5 text-warning">{t("alerts.pushUnavailable")}</p>
      )}
      {!overview.channels.telegram.available && (
        <p className="px-5 py-4 text-xs leading-5 text-warning">{t("alerts.telegramUnavailable")}</p>
      )}
    </>
  );
}

function DeliveryHistory({ deliveries }: { deliveries: AlertDelivery[] }) {
  const i18n = useI18n();
  const { t, serverText } = i18n;
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-fg-subtle">{t("alerts.historyTitle")}</h2>
      <Card>
        {deliveries.length === 0 ? (
          <p className="px-5 py-4 text-sm text-fg-subtle">{t("alerts.historyEmpty")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {deliveries.map((d) => (
              <li key={d.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{serverText(d.title)}</p>
                  <p className="text-xs text-fg-subtle">
                    {t(CATEGORY_LABELS[d.category])} · {t(CHANNEL_LABELS[d.channel])} · {relativeTime(d.created_at, i18n)}
                    {d.reason ? ` · ${t(REASON_TEXT[d.reason])}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={PRIORITY_TONES[d.priority]}>{t(PRIORITY_LABELS[d.priority])}</Badge>
                  <Badge tone={STATUS_TONES[d.status]}>{t(STATUS_TEXT[d.status])}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
