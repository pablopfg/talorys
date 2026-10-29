import { type ReactNode, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TelegramLinkCode, TelegramStatus } from "@talorys/shared";
import { ExternalLink, MessageSquare, Send, Unlink } from "lucide-react";
import { Link } from "react-router";
import { Badge, Button, Card, ErrorNotice, Switch } from "./ui";
import { useApiMutation } from "../hooks/queries";
import { api } from "../lib/api";
import { relativeTime } from "../lib/utils";
import { useI18n } from "../lib/i18n";
import { ALERTS_KEY } from "./AlertsCard";

export const TELEGRAM_KEY = ["telegram"] as const;

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-xs leading-5 text-fg-subtle">{hint}</p>}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/**
 * Settings → Alerts: links the Telegram bot. "Connect" points the bot at this deployment and
 * shows a one-time code; opening the chat link (and then the group link) sends the code to the
 * bot, which links that chat. While a code is shown the status refreshes by itself.
 */
export function TelegramCard() {
  const { t } = useI18n();
  const [code, setCode] = useState<TelegramLinkCode | null>(null);
  const waiting = !!code && Date.parse(code.expires_at) > Date.now();
  const status = useQuery({
    queryKey: TELEGRAM_KEY,
    queryFn: () => api<{ status: TelegramStatus }>("/telegram").then((r) => r.status),
    refetchInterval: waiting ? 3000 : false,
  });
  const s = status.data;
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-fg-subtle">{t("telegram.title")}</h2>
      <Card>
        <div className="divide-y divide-border">
          {status.error ? (
            <div className="px-5 py-4"><ErrorNotice error={status.error} onRetry={() => void status.refetch()} /></div>
          ) : !s ? null : !s.configured ? (
            <Row label={t("telegram.title")} hint={t("telegram.notSetUp")}>
              <Badge>{t("telegram.unavailable")}</Badge>
            </Row>
          ) : (
            <TelegramControls status={s} code={waiting ? code : null} onCode={setCode} />
          )}
        </div>
      </Card>
    </section>
  );
}

function TelegramControls({ status: s, code, onCode }: { status: TelegramStatus; code: TelegramLinkCode | null; onCode: (c: TelegramLinkCode | null) => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const qc = useQueryClient();
  const setStatus = (next: TelegramStatus) => {
    qc.setQueryData(TELEGRAM_KEY, next);
    // Whether the Telegram channel can send changes the reasons in the delivery history.
    void qc.invalidateQueries({ queryKey: ALERTS_KEY });
  };
  const connect = useApiMutation(() => api<TelegramLinkCode>("/telegram/connect", { method: "POST" }), {
    onSuccess: (r) => { onCode(r); setStatus(r.status); },
  });
  const test = useApiMutation(() => api<{ sent: boolean; status: TelegramStatus }>("/telegram/test", { method: "POST" }), {
    success: (r) => (r.sent ? t("telegram.testSent") : t("telegram.testFailed")),
    onSuccess: (r) => setStatus(r.status),
  });
  const disconnect = useApiMutation(() => api<{ status: TelegramStatus }>("/telegram", { method: "DELETE" }), {
    success: t("telegram.disconnected"),
    onSuccess: (r) => { onCode(null); setStatus(r.status); },
  });
  const conversation = useApiMutation((on: boolean) => api<{ status: TelegramStatus }>("/telegram", { method: "PATCH", body: { conversation: on } }), {
    success: (r) => (r.status.conversation ? t("telegram.conversationOn") : t("telegram.conversationOff")),
    onSuccess: (r) => setStatus(r.status),
  });
  const linked = s.chat || s.group !== null;
  return (
    <>
      <Row
        label={s.bot ? t("telegram.bot", { bot: `@${s.bot}` }) : t("telegram.title")}
        hint={linked && s.linked_at ? t("telegram.linkedAt", { when: relativeTime(s.linked_at, i18n) }) : t("telegram.hint")}
      >
        <Button variant="outline" onClick={() => connect.mutate(undefined)} disabled={connect.isPending}>
          {linked ? t("telegram.reconnect") : t("telegram.connect")}
        </Button>
      </Row>
      {code && (
        <div className="space-y-3 px-5 py-4">
          <p className="text-xs leading-5 text-fg-subtle">{t("telegram.codeHint")}</p>
          <p className="text-xs text-fg-muted">
            {t("telegram.code")}: <span className="font-mono text-lg tracking-widest text-fg">{code.code}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <a className="inline-flex items-center gap-1 text-sm text-accent underline" href={code.chat_link} target="_blank" rel="noreferrer noopener">
              <ExternalLink className="h-4 w-4" /> {t("telegram.openChat")}
            </a>
            {s.chat && (
              <a className="inline-flex items-center gap-1 text-sm text-accent underline" href={code.group_link} target="_blank" rel="noreferrer noopener">
                <ExternalLink className="h-4 w-4" /> {t("telegram.addToGroup")}
              </a>
            )}
          </div>
          <p className="text-xs text-fg-subtle">{t("telegram.codeExpires", { when: relativeTime(code.expires_at, i18n) })}</p>
        </div>
      )}
      <Row label={t("telegram.chat")} hint={t("telegram.chatHint")}>
        <Badge tone={s.chat ? "success" : "neutral"}>{s.chat ? t("telegram.linked") : t("telegram.notLinked")}</Badge>
      </Row>
      {s.chat && (
        <Row
          label={t("telegram.conversation")}
          hint={
            <>
              {t("telegram.conversationHint")}
              {s.conversation_id && (
                <>
                  {" "}
                  <Link to={`/chat/${s.conversation_id}`} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                    <MessageSquare className="h-3 w-3" /> {t("telegram.openConversation")}
                  </Link>
                </>
              )}
            </>
          }
        >
          <Switch
            checked={s.conversation}
            onChange={(on) => conversation.mutate(on)}
            label={t("telegram.conversationAria")}
            disabled={conversation.isPending}
          />
        </Row>
      )}
      <Row label={t("telegram.group")} hint={s.group !== null ? (s.topics ? t("telegram.topicsOn") : t("telegram.groupHint")) : t("telegram.groupHint")}>
        <Badge tone={s.group !== null ? "success" : "neutral"}>{s.group !== null ? (s.group || t("telegram.linked")) : t("telegram.notLinked")}</Badge>
      </Row>
      {linked && (
        <Row label={t("telegram.sendTest")} hint={t(s.group !== null ? "telegram.testGroup" : "telegram.testChat")}>
          <Button variant="outline" onClick={() => test.mutate(undefined)} disabled={test.isPending}>
            <Send className="h-4 w-4" /> {t("telegram.sendTestButton")}
          </Button>
          <Button variant="ghost" onClick={() => disconnect.mutate(undefined)} disabled={disconnect.isPending}>
            <Unlink className="h-4 w-4" /> {t("telegram.disconnect")}
          </Button>
        </Row>
      )}
    </>
  );
}
