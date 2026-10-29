import { type ReactNode, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  AI_FALLBACKS,
  AI_PROVIDERS,
  type AiProviderId,
  GITHUB_URL,
  LANGUAGES,
  LIMIT_CEILINGS,
  type Limits,
  MAX_CUSTOM_INSTRUCTIONS,
  type MemoryHistorySettings,
  SESSION_TIMEOUT_RANGES,
  type SessionTimeouts,
  PAID_MODELS,
  type Settings,
  TALORYS_VERSION,
} from "@talorys/shared";
import { Download, ExternalLink, LogOut, Monitor, Moon, Sun, Upload } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, ErrorNotice, Input, PageHeader, Select, Spinner, Switch, Textarea } from "../components/ui";
import { SemanticRecallCard } from "../components/SemanticRecallCard";
import { PushNotificationsCard } from "../components/PushNotificationsCard";
import { AlertsCard } from "../components/AlertsCard";
import { TelegramCard } from "../components/TelegramCard";
import { RemoteAccessCard } from "../components/RemoteAccessCard";
import { ChangePasswordForm } from "../components/ChangePasswordForm";
import { McpServersCard } from "../components/McpServersCard";
import { GoogleCalendarCard } from "../components/GoogleCalendarCard";
import { AuthActivityCard } from "../components/AuthActivityCard";
import { TwoFactorCard } from "../components/TwoFactorCard";
import { PasskeysCard } from "../components/PasskeysCard";
import { StorageCard } from "../components/StorageCard";
import { UsageBreakdown, UsagePricingNote } from "../components/UsageBreakdown";
import { keys, useApiMutation, useMfaStatus, useSessions, useSettings, useSystemInfo, useUpdateStatus, useUsage } from "../hooks/queries";
import { useSession } from "../hooks/session";
import { useToast, errorMessage } from "../hooks/toast";
import { api } from "../lib/api";
import { applyTheme } from "../lib/theme";
import { cn, describeAgent, relativeTime } from "../lib/utils";
import { applyLanguage, browserLanguage, LANGUAGE_NAMES, type PlainMessageKey, useI18n } from "../lib/i18n";

const TABS = ["General", "Alerts", "AI", "Privacy", "Security", "Integrations", "About"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, PlainMessageKey> = {
  General: "settings.tabGeneral",
  Alerts: "settings.tabAlerts",
  AI: "settings.tabAi",
  Privacy: "settings.tabPrivacy",
  Security: "settings.tabSecurity",
  Integrations: "settings.tabIntegrations",
  About: "settings.tabAbout",
};

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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-fg-subtle">{title}</h2>
      <Card>
        <div className="divide-y divide-border">{children}</div>
      </Card>
    </section>
  );
}

export default function SettingsPage() {
  const i18n = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const param = searchParams.get("tab");
  const tab: Tab = TABS.find((t) => t === param) ?? "General";
  const setTab = (t: Tab) => setSearchParams(t === "General" ? {} : { tab: t }, { replace: true });
  const { data: settings, isLoading, error, refetch } = useSettings();
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-8">
      <PageHeader title={i18n.t("nav.settings")} />
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-border" role="tablist">
        {TABS.map((t) => (
          <button type="button"
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === t ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {i18n.t(TAB_LABELS[t])}
          </button>
        ))}
      </div>
      {error ? (
        <ErrorNotice error={error} onRetry={() => void refetch()} />
      ) : isLoading || !settings ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-8 animate-fade-in">
          {tab === "General" && <GeneralTab settings={settings} />}
          {tab === "Alerts" && <PushNotificationsCard />}
          {tab === "Alerts" && <TelegramCard />}
          {tab === "Alerts" && <AlertsCard />}
          {tab === "AI" && <AiTab settings={settings} />}
          {tab === "Privacy" && <PrivacyTab />}
          {tab === "Security" && <SecurityTab settings={settings} />}
          {tab === "Integrations" && (
            <>
              <GoogleCalendarCard />
              <McpServersCard />
            </>
          )}
          {tab === "About" && <AboutTab settings={settings} />}
        </div>
      )}
    </div>
  );
}

function useSaveSettings() {
  const { t } = useI18n();
  const qc = useQueryClient();
  type Patch = Partial<Omit<Settings, "limits" | "memoryHistory" | "session">> & {
    limits?: Partial<Limits>;
    memoryHistory?: Partial<MemoryHistorySettings>;
    session?: Partial<SessionTimeouts>;
  };
  return useApiMutation((patch: Patch) => api<{ settings: Settings }>("/settings", { method: "PATCH", body: patch }), {
    success: t("settings.saved"),
    onSuccess: (r) => {
      qc.setQueryData(keys.settings, r.settings);
      void qc.invalidateQueries({ queryKey: ["session"] });
      void qc.invalidateQueries({ queryKey: keys.automations });
      void qc.invalidateQueries({ queryKey: keys.update });
    },
  });
}

function GeneralTab({ settings }: { settings: Settings }) {
  const save = useSaveSettings();
  const { t } = useI18n();
  const [name, setName] = useState(settings.agentName);
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [settings.timezone];
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <Section title={t("settings.tabGeneral")}>
      <Row label={t("settings.agentName")} hint={t("settings.agentNameHint")}>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && name !== settings.agentName) save.mutate({ agentName: name.trim() });
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label={t("settings.agentName")} />
          <Button type="submit" variant="outline" disabled={!name.trim() || name === settings.agentName}>
            {t("common.save")}
          </Button>
        </form>
      </Row>
      <Row
        label={t("settings.timezone")}
        hint={
          settings.timezone !== browserTz ? (
            <button type="button" className="text-accent underline-offset-2 hover:underline" onClick={() => save.mutate({ timezone: browserTz })}>
              {t("settings.useDeviceTimezone", { timezone: browserTz })}
            </button>
          ) : (
            t("settings.timezoneHint")
          )
        }
      >
        <Select value={settings.timezone} onChange={(e) => save.mutate({ timezone: e.target.value })} aria-label={t("settings.timezone")}>
          {(zones.includes(settings.timezone) ? zones : [settings.timezone, ...zones]).map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </Select>
      </Row>
      <Row label={t("settings.language")} hint={t("settings.languageHint")}>
        <Select
          value={settings.language}
          onChange={(e) => {
            const value = e.target.value as Settings["language"];
            applyLanguage(value);
            save.mutate({ language: value });
          }}
          aria-label={t("settings.language")}
        >
          <option value="system">{t("settings.languageSystem", { language: LANGUAGE_NAMES[browserLanguage()] })}</option>
          {LANGUAGES.map((language) => (
            <option key={language} value={language} lang={language}>
              {LANGUAGE_NAMES[language]}
            </option>
          ))}
        </Select>
      </Row>
      <Row label={t("settings.theme")}>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
          {(
            [
              ["system", Monitor, "settings.themeSystem"],
              ["light", Sun, "settings.themeLight"],
              ["dark", Moon, "settings.themeDark"],
            ] as const
          ).map(([value, Icon, label]) => (
            <button type="button"
              key={value}
              onClick={() => {
                applyTheme(value);
                save.mutate({ theme: value });
              }}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium capitalize",
                settings.theme === value ? "bg-surface shadow-sm" : "text-fg-muted",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t(label)}
            </button>
          ))}
        </div>
      </Row>
    </Section>
  );
}

const LIMIT_FIELDS: { key: keyof Limits; label: PlainMessageKey; hint: PlainMessageKey }[] = [
  { key: "maxOutputTokens", label: "settings.limitOutputTokens", hint: "settings.limitOutputTokensHint" },
  { key: "maxContextTokens", label: "settings.limitContextTokens", hint: "settings.limitContextTokensHint" },
  { key: "maxToolCalls", label: "settings.limitToolCalls", hint: "settings.limitToolCallsHint" },
  { key: "maxAgentIterations", label: "settings.limitIterations", hint: "settings.limitIterationsHint" },
  { key: "maxAiRequestsPerDay", label: "settings.limitAiRequests", hint: "settings.limitAiRequestsHint" },
  { key: "maxScheduledAiRunsPerDay", label: "settings.limitScheduledRuns", hint: "settings.limitScheduledRunsHint" },
  { key: "maxPaidAiUsdPerDay", label: "settings.limitPaidUsd", hint: "settings.limitPaidUsdHint" },
];

const PROVIDER_LABEL: Record<AiProviderId, string> = { "workers-ai": "Cloudflare Workers AI", anthropic: "Anthropic", openai: "OpenAI" };

/** The chat model's provider and its fallback. Paid providers need their key on the Worker. */
function ChatModelRows({ settings }: { settings: Settings }) {
  const { t } = useI18n();
  const save = useSaveSettings();
  const info = useSystemInfo();
  const keys = info.data?.paid_ai_keys;
  const usable = (id: AiProviderId) => id === "workers-ai" || keys?.[id] === true;
  const option = (id: AiProviderId) => (
    <option key={id} value={id} disabled={!usable(id) && settings.aiProvider !== id && settings.aiFallback !== id}>
      {PROVIDER_LABEL[id]}
      {usable(id) ? "" : ` (${t("settings.aiNoKey")})`}
    </option>
  );
  return (
    <>
      <Row label={t("settings.aiMain")} hint={t("settings.aiMainHint")}>
        <Select value={settings.aiProvider} disabled={save.isPending} onChange={(e) => save.mutate({ aiProvider: e.target.value as AiProviderId })} aria-label={t("settings.aiMain")}>
          {AI_PROVIDERS.map(option)}
        </Select>
      </Row>
      <Row label={t("settings.aiFallback")} hint={t("settings.aiFallbackHint")}>
        <Select
          value={settings.aiFallback}
          disabled={save.isPending}
          onChange={(e) => save.mutate({ aiFallback: e.target.value as Settings["aiFallback"] })}
          aria-label={t("settings.aiFallback")}
        >
          {AI_FALLBACKS.map((id) => (id === "none" ? <option key={id} value={id}>{t("settings.aiFallbackNone")}</option> : id === settings.aiProvider ? null : option(id)))}
        </Select>
      </Row>
      <Row label={t("settings.anthropicModel")} hint={keys?.anthropic ? undefined : t("settings.aiKeyHint", { secret: "ANTHROPIC_API_KEY" })}>
        <Select value={settings.anthropicModel} disabled={save.isPending} onChange={(e) => save.mutate({ anthropicModel: e.target.value as Settings["anthropicModel"] })} aria-label={t("settings.anthropicModel")}>
          {PAID_MODELS.anthropic.map((m) => (
            <option key={m.id} value={m.id}>
              {t("settings.paidModelOption", { label: m.label, input: m.usdPerMillion.input, output: m.usdPerMillion.output })}
            </option>
          ))}
        </Select>
      </Row>
      <Row label={t("settings.openaiModel")} hint={keys?.openai ? undefined : t("settings.aiKeyHint", { secret: "OPENAI_API_KEY" })}>
        <Select value={settings.openaiModel} disabled={save.isPending} onChange={(e) => save.mutate({ openaiModel: e.target.value as Settings["openaiModel"] })} aria-label={t("settings.openaiModel")}>
          {PAID_MODELS.openai.map((m) => (
            <option key={m.id} value={m.id}>
              {t("settings.paidModelOption", { label: m.label, input: m.usdPerMillion.input, output: m.usdPerMillion.output })}
            </option>
          ))}
        </Select>
      </Row>
    </>
  );
}

function AiTab({ settings }: { settings: Settings }) {
  const i18n = useI18n();
  const { t } = i18n;
  const save = useSaveSettings();
  const usage = useUsage();
  const [model, setModel] = useState(settings.model);
  const [limits, setLimits] = useState<Limits>(settings.limits);
  const [temperature, setTemperature] = useState(settings.temperature);
  const [instructions, setInstructions] = useState(settings.customInstructions);
  const dirtyInstructions = instructions.trim() !== settings.customInstructions;
  const dirtyLimits = JSON.stringify(limits) !== JSON.stringify(settings.limits) || temperature !== settings.temperature;
  return (
    <>
      <Section title={t("settings.model")}>
        <ChatModelRows settings={settings} />
        <Row label={t("settings.workersAiModel")} hint={t("settings.workersAiModelHint", { model: "@cf/zai-org/glm-4.7-flash" })}>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (model !== settings.model) save.mutate({ model: model.trim() });
            }}
          >
            <Input value={model} onChange={(e) => setModel(e.target.value)} aria-label={t("settings.modelId")} className="font-mono text-xs" />
            <Button type="submit" variant="outline" disabled={model === settings.model}>
              {t("common.save")}
            </Button>
          </form>
        </Row>
        <Row label={t("settings.autoMemory")} hint={t("settings.autoMemoryHint")}>
          <div className="flex justify-end">
            <Switch checked={settings.autoMemory} onChange={(v) => save.mutate({ autoMemory: v })} label={t("settings.autoMemory")} />
          </div>
        </Row>
        <Row label={t("settings.demoMode")} hint={t("settings.demoModeHint")}>
          <div className="flex justify-end">
            <Switch checked={settings.demoMode} onChange={(v) => save.mutate({ demoMode: v })} label={t("settings.demoMode")} />
          </div>
        </Row>
      </Section>

      <Section title={t("settings.customInstructions")}>
        <form
          className="space-y-3 px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (dirtyInstructions) save.mutate({ customInstructions: instructions.trim() });
          }}
        >
          <p className="text-xs leading-5 text-fg-subtle">{t("settings.customInstructionsHint")}</p>
          <Textarea
            rows={6}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            maxLength={MAX_CUSTOM_INSTRUCTIONS}
            placeholder={t("settings.customInstructionsPlaceholder")}
            aria-label={t("settings.customInstructions")}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs tabular-nums text-fg-subtle">
              {t("settings.customInstructionsCount", { count: instructions.length, max: MAX_CUSTOM_INSTRUCTIONS })}
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" disabled={instructions === settings.customInstructions} onClick={() => setInstructions(settings.customInstructions)}>
                {t("settings.reset")}
              </Button>
              <Button type="submit" disabled={!dirtyInstructions} loading={save.isPending}>
                {t("common.save")}
              </Button>
            </div>
          </div>
        </form>
      </Section>

      <Section title={t("settings.limits")}>
        <Row label={t("settings.temperature")} hint={t("settings.temperatureHint")}>
          <div className="flex items-center gap-3">
            <input type="range" min={0} max={1.5} step={0.1} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" aria-label={t("settings.temperature")} />
            <span className="w-8 text-right text-sm tabular-nums">{temperature.toFixed(1)}</span>
          </div>
        </Row>
        {LIMIT_FIELDS.map((f) => (
          <Row key={f.key} label={t(f.label)} hint={`${t(f.hint)} ${t("settings.limitMax", { max: LIMIT_CEILINGS[f.key] })}`}>
            <Input
              type="number"
              min={0}
              max={LIMIT_CEILINGS[f.key]}
              step={f.key === "maxPaidAiUsdPerDay" ? 0.5 : 1}
              value={limits[f.key]}
              onChange={(e) => setLimits({ ...limits, [f.key]: Number(e.target.value) })}
              aria-label={t(f.label)}
            />
          </Row>
        ))}
        <div className="flex justify-end gap-2 px-5 py-3">
          <Button
            variant="ghost"
            disabled={!dirtyLimits}
            onClick={() => {
              setLimits(settings.limits);
              setTemperature(settings.temperature);
            }}
          >
            {t("settings.reset")}
          </Button>
          <Button disabled={!dirtyLimits} loading={save.isPending} onClick={() => save.mutate({ limits, temperature })}>
            {t("settings.saveLimits")}
          </Button>
        </div>
      </Section>

      <Section title={t("settings.usage")}>
        {usage.isLoading || !usage.data ? (
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
              {[
                [t("settings.usageRequestsToday"), `${usage.data.today.ai_requests} / ${usage.data.limits.maxAiRequestsPerDay}`],
                [t("settings.usageErrorsToday"), usage.data.today.ai_errors.toLocaleString(i18n.locale)],
                [t("settings.usageToolCallsToday"), String(usage.data.today.tool_calls)],
                [t("settings.usageScheduledRuns"), `${usage.data.today.scheduled_ai_runs} / ${usage.data.limits.maxScheduledAiRunsPerDay}`],
              ].map(([label, value]) => (
                <div key={label} className="bg-surface px-5 py-4">
                  <p className="text-xs text-fg-subtle">{label}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
                </div>
              ))}
            </div>
            <div className="grid gap-px bg-border md:grid-cols-2">
              <div className="bg-surface px-5 py-4">
                <h3 className="mb-3 text-sm font-medium">{t("settings.usageTodayUtc")}</h3>
                <UsageBreakdown counters={usage.data.today} />
              </div>
              <div className="bg-surface px-5 py-4">
                <h3 className="mb-3 text-sm font-medium">{t("settings.usageLast7Days")}</h3>
                <p className="mb-3 text-xs tabular-nums text-fg-muted">
                  {t("settings.usageWeekSummary", {
                    requests: usage.data.last_7_days.ai_requests,
                    errors: usage.data.last_7_days.ai_errors,
                    tools: usage.data.last_7_days.tool_calls,
                    runs: usage.data.last_7_days.scheduled_ai_runs,
                  })}
                </p>
                <UsageBreakdown counters={usage.data.last_7_days} />
              </div>
            </div>
            <div className="px-5 py-4 text-xs leading-5 text-fg-subtle">
              <Badge tone="warning" className="mb-2">
                {t("settings.usageEstimates")}
              </Badge>
              <UsagePricingNote data={usage.data} />
              <a href={usage.data.dashboard_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-accent hover:underline">
                {t("settings.usageDashboard")} <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </>
        )}
      </Section>
      <SemanticRecallCard />
      <MemoryHistorySection settings={settings} />
    </>
  );
}

function MemoryHistorySection({ settings }: { settings: Settings }) {
  const { t } = useI18n();
  const save = useSaveSettings();
  const mh = settings.memoryHistory;
  return (
    <Section title={t("settings.memoryHistory")}>
      <Row label={t("settings.conflictReview")} hint={t("settings.conflictReviewHint")}>
        <div className="flex justify-end">
          <Switch checked={mh.conflictReview} onChange={(v) => save.mutate({ memoryHistory: { conflictReview: v } })} label={t("settings.conflictReview")} />
        </div>
      </Row>
      {mh.conflictReview && (
        <Row label={t("settings.aiConflictCheck")} hint={t("settings.aiConflictCheckHint")}>
          <div className="flex justify-end">
            <Switch checked={mh.aiConflictCheck} onChange={(v) => save.mutate({ memoryHistory: { aiConflictCheck: v } })} label={t("settings.aiConflictCheck")} />
          </div>
        </Row>
      )}
    </Section>
  );
}

function PrivacyTab() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [confirm, setConfirm] = useState<"history" | "memories" | null>(null);
  const clear = useApiMutation(
    (what: "history" | "memories") => api(what === "history" ? "/conversations" : "/memories", { method: "DELETE", body: { confirm: "DELETE" } }),
    {
      invalidate: [["conversations"], ["memories"]],
      success: (r) => t("settings.deletedItems", { count: (r as { deleted: number }).deleted }),
      onSuccess: () => setConfirm(null),
    },
  );

  const [exporting, setExporting] = useState(false);
  /** Fetched rather than linked, so a password prompt can come first when the server asks for one. */
  async function onExport() {
    setExporting(true);
    try {
      const backup = await api<unknown>("/export");
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "talorys-backup.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast(errorMessage(error, t("common.somethingWentWrong")), "error");
    } finally {
      setExporting(false);
    }
  }

  async function onImport(file: File) {
    setImporting(true);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error(t("settings.backupTooLarge"));
      const json = JSON.parse(await file.text());
      const r = await api<{ imported: Record<string, number> & { automations_paused: number; mcp_servers?: number; ignored_settings: string[] } }>("/import", {
        method: "POST",
        body: json,
      });
      const { automations_paused, mcp_servers, ignored_settings, ...counts } = r.imported;
      const notes = [
        automations_paused ? t("settings.importAutomationsPaused", { count: automations_paused }) : "",
        mcp_servers ? t("settings.importMcpOff", { count: mcp_servers }) : "",
        ignored_settings.length ? t("settings.importKeptSettings", { settings: ignored_settings.join(", ") }) : "",
      ].filter(Boolean);
      const imported = t("settings.imported", { items: Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ") });
      toast(`${imported}${notes.length ? `. ${notes.join("; ")}.` : ""}`);
      await qc.invalidateQueries();
    } catch (error) {
      toast(error instanceof SyntaxError ? t("settings.invalidJson") : errorMessage(error, t("common.somethingWentWrong")), "error");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <>
      <Section title={t("settings.yourData")}>
        <div className="px-5 py-4 text-sm leading-6 text-fg-muted">{t("settings.yourDataDescription")}</div>
        <Row label={t("settings.export")} hint={t("settings.exportHint")}>
          <Button variant="outline" className="w-full justify-center" loading={exporting} onClick={() => void onExport()}>
            <Download className="h-4 w-4" /> {t("settings.downloadBackup")}
          </Button>
        </Row>
        <Row label={t("settings.import")} hint={t("settings.importHint")}>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && void onImport(e.target.files[0])} />
          <Button variant="outline" className="w-full justify-center" loading={importing} onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4" /> {t("settings.chooseBackup")}
          </Button>
        </Row>
      </Section>
      <StorageCard />
      <Section title={t("settings.dangerZone")}>
        <Row label={t("settings.deleteHistory")} hint={t("settings.deleteHistoryHint")}>
          <Button variant="outline" className="w-full justify-center text-danger" onClick={() => setConfirm("history")}>
            {t("settings.deleteHistoryButton")}
          </Button>
        </Row>
        <Row label={t("settings.clearMemories")} hint={t("settings.clearMemoriesHint")}>
          <Button variant="outline" className="w-full justify-center text-danger" onClick={() => setConfirm("memories")}>
            {t("settings.clearMemories")}
          </Button>
        </Row>
      </Section>
      <ConfirmDialog
        open={!!confirm}
        title={confirm === "history" ? t("settings.deleteAllConversations") : t("settings.clearAllMemories")}
        message={t("settings.cannotUndo")}
        confirmLabel={confirm === "history" ? t("settings.deleteAll") : t("settings.clearAll")}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && clear.mutate(confirm)}
        loading={clear.isPending}
      />
    </>
  );
}

/** Choices for each timeout, within the range the server enforces. */
const TIMEOUT_CHOICES: Record<keyof SessionTimeouts, number[]> = {
  idleMinutes: [5, 10, 15, 20, 30, 45, 60],
  presenceMinutes: [3, 5, 10, 15],
  maxHours: [1, 2, 4, 6, 8, 12, 24],
};

function SessionTimeoutsSection({ settings }: { settings: Settings }) {
  const { t } = useI18n();
  const save = useSaveSettings();
  const rows: { key: keyof SessionTimeouts; label: string; hint: string; unit: (n: number) => string }[] = [
    { key: "idleMinutes", label: t("settings.idleTimeout"), hint: t("settings.idleTimeoutHint"), unit: (n) => t("settings.minutes", { count: n }) },
    { key: "presenceMinutes", label: t("settings.presenceTimeout"), hint: t("settings.presenceTimeoutHint"), unit: (n) => t("settings.minutes", { count: n }) },
    { key: "maxHours", label: t("settings.maxSession"), hint: t("settings.maxSessionHint"), unit: (n) => t("settings.hours", { count: n }) },
  ];
  return (
    <Section title={t("settings.sessionTimeouts")}>
      {rows.map(({ key, label, hint, unit }) => {
        const [min, max] = SESSION_TIMEOUT_RANGES[key];
        const value = settings.session[key];
        const choices = [...new Set([...TIMEOUT_CHOICES[key], value])].filter((n) => n >= min && n <= max).sort((a, b) => a - b);
        return (
          <Row key={key} label={label} hint={hint}>
            <Select value={value} onChange={(e) => save.mutate({ session: { [key]: Number(e.target.value) } })} aria-label={label} disabled={save.isPending}>
              {choices.map((n) => (
                <option key={n} value={n}>
                  {unit(n)}
                </option>
              ))}
            </Select>
          </Row>
        );
      })}
      <p className="px-5 py-3 text-xs leading-5 text-fg-subtle">{t("settings.sessionTimeoutsNote")}</p>
    </Section>
  );
}

function SecurityTab({ settings }: { settings: Settings }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { logout } = useSession();
  const sessions = useSessions();
  const mfa = useMfaStatus();
  const revoke = useApiMutation((id: string) => api(`/auth/sessions/${id}`, { method: "DELETE" }), { invalidate: [keys.sessions], success: t("settings.sessionSignedOut") });
  const revokeOthers = useApiMutation(() => api("/auth/sessions/revoke-others", { method: "POST", body: {} }), {
    invalidate: [keys.sessions],
    success: t("settings.othersSignedOut"),
  });

  return (
    <>
      <Section title={t("settings.changePassword")}>
        <ChangePasswordForm agentName={settings.agentName} />
      </Section>
      <TwoFactorCard timezone={settings.timezone} />
      {mfa.data?.enabled && <PasskeysCard timezone={settings.timezone} />}
      <SessionTimeoutsSection settings={settings} />
      <Section title={t("settings.activeSessions")}>
        {sessions.isLoading ? (
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        ) : (
          sessions.data?.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm">
                  {describeAgent(s.user_agent, t)} {s.current && <Badge tone="accent">{t("settings.thisDevice")}</Badge>}
                </p>
                <p className="text-xs text-fg-subtle">
                  {t("settings.sessionTimes", { signedIn: relativeTime(s.created_at, i18n), active: relativeTime(s.last_seen_at, i18n) })}
                </p>
              </div>
              {!s.current && (
                <Button variant="ghost" size="sm" onClick={() => revoke.mutate(s.id)}>
                  {t("settings.signOut")}
                </Button>
              )}
            </div>
          ))
        )}
        <div className="flex flex-wrap justify-end gap-2 px-5 py-3">
          <Button variant="outline" size="sm" onClick={() => revokeOthers.mutate(undefined)} loading={revokeOthers.isPending}>
            {t("settings.signOutOthers")}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void logout()}>
            <LogOut className="h-3.5 w-3.5" /> {t("settings.lockDevice")}
          </Button>
        </div>
      </Section>
      <p className="px-1 text-xs leading-5 text-fg-subtle">
        {i18n.rich("settings.forgotPassword", { command: <code className="rounded bg-muted px-1">npx create-talorys@latest reset-password</code> })}
      </p>
      <AuthActivityCard timezone={settings.timezone} />
      <RemoteAccessCard />
    </>
  );
}

function AboutTab({ settings }: { settings: Settings }) {
  const { t } = useI18n();
  const info = useSystemInfo();
  const update = useUpdateStatus();
  const save = useSaveSettings();
  const latest = update.data?.update_available ? update.data.latest : null;
  return (
    <Section title={t("settings.aboutTitle")}>
      <Row label={t("settings.version")} hint={latest ? t("settings.versionAvailable", { version: latest }) : undefined}>
        <div className="flex items-center justify-end gap-2">
          {latest && <Badge tone="accent">{t("settings.new")}</Badge>}
          <p className="font-mono text-sm">{info.data?.deployed_version ?? TALORYS_VERSION}</p>
        </div>
      </Row>
      <Row label={t("settings.updateCheck")} hint={t("settings.updateCheckHint")}>
        <div className="flex justify-end">
          <Switch checked={settings.updateCheck} onChange={(v) => save.mutate({ updateCheck: v })} label={t("settings.updateCheck")} />
        </div>
      </Row>
      <Row label={t("settings.deployment")} hint={t("settings.deploymentHint")}>
        <div className="space-y-1 text-right text-xs text-fg-muted">
          {info.data ? (
            <>
              <p>
                {t("settings.installation")} <span className="font-mono">{info.data.installation_id ?? "local"}</span>
              </p>
              <p>
                {t("settings.schema", { version: info.data.schema_version })} · {info.data.environment}
              </p>
              <p>
                {t("settings.aiProvider")}{" "}
                {info.data.ai_provider in PROVIDER_LABEL ? PROVIDER_LABEL[info.data.ai_provider as AiProviderId] : info.data.ai_provider === "mock" ? t("settings.demoResponder") : t("settings.notAvailable")}
              </p>
            </>
          ) : (
            <Spinner className="ml-auto h-4 w-4" />
          )}
        </div>
      </Row>
      <Row label={t("settings.sourceCode")} hint={t("settings.sourceCodeHint")}>
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="flex items-center justify-end gap-1 text-sm text-accent hover:underline">
          GitHub <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </Row>
      <Row label={t("settings.update")} hint={t("settings.updateHint")}>
        <code className="block rounded bg-muted px-2 py-1 text-right text-xs">npx create-talorys@latest update</code>
      </Row>
    </Section>
  );
}
