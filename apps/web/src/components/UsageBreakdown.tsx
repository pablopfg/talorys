import type { UsageCounters, UsageReport } from "@talorys/shared";
import { type I18n, useI18n } from "../lib/i18n";

/** Estimates carry little precision, so show two or three significant digits. */
function formatEstimate(value: number | null, locale: string, currency = false): string {
  if (value === null) return "—";
  if (currency) {
    if (value > 0 && value < 0.0001) return "<$0.0001";
    return `$${value >= 0.01
      ? value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : value.toLocaleString(locale, { maximumSignificantDigits: 2 })}`;
  }
  if (value > 0 && value < 0.01) return "<0.01";
  return value >= 100
    ? value.toLocaleString(locale, { maximumFractionDigits: 0 })
    : value.toLocaleString(locale, { maximumSignificantDigits: 3 });
}

/** Reported count first; estimated and legacy parts only when present, e.g. "39,527 + 23 est.". */
function formatTokens(reported: number, estimated: number, legacy: number, { locale, t }: Pick<I18n, "locale" | "t">): string {
  const parts = [reported.toLocaleString(locale)];
  if (estimated > 0) parts.push(t("usage.estimated", { count: estimated }));
  if (legacy > 0) parts.push(t("usage.legacy", { count: legacy }));
  return parts.join(" + ");
}

export function UsageBreakdown({ counters, compact = false }: { counters: UsageCounters; compact?: boolean }) {
  const i18n = useI18n();
  const { locale, t } = i18n;
  const suffix = (label: string) => (partial ? t("usage.partial", { label }) : label);
  const legacy = counters.input_tokens_legacy + counters.output_tokens_legacy;
  const partial = counters.unpriced_calls > 0 || legacy > 0;
  const cost: [string, string] = [suffix(t("usage.estCost")), formatEstimate(counters.cost_usd_estimate, locale, true)];
  const rows: [string, string][] = compact ? [
    [t("usage.tokens"), formatTokens(
      counters.input_tokens_reported + counters.output_tokens_reported,
      counters.input_tokens_estimated + counters.output_tokens_estimated,
      legacy,
      i18n,
    )],
    cost,
    [t("usage.embeddings"), counters.embedding_requests.toLocaleString(locale)],
  ] : [
    [t("usage.inputTokens"), formatTokens(counters.input_tokens_reported, counters.input_tokens_estimated, counters.input_tokens_legacy, i18n)],
    [t("usage.outputTokens"), formatTokens(counters.output_tokens_reported, counters.output_tokens_estimated, counters.output_tokens_legacy, i18n)],
    [suffix(t("usage.estNeurons")), formatEstimate(counters.neurons_estimate, locale)],
    cost,
    [t("usage.embeddingRequests"), counters.embedding_requests.toLocaleString(locale)],
    [t("usage.voiceInput"), t("usage.voiceMinutes", { minutes: (counters.transcription_seconds / 60).toLocaleString(locale, { maximumFractionDigits: 1 }) })],
  ];
  if (counters.mock_calls > 0) rows.push([t("usage.mockCalls"), counters.mock_calls.toLocaleString(locale)]);

  const coverage = [counters.priced_calls === 0 ? t("usage.noPricedCalls") : t("usage.pricedCalls", { count: counters.priced_calls })];
  if (counters.unpriced_calls > 0) coverage.push(t("usage.unpricedCalls", { count: counters.unpriced_calls }));
  if (legacy > 0) coverage.push(t("usage.legacyUnpriced"));
  if (counters.mock_calls > 0) coverage.push(t("usage.mockFree"));

  return <div>
    <dl className="space-y-2 text-xs text-fg-muted">
      {rows.map(([label, value]) => <div key={label} className="flex justify-between gap-3">
        <dt>{label}</dt><dd className="shrink-0 tabular-nums text-fg">{value}</dd>
      </div>)}
    </dl>
    {/* The compact popover links to Settings, which carries this note. */}
    {!compact && <p className="mt-3 text-xs leading-5 text-fg-subtle">{coverage.join(" · ")}</p>}
  </div>;
}

export function UsagePricingNote({ data }: { data: UsageReport }) {
  const { locale, rich, t } = useI18n();
  return <p className="text-xs leading-5 text-fg-subtle">
    {data.note}{" "}
    {rich("usage.pricingNote", {
      link: <a href={data.pricing.source_url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{t("usage.pricingLink")}</a>,
      date: data.pricing.as_of,
      rate: `$${data.pricing.usd_per_1000_neurons.toLocaleString(locale, { maximumFractionDigits: 8 })}`,
    })}
  </p>;
}
