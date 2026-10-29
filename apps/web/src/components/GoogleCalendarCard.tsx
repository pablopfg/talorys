import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { type CalendarMode, GITHUB_URL, type GoogleCalendarInfo, type GoogleCalendarStatus } from "@talorys/shared";
import { CalendarDays, LogIn, RefreshCw } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, ErrorNotice, Select, Spinner } from "./ui";
import { useToast } from "../hooks/toast";
import { keys, useApiMutation, useGoogleCalendar } from "../hooks/queries";
import { api } from "../lib/api";
import { type PlainMessageKey, useI18n } from "../lib/i18n";

const DOCS_URL = `${GITHUB_URL}/blob/main/docs/google-calendar.md`;

const MODE_LABEL: Record<CalendarMode, PlainMessageKey> = {
  off: "calendar.modeOff",
  read: "calendar.modeRead",
  write: "calendar.modeWrite",
};

function Row({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-xs leading-5 text-fg-subtle">{hint}</div>}
      </div>
      {children && <div className="flex shrink-0 flex-wrap gap-2">{children}</div>}
    </div>
  );
}

/** Google's consent page. Nothing else is followed, whatever the server answered. */
function openGoogle(url: string) {
  const target = new URL(url);
  if (target.protocol === "https:" && target.hostname === "accounts.google.com") window.location.assign(target.href);
}

/**
 * Settings → Integrations: one Google account, and for each of its calendars whether the agent
 * may not see it, read it, or also propose changes (each one approved by the owner).
 */
export function GoogleCalendarCard() {
  const { t, serverText } = useI18n();
  const status = useGoogleCalendar();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const data = status.data;
  const invalidate = [keys.googleCalendar] as const;

  const connect = useApiMutation(() => api<{ authorize_url: string }>("/calendar/google/connect", { method: "POST", body: {} }), {
    onSuccess: ({ authorize_url }) => openGoogle(authorize_url),
  });
  const refresh = useApiMutation(() => api<GoogleCalendarStatus>("/calendar/google/refresh", { method: "POST", body: {} }), {
    invalidate,
    success: t("calendar.refreshed"),
  });
  const disconnect = useApiMutation(() => api("/calendar/google", { method: "DELETE" }), {
    invalidate,
    success: t("calendar.disconnected"),
    onSuccess: () => setConfirmDisconnect(false),
  });

  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-fg-subtle">{t("calendar.title")}</h2>
      <Card>
        <div className="divide-y divide-border">
          {status.error ? (
            <div className="px-5 py-4">
              <ErrorNotice error={status.error} onRetry={() => void status.refetch()} />
            </div>
          ) : !data ? (
            <div className="flex justify-center p-6">
              <Spinner />
            </div>
          ) : !data.configured ? (
            <Row
              label={t("calendar.notConfigured")}
              hint={
                <>
                  {t("calendar.notConfiguredHint")}{" "}
                  <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                    {t("calendar.howToSetUp")}
                  </a>
                </>
              }
            />
          ) : !data.connected ? (
            <Row
              label={t("calendar.intro")}
              hint={
                <>
                  {t("calendar.introHint")}{" "}
                  <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                    {t("calendar.howItWorks")}
                  </a>
                </>
              }
            >
              <Button size="sm" loading={connect.isPending} onClick={() => connect.mutate(undefined)}>
                <LogIn className="h-4 w-4" /> {t("calendar.connect")}
              </Button>
            </Row>
          ) : (
            <>
              <Row
                label={
                  <span className="flex flex-wrap items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-fg-subtle" />
                    {data.email}
                    {data.status === "error" ? <Badge tone="danger">{t("calendar.statusError")}</Badge> : <Badge tone="success">{t("calendar.statusConnected")}</Badge>}
                  </span>
                }
                hint={data.status === "error" && data.error ? serverText(data.error) : t("calendar.connectedHint")}
              >
                {data.status === "error" && (
                  <Button size="sm" loading={connect.isPending} onClick={() => connect.mutate(undefined)}>
                    <LogIn className="h-4 w-4" /> {t("calendar.reconnect")}
                  </Button>
                )}
                <Button size="sm" variant="outline" loading={refresh.isPending} onClick={() => refresh.mutate(undefined)} aria-label={t("calendar.refresh")}>
                  <RefreshCw className="h-4 w-4" /> {t("calendar.refresh")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDisconnect(true)}>
                  {t("calendar.disconnect")}
                </Button>
              </Row>
              {data.calendars.length === 0 ? (
                <p className="px-5 py-4 text-sm text-fg-subtle">{t("calendar.empty")}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.calendars.map((cal) => (
                    <CalendarRow key={cal.id} calendar={cal} />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </Card>
      <ConfirmDialog
        open={confirmDisconnect}
        title={t("calendar.disconnectTitle")}
        message={t("calendar.disconnectMessage")}
        confirmLabel={t("calendar.disconnect")}
        loading={disconnect.isPending}
        onConfirm={() => disconnect.mutate(undefined)}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </section>
  );
}

function CalendarRow({ calendar }: { calendar: GoogleCalendarInfo }) {
  const { t } = useI18n();
  const busyOnly = calendar.access_role === "freeBusyReader";
  const save = useApiMutation(
    (mode: CalendarMode) =>
      api<{ calendar: GoogleCalendarInfo }>(`/calendar/google/calendars/${encodeURIComponent(calendar.id)}`, { method: "PATCH", body: { mode } }),
    { invalidate: [keys.googleCalendar] },
  );
  const hint = busyOnly ? t("calendar.busyOnly") : !calendar.writable ? t("calendar.readOnlyInGoogle") : calendar.mode === "write" ? t("calendar.writeHint") : null;

  return (
    <li>
      <Row
        label={
          <span className="flex flex-wrap items-center gap-2">
            <span className="break-all">{calendar.name}</span>
            {calendar.primary && <Badge>{t("calendar.primary")}</Badge>}
          </span>
        }
        hint={hint}
      >
        <Select
          aria-label={t("calendar.modeAria", { name: calendar.name })}
          value={calendar.mode}
          disabled={busyOnly || save.isPending}
          onChange={(e) => save.mutate(e.target.value as CalendarMode)}
          className="w-56"
        >
          <option value="off">{t(MODE_LABEL.off)}</option>
          {!busyOnly && <option value="read">{t(MODE_LABEL.read)}</option>}
          {calendar.writable && <option value="write">{t(MODE_LABEL.write)}</option>}
        </Select>
      </Row>
    </li>
  );
}

/**
 * Where Google's consent page returns. It forwards the code and state to the backend with the
 * owner's session (the cross-site redirect itself carries no session cookie), then goes back to
 * Settings.
 */
export function GoogleCalendarCallback() {
  const { t } = useI18n();
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
      setError(new Error(t("calendar.callbackNoState")));
      return;
    }
    const pick = (k: string) => {
      const v = params.get(k);
      return v ? { [k]: v } : {};
    };
    api<GoogleCalendarStatus>("/calendar/google/callback", { method: "POST", body: { state, ...pick("code"), ...pick("error") } })
      .then(async () => {
        await qc.invalidateQueries({ queryKey: keys.googleCalendar });
        toast(t("calendar.connected"));
        navigate("/settings?tab=Integrations", { replace: true });
      })
      .catch(setError);
  }, [params, navigate, toast, qc, t]);

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
          {t("calendar.finishing")}
        </div>
      )}
    </div>
  );
}
