import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { PendingAction } from "@talorys/shared";
import { CheckCircle2, ShieldAlert, XCircle } from "lucide-react";
import { Button } from "./ui";
import { keys, useApiMutation } from "../hooks/queries";
import { api } from "../lib/api";
import { cn } from "../lib/utils";
import { type PlainMessageKey, useI18n } from "../lib/i18n";

const APPROVAL_DONE: Record<Exclude<PendingAction["status"], "pending">, PlainMessageKey> = {
  approved: "approval.approved",
  cancelled: "approval.cancelled",
  expired: "approval.expired",
  failed: "approval.failed",
};

/** The only way a destructive action, or an external MCP call that asks first, proposed by the agent can run. */
export function ApprovalCard({ action: initial }: { action: PendingAction }) {
  const { t, serverText } = useI18n();
  const qc = useQueryClient();
  const [action, setAction] = useState(initial);
  useEffect(() => setAction(initial), [initial]);
  const decide = useApiMutation(
    (decision: "approve" | "cancel") =>
      api<{ action: PendingAction }>(`/actions/${action.id}/${decision}`, { method: "POST", body: {} }).catch((error: unknown) => {
        // Already handled or expired elsewhere: show the current state.
        void qc.invalidateQueries({ queryKey: ["conversation"] });
        throw error;
      }),
    {
      invalidate: [["conversation"], keys.tasks, ["notes"], ["memories"], keys.automations],
      onSuccess: (r) => setAction(r.action),
    },
  );
  const status = action.status === "pending" && Date.parse(action.expires_at) <= Date.now() ? "expired" : action.status;
  const external = action.kind === "external";

  if (status !== "pending") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-border bg-subtle px-3 py-2 text-sm text-fg-muted">
        {status === "approved" ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
        ) : (
          <XCircle className={cn("mt-0.5 h-4 w-4 shrink-0", status === "failed" && "text-danger")} />
        )}
        <span className="min-w-0 break-words">
          <span className="text-fg">{serverText(action.summary)}</span> · {t(APPROVAL_DONE[status])}
          {status === "failed" && action.error ? `: ${serverText(action.error)}` : ""}
          {action.result && <span className="mt-1 block whitespace-pre-wrap text-xs text-fg-subtle">{action.result}</span>}
        </span>
      </div>
    );
  }
  return (
    <div role="group" aria-label={t("approval.needed")} className="rounded-lg border border-warning/40 bg-surface px-3 py-2.5 shadow-sm">
      <div className="flex items-start gap-2 text-sm">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="min-w-0">
          <p className="break-words font-medium text-fg">{serverText(action.summary)}?</p>
          <p className="text-xs text-fg-muted">
            {external ? t("approval.externalHint") : t("approval.hint")}
          </p>
        </div>
      </div>
      {action.preview !== undefined && (
        <div className="mt-2">
          <p className="text-xs font-medium text-fg-muted">{external ? t("approval.willSend") : t("approval.newText")}</p>
          {/* Plain text, never rendered as Markdown: this is exactly what will be saved. */}
          <div
            role="region"
            aria-label={external ? t("approval.arguments") : t("approval.proposedText")}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: lets keyboard users scroll a long proposal.
            tabIndex={0}
            className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-subtle p-2 text-xs text-fg"
          >
            {action.preview}
          </div>
        </div>
      )}
      <div className="mt-2.5 flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate("cancel")}>
          {t("approval.decline")}
        </Button>
        <Button size="sm" variant="danger" loading={decide.isPending && decide.variables === "approve"} disabled={decide.isPending} onClick={() => decide.mutate("approve")}>
          {t("approval.approve")}
        </Button>
      </div>
    </div>
  );
}
