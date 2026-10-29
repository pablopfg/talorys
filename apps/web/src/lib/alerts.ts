import type { AlertPriority } from "@talorys/shared";
import type { PlainMessageKey } from "./i18n";

export const PRIORITY_LABELS: Record<AlertPriority, PlainMessageKey> = {
  low: "alerts.priority.low",
  normal: "alerts.priority.normal",
  high: "alerts.priority.high",
  critical: "alerts.priority.critical",
};

export const PRIORITY_TONES = { low: "neutral", normal: "neutral", high: "warning", critical: "danger" } as const;
