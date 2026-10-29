import { useEffect, useId, useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { TASK_PLAN_LIMITS, TASK_PRIORITIES, type PlanTask, type TaskPlanContent, type TaskPlanDraft, type TaskPriority } from "@talorys/shared";
import { ArrowRight, CalendarDays, CheckCircle2, ListChecks, Pencil, RotateCcw, Trash2, XCircle } from "lucide-react";
import { Badge, Button, Input, Select, Textarea } from "./ui";
import { keys, useApiMutation, useProjects } from "../hooks/queries";
import { api } from "../lib/api";
import { cn } from "../lib/utils";
import { type I18n, type PlainMessageKey, useI18n } from "../lib/i18n";

const PRIORITY_TONE: Record<TaskPriority, "neutral" | "accent" | "warning" | "danger"> = {
  low: "neutral",
  medium: "accent",
  high: "warning",
  urgent: "danger",
};
const PRIORITY_LABEL: Record<TaskPriority, PlainMessageKey> = {
  low: "tasks.priorityLow",
  medium: "tasks.priorityMedium",
  high: "tasks.priorityHigh",
  urgent: "tasks.priorityUrgent",
};

/** "2026-11-03" or "2026-11-03T09:30" (owner's timezone) as a short label. The calendar date is shown as written. */
function dueLabel(due: string, locale: string): string {
  const [date, time] = due.split("T");
  const [y, m, d] = date!.split("-").map(Number);
  const label = new Date(y!, m! - 1, d!).toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
  return time ? `${label}, ${time}` : label;
}

function projectLabel(project: TaskPlanContent["project"], t: I18n["t"]): string | null {
  if (project.mode === "new") return project.name.trim() ? t("plan.newProjectNamed", { name: project.name.trim() }) : t("plan.newProject");
  if (project.mode === "existing") return t("plan.inProject", { name: project.name ?? t("plan.project") });
  return null;
}

type Mutation = { kind: "save" | "confirm"; plan: TaskPlanContent } | { kind: "cancel" };

/**
 * A plan the agent proposed, shown in chat. Nothing exists as a task until the owner confirms;
 * edits are saved to the draft on the server so they survive a reload.
 */
export function TaskPlanCard({ plan: initial }: { plan: TaskPlanDraft }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [draft, setDraft] = useState(initial);
  const [editing, setEditing] = useState<TaskPlanContent | null>(null);
  // Conversation refetches hand over a new object each time; only a real change (another tab
  // saved, confirmed or cancelled) replaces the draft and closes the editor.
  useEffect(() => {
    setDraft(initial);
    setEditing(null);
  }, [initial.id, initial.revision, initial.status]);

  const base = `/conversations/${draft.conversation_id}/task-plans/${draft.id}`;
  const act = useApiMutation(
    (m: Mutation) => {
      const req =
        m.kind === "cancel"
          ? api<{ plan: TaskPlanDraft }>(`${base}/cancel`, { method: "POST", body: {} })
          : api<{ plan: TaskPlanDraft }>(m.kind === "save" ? base : `${base}/confirm`, {
              method: m.kind === "save" ? "PATCH" : "POST",
              body: { revision: draft.revision, plan: m.plan },
            });
      return req.catch((error: unknown) => {
        // Changed, confirmed or expired elsewhere: show the current state.
        void qc.invalidateQueries({ queryKey: ["conversation"] });
        throw error;
      });
    },
    {
      invalidate: [keys.tasks, keys.projects],
      success: (r) =>
        r.plan.status === "confirmed"
          ? t("plan.createdTasks", { count: r.plan.result?.task_ids.length ?? 0 })
          : r.plan.status === "cancelled"
            ? t("plan.cancelled")
            : t("plan.saved"),
      onSuccess: (r) => {
        setDraft(r.plan);
        setEditing(null);
        void qc.invalidateQueries({ queryKey: ["conversation"] });
      },
    },
  );

  const status = draft.status === "pending" && Date.parse(draft.expires_at) <= Date.now() ? "expired" : draft.status;
  const plan = editing ?? draft.plan;
  const busy = act.isPending;
  const invalid = plan.tasks.length === 0 || !plan.title.trim() || plan.tasks.some((task) => !task.title.trim()) || (plan.project.mode === "new" && !plan.project.name.trim());

  if (status === "confirmed") {
    const count = draft.result?.task_ids.length ?? draft.plan.tasks.length;
    return (
      <div role="group" aria-label={t("plan.confirmedLabel")} className="rounded-lg border border-border bg-subtle px-3 py-2.5 text-sm">
        <div className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <div className="min-w-0 flex-1">
            <p className="break-words font-medium text-fg">{draft.plan.title}</p>
            <p className="text-xs text-fg-muted">
              {t("plan.createdTasks", { count })}
              {draft.plan.project.mode !== "none" && ` ${t("plan.inProject", { name: draft.plan.project.name ?? "" })}`}
              {draft.result?.project_created && ` ${t("plan.newProjectSuffix")}`}
            </p>
          </div>
          <Link to="/tasks" className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-accent hover:bg-muted">
            {t("plan.viewTasks")} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <ul className="mt-2 space-y-1 pl-6 text-fg-muted">
          {draft.plan.tasks.map((task) => (
            <li key={task.client_id} className="break-words">{task.title}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (status === "cancelled" || status === "expired") {
    return (
      <div role="group" aria-label={t("plan.closedLabel")} className="flex items-start gap-2 rounded-lg border border-border bg-subtle px-3 py-2 text-sm text-fg-muted">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="min-w-0 break-words">
          <span className="text-fg">{t("plan.named", { title: draft.plan.title })}</span> ·{" "}
          {status === "cancelled" ? t("plan.cancelledNothing") : t("plan.expired")}
        </span>
      </div>
    );
  }

  const removed = editing ? draft.plan.tasks.filter((task) => !editing.tasks.some((e) => e.client_id === task.client_id)) : [];
  const meta = [t("plan.taskCount", { count: plan.tasks.length }), projectLabel(plan.project, t)].filter(Boolean).join(" · ");
  const setTask = (clientId: string, patch: Partial<PlanTask>) =>
    setEditing((e) => e && { ...e, tasks: e.tasks.map((task) => (task.client_id === clientId ? { ...task, ...patch } : task)) });

  return (
    <div role="group" aria-label={t("plan.proposed")} className="rounded-lg border border-accent/30 bg-surface shadow-sm">
      <div className="flex items-start gap-2 border-b border-border px-3 py-2.5">
        <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{t("plan.proposed")}</p>
          {editing ? (
            <Input
              aria-label={t("plan.title")}
              value={editing.title}
              maxLength={TASK_PLAN_LIMITS.title}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              className="mt-1 h-9 font-medium"
            />
          ) : (
            <p className="break-words font-medium text-fg">{plan.title}</p>
          )}
          <p className="mt-0.5 text-xs text-fg-muted">{meta}</p>
        </div>
      </div>

      {editing && <ProjectPicker project={editing.project} onChange={(project) => setEditing({ ...editing, project })} />}

      <ol className="divide-y divide-border" aria-label={t("plan.proposedTasks")}>
        {plan.tasks.map((task, i) =>
          editing ? (
            <TaskEditor
              key={task.client_id}
              task={task}
              index={i}
              onChange={(patch) => setTask(task.client_id, patch)}
              onRemove={() => setEditing({ ...editing, tasks: editing.tasks.filter((x) => x.client_id !== task.client_id) })}
            />
          ) : (
            <li key={task.client_id} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-start sm:gap-3">
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm text-fg">{task.title}</p>
                {task.description && <p className="mt-0.5 line-clamp-2 break-words text-xs text-fg-muted">{task.description}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {task.due && <DueChip task={task} />}
                <Badge tone={PRIORITY_TONE[task.priority]}>{t(PRIORITY_LABEL[task.priority])}</Badge>
              </div>
            </li>
          ),
        )}
      </ol>

      {editing && plan.tasks.length === 0 && <p className="px-3 py-2 text-sm text-fg-muted">{t("plan.keepOne")}</p>}
      {removed.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2 text-xs text-fg-muted">
          <span>{t("plan.removed", { count: removed.length })}</span>
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
            onClick={() => setEditing({ ...editing!, tasks: draft.plan.tasks.map((o) => editing!.tasks.find((e) => e.client_id === o.client_id) ?? o) })}
          >
            <RotateCcw className="h-3 w-3" /> {t("plan.restore")}
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-3 py-2.5">
        <p className="mr-auto text-xs text-fg-muted">{editing ? t("plan.saveHint") : t("plan.confirmHint")}</p>
        {editing ? (
          <>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(null)}>
              {t("plan.discard")}
            </Button>
            <Button size="sm" variant="outline" disabled={busy || invalid} loading={busy && act.variables?.kind === "save"} onClick={() => act.mutate({ kind: "save", plan: editing })}>
              {t("common.save")}
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="ghost" disabled={busy} loading={busy && act.variables?.kind === "cancel"} onClick={() => act.mutate({ kind: "cancel" })}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(structuredClone(draft.plan))}>
              <Pencil className="h-3.5 w-3.5" /> {t("memory.editShort")}
            </Button>
          </>
        )}
        <Button size="sm" disabled={busy || invalid} loading={busy && act.variables?.kind === "confirm"} onClick={() => act.mutate({ kind: "confirm", plan })}>
          {t("plan.confirm")}
        </Button>
      </div>
    </div>
  );
}

function DueChip({ task }: { task: PlanTask }) {
  const { t, locale } = useI18n();
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs text-fg-muted"
      title={task.due_suggested ? t("plan.suggestedDateHint") : t("plan.yourDeadline")}
    >
      <CalendarDays className="h-3 w-3" />
      {dueLabel(task.due!, locale)}
      {task.due_suggested && <span className="italic">· {t("plan.suggested")}</span>}
    </span>
  );
}

function ProjectPicker({ project, onChange }: { project: TaskPlanContent["project"]; onChange: (p: TaskPlanContent["project"]) => void }) {
  const { t } = useI18n();
  const projects = useProjects();
  const id = useId();
  const value = project.mode === "existing" ? project.id : project.mode;
  return (
    // Wraps by the card's own width (chat columns are narrow even on desktop), not by viewport breakpoints.
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
      <label htmlFor={`${id}-project`} className="w-full text-xs font-medium text-fg-muted">
        {t("tasks.fieldProject")}
      </label>
      <div className="min-w-40 flex-1">
      <Select
        id={`${id}-project`}
        className="h-9"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "none") onChange({ mode: "none" });
          else if (v === "new") onChange({ mode: "new", name: project.mode === "new" ? project.name : "" });
          else onChange({ mode: "existing", id: v, name: projects.data?.find((p) => p.id === v)?.name });
        }}
      >
        <option value="none">{t("notes.noProject")}</option>
        <option value="new">{t("plan.newProjectOption")}</option>
        {project.mode === "existing" && !projects.data?.some((p) => p.id === project.id) && <option value={project.id}>{project.name ?? t("plan.currentProject")}</option>}
        {projects.data
          ?.filter((p) => p.status !== "archived")
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </Select>
      </div>
      {project.mode === "new" && (
        <div className="min-w-48 flex-[2]">
          <Input
            aria-label={t("projects.newName")}
            placeholder={t("projects.name")}
            className={cn("h-9", !project.name.trim() && "border-danger")}
            maxLength={TASK_PLAN_LIMITS.projectName}
            value={project.name}
            onChange={(e) => onChange({ mode: "new", name: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}

function TaskEditor({ task, index, onChange, onRemove }: { task: PlanTask; index: number; onChange: (p: Partial<PlanTask>) => void; onRemove: () => void }) {
  const { t } = useI18n();
  const id = useId();
  const n = index + 1;
  return (
    <li className="space-y-2 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Input
          aria-label={t("plan.taskTitle", { n })}
          value={task.title}
          maxLength={TASK_PLAN_LIMITS.taskTitle}
          onChange={(e) => onChange({ title: e.target.value })}
          className={cn("h-9", !task.title.trim() && "border-danger")}
        />
        <Button size="icon" variant="ghost" aria-label={t("plan.removeTask", { n, title: task.title })} onClick={onRemove} className="h-9 w-9">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <Textarea
        aria-label={t("plan.taskDescription", { n })}
        placeholder={t("plan.descriptionPlaceholder")}
        rows={2}
        maxLength={TASK_PLAN_LIMITS.taskDescription}
        value={task.description}
        onChange={(e) => onChange({ description: e.target.value })}
        className="text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-priority`} className="sr-only">
          {t("plan.taskPriority", { n })}
        </label>
        <div className="w-28">
          <Select id={`${id}-priority`} className="h-9" value={task.priority} onChange={(e) => onChange({ priority: e.target.value as TaskPriority })}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(PRIORITY_LABEL[p])}
              </option>
            ))}
          </Select>
        </div>
        <label htmlFor={`${id}-due`} className="sr-only">
          {t("plan.taskDue", { n })}
        </label>
        <div className="w-40">
        <Input
          id={`${id}-due`}
          type="date"
          className="h-9"
          value={task.due?.slice(0, 10) ?? ""}
          onChange={(e) => {
            const date = e.target.value;
            // Picking a date makes it the owner's own deadline; a time the agent proposed is kept.
            onChange({ due: date ? `${date}${task.due?.slice(10) ?? ""}` : null, due_suggested: false });
          }}
        />
        </div>
        {task.due && (
          <Button size="sm" variant="ghost" onClick={() => onChange({ due: null, due_suggested: false })} aria-label={t("plan.clearDueOf", { n })}>
            {t("plan.clearDate")}
          </Button>
        )}
        {task.due && task.due_suggested && <span className="text-xs italic text-fg-muted">{t("plan.suggestedDate")}</span>}
      </div>
    </li>
  );
}
