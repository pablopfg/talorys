import { type ReactNode, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PushStatus } from "@talorys/shared";
import { Send, Trash2 } from "lucide-react";
import { Badge, Button, Card, ErrorNotice, Switch } from "./ui";
import { useApiMutation } from "../hooks/queries";
import { api } from "../lib/api";
import { currentSubscription, disablePush, enablePush, pushBlocker, reportPushSeen, thisDeviceId } from "../lib/push";
import { relativeTime } from "../lib/utils";
import { type PlainMessageKey, useI18n } from "../lib/i18n";

const KEY = ["push"] as const;

const BLOCKER_TEXT: Record<NonNullable<ReturnType<typeof pushBlocker>>, PlainMessageKey> = {
  "ios-not-installed": "push.blockerIos",
  unsupported: "push.blockerUnsupported",
  denied: "push.blockerDenied",
};

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-xs leading-5 text-fg-subtle">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Settings card for Web Push: this device's switch, the device list and a test send. */
export function PushNotificationsCard() {
  const { t } = useI18n();
  const status = useQuery({ queryKey: KEY, queryFn: () => api<PushStatus>("/push") });
  const s = status.data;
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-fg-subtle">{t("push.title")}</h2>
      <Card>
        <div className="divide-y divide-border">
          {status.error ? (
            <div className="px-5 py-4"><ErrorNotice error={status.error} onRetry={() => void status.refetch()} /></div>
          ) : !s ? null : !s.available ? (
            <Row label={t("push.title")} hint={t("push.notSetUp")}>
              <Badge>{t("push.unavailable")}</Badge>
            </Row>
          ) : (
            <PushControls status={s} />
          )}
        </div>
      </Card>
    </section>
  );
}

function usePushMutations() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const setStatus = (s: PushStatus) => qc.setQueryData(KEY, s);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  useEffect(() => {
    // A browser whose device the server removed (inactive, or removed elsewhere) shows as off.
    void currentSubscription()
      .then(async (sub) => setSubscribed(!!sub && (await reportPushSeen(true)) !== false), () => setSubscribed(false));
  }, []);
  const toggle = useApiMutation(
    async (v: { on: boolean; publicKey: string }) => (v.on ? (await enablePush(v.publicKey)).status : disablePush()),
    {
      success: (s) => (s.devices.some((d) => d.id === thisDeviceId()) ? t("push.turnedOn") : t("push.turnedOff")),
      onSuccess: (s, v) => { setStatus(s); setSubscribed(v.on); },
    },
  );
  const remove = useApiMutation((id: string) => api<PushStatus>(`/push/subscriptions/${id}`, { method: "DELETE" }), {
    success: t("push.deviceRemoved"),
    onSuccess: setStatus,
  });
  const test = useApiMutation(() => api<{ result: { sent: number; gone: number; failed: number }; status: PushStatus }>("/push/test", { method: "POST" }), {
    success: (r) => (r.result.sent > 0 ? t("push.testSent", { count: r.result.sent }) : t("push.noDevice")),
    onSuccess: (r) => setStatus(r.status),
  });
  return { subscribed, toggle, remove, test };
}

function PushControls({ status: s }: { status: PushStatus }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { subscribed, toggle, remove, test } = usePushMutations();
  const blocker = pushBlocker();
  const current = thisDeviceId();
  return (
    <>
      <Row label={t("settings.thisDevice")} hint={t(blocker ? BLOCKER_TEXT[blocker] : "push.hint")}>
        <Switch
          checked={subscribed === true && !blocker}
          onChange={(on) => toggle.mutate({ on, publicKey: s.public_key! })}
          label={t("push.onThisDevice")}
          disabled={!!blocker || subscribed === null || toggle.isPending}
        />
      </Row>
      {s.devices.map((d) => (
        <Row key={d.id} label={d.label} hint={`${d.service} · ${t("push.added", { when: relativeTime(d.created_at, i18n) })} · ${t("push.lastSeen", { when: relativeTime(d.last_seen_at, i18n) })}${d.failures ? ` · ${t("push.failedSends", { count: d.failures })}` : ""}`}>
          <div className="flex items-center gap-2">
            {d.id === current && <Badge tone="accent">{t("settings.thisDevice")}</Badge>}
            <Button variant="ghost" aria-label={t("push.remove", { label: d.label })} onClick={() => remove.mutate(d.id)} disabled={remove.isPending}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </Row>
      ))}
      <Row label={t("push.sendTest")} hint={`${t("push.devicesRegistered", { count: s.devices.length, max: s.max_devices })} ${t("push.inactiveHint", { days: s.inactive_days })}`}>
        <Button variant="outline" onClick={() => test.mutate(undefined)} disabled={s.devices.length === 0 || test.isPending}>
          <Send className="h-4 w-4" /> {t("push.sendTestButton")}
        </Button>
      </Row>
    </>
  );
}
