import { useState } from "react";
import { AUTH_FAILURE_KINDS, type AuthEvent, type AuthEventKind, type AuthEventsSummary } from "@talorys/shared";
import { Download, Trash2 } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, ErrorNotice, Select, Spinner } from "./ui";
import { keys, useApiMutation, useAuthActivity, useAuthActivitySummary } from "../hooks/queries";
import { errorMessage, useToast } from "../hooks/toast";
import { api } from "../lib/api";
import { describeAgent, formatDateTime } from "../lib/utils";
import { type I18n, type PlainMessageKey, useI18n } from "../lib/i18n";

const KIND_LABEL: Record<AuthEventKind, PlainMessageKey> = {
  login_success: "authActivity.loginSuccess",
  login_failure: "authActivity.loginFailure",
  login_rate_limited: "authActivity.loginRateLimited",
  logout: "authActivity.logout",
  session_ended: "authActivity.sessionEnded",
  session_revoked: "authActivity.sessionRevoked",
  password_changed: "authActivity.passwordChanged",
  confirm_success: "authActivity.confirmSuccess",
  confirm_failure: "authActivity.confirmFailure",
  remote_token_rejected: "authActivity.remoteTokenRejected",
  mfa_challenge: "authActivity.mfaChallenge",
  mfa_failure: "authActivity.mfaFailure",
  mfa_enabled: "authActivity.mfaEnabled",
  mfa_disabled: "authActivity.mfaDisabled",
  mfa_codes_regenerated: "authActivity.mfaCodesRegenerated",
  login_human_check: "authActivity.loginHumanCheck",
  recovery_requested: "authActivity.recoveryRequested",
  recovery_failure: "authActivity.recoveryFailure",
  password_reset: "authActivity.passwordReset",
};

/** Reasons worth showing next to the kind; the others say nothing the kind doesn't. */
const REASON_LABEL: Record<string, PlainMessageKey> = {
  idle: "authActivity.reasonIdle",
  presence: "authActivity.reasonPresence",
  max: "authActivity.reasonMax",
  others: "authActivity.reasonOthers",
  password_change: "authActivity.reasonPasswordChange",
  invalid: "authActivity.reasonInvalidToken",
  malformed: "authActivity.reasonMalformedToken",
  totp: "authActivity.reasonTotp",
  recovery_code: "authActivity.reasonRecoveryCode",
  wrong_code: "authActivity.reasonWrongCode",
  too_many: "authActivity.reasonTooMany",
  expired: "authActivity.reasonExpired",
  rate_limited: "authActivity.reasonRateLimited",
  disable: "authActivity.reasonMfaDisable",
  recovery_codes: "authActivity.reasonMfaCodes",
  required: "authActivity.reasonHumanRequired",
  failed: "authActivity.reasonHumanFailed",
  unavailable: "authActivity.reasonHumanUnavailable",
  sent: "authActivity.reasonRecoverySent",
  not_sent: "authActivity.reasonRecoveryNotSent",
  wrong_email: "authActivity.reasonRecoveryWrongEmail",
  daily_limit: "authActivity.reasonRecoveryDailyLimit",
  link: "authActivity.reasonRecoveryLink",
};

const RETENTION_CHOICES = [30, 60, 90, 120, 180];

function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function where(e: AuthEvent, locale: string): string {
  return [e.city, e.region, e.country ? countryName(e.country, locale) : null].filter(Boolean).join(", ");
}

function EventRow({ event: e, timezone, i18n }: { event: AuthEvent; timezone: string; i18n: I18n }) {
  const { t, locale } = i18n;
  const failed = AUTH_FAILURE_KINDS.includes(e.kind);
  const reason = e.reason ? REASON_LABEL[e.reason] : undefined;
  const details = [where(e, locale), e.as_org, e.ip, e.user_agent ? describeAgent(e.user_agent, t) : null].filter(Boolean).join(" · ");
  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={failed ? "font-medium text-danger" : "font-medium"}>{t(KIND_LABEL[e.kind])}</span>
        {reason && <span className="text-fg-muted">· {t(reason)}</span>}
        {e.count > 1 && <Badge tone="warning">{t("authActivity.times", { count: e.count })}</Badge>}
        {e.kind === "login_success" && e.known_device === false && <Badge tone="accent">{t("authActivity.newDevice")}</Badge>}
      </div>
      <p className="mt-0.5 text-xs text-fg-subtle">
        {e.count > 1
          ? t("authActivity.between", { first: formatDateTime(e.at, timezone, locale), last: formatDateTime(e.last_at, timezone, locale) })
          : formatDateTime(e.at, timezone, locale)}
      </p>
      {details && <p className="mt-0.5 break-words text-xs text-fg-subtle">{details}</p>}
    </li>
  );
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="min-w-0">
      <div className={danger && value > 0 ? "text-lg font-semibold text-danger" : "text-lg font-semibold"}>{value}</div>
      <div className="text-xs text-fg-subtle">{label}</div>
    </div>
  );
}

/** Settings → Security: who signed in, who tried, from where. Export, delete and a longer retention ask for the password. */
export function AuthActivityCard({ timezone }: { timezone: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState(false);
  // The rows carry IPs: they load when asked for, and the server may want the password first.
  const [open, setOpen] = useState(false);
  const summary = useAuthActivitySummary();
  const list = useAuthActivity(failuresOnly, open);
  const events = list.data?.pages.flatMap((p) => p.events) ?? [];

  const retention = useApiMutation((days: number) => api<AuthEventsSummary>("/auth/activity/settings", { method: "PUT", body: { retention_days: days } }), {
    invalidate: [keys.authActivity],
    success: t("authActivity.retentionSaved"),
  });
  const clear = useApiMutation(() => api<{ deleted: number }>("/auth/activity/delete", { method: "POST", body: {} }), {
    invalidate: [keys.authActivity],
    success: t("authActivity.deleted"),
    onSuccess: () => setConfirmDelete(false),
  });

  /** Fetched rather than linked, so the password prompt can come first. */
  async function onExport() {
    setExporting(true);
    try {
      const { filename, csv } = await api<{ filename: string; csv: string }>("/auth/activity/export", { method: "POST", body: {} });
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast(errorMessage(error, t("common.somethingWentWrong")), "error");
    } finally {
      setExporting(false);
    }
  }

  const s = summary.data;
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-fg-subtle">{t("authActivity.title")}</h2>
      <Card>
        <div className="divide-y divide-border">
          <p className="px-5 py-4 text-sm leading-6 text-fg-muted">{t("authActivity.intro", { days: s?.retention_days ?? 90 })}</p>
          {s && (
            <div className="px-5 py-4">
              <p className="mb-2 text-xs text-fg-subtle">{t("authActivity.last24h")}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label={t("authActivity.statSignIns")} value={s.successes} />
                <Stat label={t("authActivity.statFailures")} value={s.failures} danger />
                <Stat label={t("authActivity.statBlocked")} value={s.blocked} danger />
                <Stat label={t("authActivity.statNetworks")} value={s.networks} />
              </div>
            </div>
          )}
          {!open ? (
            <div className="flex justify-center px-5 py-3">
              <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
                {t("authActivity.show")}
              </Button>
            </div>
          ) : (
            <>
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
            <Select value={failuresOnly ? "failures" : "all"} onChange={(e) => setFailuresOnly(e.target.value === "failures")} aria-label={t("authActivity.filter")}>
              <option value="all">{t("authActivity.filterAll")}</option>
              <option value="failures">{t("authActivity.filterFailures")}</option>
            </Select>
          </div>
          {list.error ? (
            <div className="px-5 py-4">
              <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />
            </div>
          ) : list.isLoading ? (
            <div className="flex justify-center p-6">
              <Spinner />
            </div>
          ) : events.length === 0 ? (
            <p className="px-5 py-4 text-sm text-fg-subtle">{t("authActivity.empty")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {events.map((e) => (
                <EventRow key={e.id} event={e} timezone={timezone} i18n={i18n} />
              ))}
            </ul>
          )}
          {list.hasNextPage && (
            <div className="flex justify-center px-5 py-3">
              <Button variant="ghost" size="sm" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                {t("authActivity.loadMore")}
              </Button>
            </div>
          )}
            </>
          )}
          <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-medium">{t("authActivity.retention")}</div>
              <div className="mt-0.5 text-xs leading-5 text-fg-subtle">{t("authActivity.retentionHint")}</div>
            </div>
            <Select
              value={s?.retention_days ?? 90}
              onChange={(e) => retention.mutate(Number(e.target.value))}
              aria-label={t("authActivity.retention")}
              disabled={!s || retention.isPending}
            >
              {[...new Set([...RETENTION_CHOICES, s?.retention_days ?? 90])].sort((a, b) => a - b).map((n) => (
                <option key={n} value={n}>
                  {t("authActivity.days", { count: n })}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-wrap justify-end gap-2 px-5 py-3">
            <Button variant="outline" size="sm" loading={exporting} onClick={() => void onExport()}>
              <Download className="h-3.5 w-3.5" /> {t("authActivity.export")}
            </Button>
            <Button variant="outline" size="sm" className="text-danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-3.5 w-3.5" /> {t("authActivity.delete")}
            </Button>
          </div>
        </div>
      </Card>
      <ConfirmDialog
        open={confirmDelete}
        title={t("authActivity.deleteTitle")}
        message={t("authActivity.deleteMessage")}
        confirmLabel={t("authActivity.delete")}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => clear.mutate(undefined)}
        loading={clear.isPending}
      />
    </section>
  );
}
