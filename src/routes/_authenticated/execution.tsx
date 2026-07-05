import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PageHeader, PageBody } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { listProjects } from "@/lib/projects.functions";
import { createMilestone, listMilestones, updateMilestone } from "@/lib/operations.functions";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import { daysUntil } from "@/lib/platform-insights";
import { MILESTONE_TEMPLATES, expandTemplate } from "@/lib/milestone-templates";
import { computeCriticalPath, type ExecMilestone } from "@/lib/execution/critical-path";
import {
  CalendarCheck,
  CheckCircle2,
  CircleDashed,
  Plus,
  ShieldAlert,
  ListChecks,
  Clock,
  AlertTriangle,
  Ban,
} from "lucide-react";
import { toast } from "sonner";

const projectsQ = queryOptions({ queryKey: ["projects"], queryFn: () => listProjects() });
const milestonesQ = queryOptions({ queryKey: ["milestones"], queryFn: () => listMilestones() });

export const Route = createFileRoute("/_authenticated/execution")({
  head: () => ({ meta: [{ title: "Execution | Agir" }] }),
  loader: async ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(projectsQ),
      context.queryClient.ensureQueryData(milestonesQ),
    ]),
  component: ExecutionPage,
});

function ExecutionPage() {
  const { data: projects } = useSuspenseQuery(projectsQ);
  const { data: milestones } = useSuspenseQuery(milestonesQ);
  const [open, setOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  useRealtimeRefresh();

  const completed = milestones.filter((item: any) => item.status === "complete").length;
  const blocked = milestones.filter((item: any) => item.status === "blocked");
  const overdue = milestones.filter(
    (item: any) => item.status !== "complete" && (daysUntil(item.due_date) ?? 1) < 0,
  );
  const dueSoon = milestones.filter((item: any) => {
    const d = daysUntil(item.due_date);
    return item.status !== "complete" && d != null && d >= 0 && d <= 14;
  });
  const completion = milestones.length ? Math.round((completed / milestones.length) * 100) : 0;

  return (
    <>
      <PageHeader
        eyebrow="Close management"
        title="Deal execution"
        subtitle="See the milestones, blockers, and due dates that could affect closing."
        actions={
          <>
            <Dialog open={tplOpen} onOpenChange={setTplOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={!projects.length}>
                  <ListChecks className="size-4 mr-1.5" />
                  Apply template
                </Button>
              </DialogTrigger>
              <TemplateDialog projects={projects} onClose={() => setTplOpen(false)} />
            </Dialog>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" disabled={!projects.length}>
                  <Plus className="size-4 mr-1.5" />
                  New milestone
                </Button>
              </DialogTrigger>
              <MilestoneDialog projects={projects} onClose={() => setOpen(false)} />
            </Dialog>
          </>
        }
      />
      <PageBody>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat
            icon={CalendarCheck}
            label="Open milestones"
            value={String(milestones.length - completed)}
          />
          <Stat icon={CheckCircle2} label="Completed" value={String(completed)} tone="success" />
          <Stat icon={ShieldAlert} label="Blocked" value={String(blocked.length)} tone="danger" />
          <Card className="p-4 elevated">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Execution progress
            </div>
            <div className="num text-2xl mt-2">{completion}%</div>
            <Progress value={completion} className="h-1.5 mt-3" />
          </Card>
        </div>

        <AttentionQueue overdue={overdue} dueSoon={dueSoon} blocked={blocked} />

        <CriticalPathPanel projects={projects} milestones={milestones} />

        {milestones.length ? (
          <>
            {/* Table on md+, cards on mobile: no horizontal scrolling for the core workflow */}
            <Card className="hidden md:block overflow-x-auto elevated">
              <table className="data-grid w-full">
                <thead>
                  <tr>
                    <th className="text-left">Milestone</th>
                    <th className="text-left">Deal</th>
                    <th className="text-left">Priority</th>
                    <th className="text-left">Due</th>
                    <th className="text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {milestones.map((item: any) => (
                    <MilestoneRow key={item.id} item={item} />
                  ))}
                </tbody>
              </table>
            </Card>
            <div className="md:hidden space-y-2.5">
              {milestones.map((item: any) => (
                <MilestoneCard key={item.id} item={item} />
              ))}
            </div>
          </>
        ) : (
          <Card className="elevated">
            <div className="p-14 text-center">
              <CircleDashed className="size-8 mx-auto text-muted-foreground" />
              <div className="text-sm font-medium mt-3">No execution milestones yet</div>
              <p className="text-xs text-muted-foreground mt-1">
                Apply a checklist template or add diligence, financing, legal and closing dates to
                keep every deal moving.
              </p>
            </div>
          </Card>
        )}
      </PageBody>
    </>
  );
}

// 3A: per-deal critical path. Groups milestones by deal, runs the pure
// dependency engine (computeCriticalPath), and surfaces only the deals whose
// open / overdue items actually threaten the target close, worst slack first.
function CriticalPathPanel({ projects, milestones }: { projects: any[]; milestones: any[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const byProject = new Map<string, any[]>();
  for (const m of milestones) {
    const arr = byProject.get(m.project_id) ?? [];
    arr.push(m);
    byProject.set(m.project_id, arr);
  }
  const rows: {
    project: any;
    titleOf: (id: string) => string;
    result: ReturnType<typeof computeCriticalPath>;
  }[] = [];
  for (const [pid, ms] of byProject) {
    const project = projects.find((p) => p.id === pid);
    if (!project) continue;
    const exec: ExecMilestone[] = ms.map((m) => ({
      id: m.id,
      title: m.title,
      dueDate: m.due_date ?? null,
      status: m.status,
      dependsOn: Array.isArray(m.depends_on) ? m.depends_on : [],
      priority: m.priority,
    }));
    const result = computeCriticalPath(exec, project.target_close_date ?? null, today);
    if (!result.blocking.length) continue;
    const titleMap = new Map(ms.map((m) => [m.id, m.title]));
    rows.push({ project, titleOf: (id) => titleMap.get(id) ?? id, result });
  }
  if (!rows.length) return null;
  rows.sort(
    (a, b) => (a.result.blocking[0]?.slackDays ?? 0) - (b.result.blocking[0]?.slackDays ?? 0),
  );

  return (
    <Card className="elevated border-warning/35">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <ListChecks className="size-4 text-warning" />
        <span className="text-sm font-semibold">Critical path to close</span>
        <span className="text-xs text-muted-foreground">
          deals whose open milestones threaten the target close
        </span>
      </div>
      <ul className="divide-y divide-border">
        {rows.map(({ project, titleOf, result }) => (
          <li key={project.id} className="p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{project.name}</span>
              <span className="text-xs text-muted-foreground num">
                projected close {result.projectedCloseDate ?? "n/a"}
                {project.target_close_date ? ` vs target ${project.target_close_date}` : ""}
                {result.hasCycle ? " · dependency cycle" : ""}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {result.blocking.slice(0, 8).map((b) => (
                <span
                  key={b.id}
                  className={`text-[11px] rounded px-1.5 py-0.5 border ${
                    b.reasons.includes("overdue")
                      ? "border-destructive/40 text-destructive"
                      : b.reasons.includes("on_critical_path")
                        ? "border-warning/40 text-warning"
                        : "border-border text-muted-foreground"
                  }`}
                  title={b.reasons.join(", ")}
                >
                  {b.title}
                  {b.slackDays != null ? ` (${b.slackDays >= 0 ? "+" : ""}${b.slackDays}d)` : ""}
                </span>
              ))}
            </div>
            {result.criticalPath.length > 0 && (
              <div className="mt-1.5 text-[11px] text-muted-foreground">
                Critical path: {result.criticalPath.map((id) => titleOf(id)).join(" -> ")}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// A cross-deal attention queue: blocked first, then overdue, then due-soon.
function AttentionQueue({
  overdue,
  dueSoon,
  blocked,
}: {
  overdue: any[];
  dueSoon: any[];
  blocked: any[];
}) {
  const seen = new Set<string>();
  const items: { item: any; kind: "blocked" | "overdue" | "soon" }[] = [];
  for (const item of blocked) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      items.push({ item, kind: "blocked" });
    }
  }
  for (const item of overdue) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      items.push({ item, kind: "overdue" });
    }
  }
  for (const item of dueSoon) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      items.push({ item, kind: "soon" });
    }
  }
  if (!items.length) return null;

  const META = {
    blocked: { icon: Ban, cls: "text-destructive", label: "Blocked" },
    overdue: { icon: AlertTriangle, cls: "text-destructive", label: "Overdue" },
    soon: { icon: Clock, cls: "text-warning", label: "Due soon" },
  } as const;

  return (
    <Card className="elevated border-warning/35">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <AlertTriangle className="size-4 text-warning" />
        <span className="text-xs font-semibold uppercase tracking-widest text-warning">
          Attention queue
        </span>
        <span className="text-xs text-muted-foreground">
          · {items.length} item{items.length === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="divide-y divide-border">
        {items.slice(0, 8).map(({ item, kind }) => {
          const meta = META[kind];
          const Icon = meta.icon;
          const days = daysUntil(item.due_date);
          return (
            <li key={item.id}>
              <Link
                to="/projects/$id"
                params={{ id: item.project_id }}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/30"
              >
                <Icon className={`size-4 shrink-0 ${meta.cls}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{item.title}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {item.projects?.name ?? "Deal"}
                    {item.notes ? ` · ${item.notes}` : ""}
                  </div>
                </div>
                <span className={`text-[11px] whitespace-nowrap ${meta.cls}`}>
                  {kind === "blocked"
                    ? meta.label
                    : days != null && days < 0
                      ? `${Math.abs(days)}d overdue`
                      : days != null
                        ? `${days}d`
                        : meta.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// Shared status control. Moving to "blocked" prompts for a reason (stored on
// notes); clearing the block wipes it. Used by both the table row and mobile card.
function useMilestoneUpdate(item: any) {
  const fn = useServerFn(updateMilestone);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: { status?: string; notes?: string | null }) =>
      fn({ data: { id: item.id, ...patch } as any }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["milestones"] }),
    onError: (error: Error) => toast.error(error.message),
  });
}

function MilestoneStatusSelect({ item }: { item: any }) {
  const mutation = useMilestoneUpdate(item);
  const [blockOpen, setBlockOpen] = useState(false);
  const [reason, setReason] = useState<string>(item.notes ?? "");

  function onChange(value: string) {
    if (value === "blocked") {
      setReason(item.notes ?? "");
      setBlockOpen(true); // capture a reason before flagging
    } else if (item.status === "blocked") {
      mutation.mutate({ status: value, notes: null }); // unblock clears the reason
    } else {
      mutation.mutate({ status: value });
    }
  }

  return (
    <>
      <Select value={item.status} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-36 text-xs" disabled={mutation.isPending}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="not_started">Not started</SelectItem>
          <SelectItem value="in_progress">In progress</SelectItem>
          <SelectItem value="blocked">Blocked</SelectItem>
          <SelectItem value="complete">Complete</SelectItem>
        </SelectContent>
      </Select>
      <Dialog open={blockOpen} onOpenChange={setBlockOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark milestone as blocked</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate({ status: "blocked", notes: reason.trim() || null });
              setBlockOpen(false);
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor={`block-reason-${item.id}`}>What is blocking this milestone?</Label>
              <Textarea
                id={`block-reason-${item.id}`}
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Waiting on lender term sheet"
                rows={3}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setBlockOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Mark blocked</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

const priorityCls = (p: string) =>
  p === "critical" ? "text-destructive" : p === "high" ? "text-warning" : "text-muted-foreground";

function MilestoneRow({ item }: { item: any }) {
  const days = daysUntil(item.due_date);
  const overdue = days != null && days < 0 && item.status !== "complete";
  return (
    <tr>
      <td>
        <div className="font-medium">{item.title}</div>
        <div className="text-[11px] text-muted-foreground capitalize">{item.category}</div>
        {item.status === "blocked" && item.notes && (
          <div className="text-[11px] text-destructive mt-0.5 flex items-start gap-1">
            <Ban className="size-3 mt-0.5 shrink-0" />
            <span>{item.notes}</span>
          </div>
        )}
      </td>
      <td>
        <Link to="/projects/$id" params={{ id: item.project_id }} className="hover:text-primary">
          {item.projects?.name ?? "Deal"}
        </Link>
      </td>
      <td>
        <span className={`capitalize ${priorityCls(item.priority)}`}>{item.priority}</span>
      </td>
      <td className={overdue ? "text-destructive" : ""}>
        {item.due_date ?? "–"}
        {overdue ? ` · ${Math.abs(days!)}d overdue` : ""}
      </td>
      <td>
        <MilestoneStatusSelect item={item} />
      </td>
    </tr>
  );
}

function MilestoneCard({ item }: { item: any }) {
  const days = daysUntil(item.due_date);
  const overdue = days != null && days < 0 && item.status !== "complete";
  return (
    <Card className="p-4 elevated">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-sm">{item.title}</div>
          <Link
            to="/projects/$id"
            params={{ id: item.project_id }}
            className="text-xs text-muted-foreground hover:text-primary"
          >
            {item.projects?.name ?? "Deal"}
          </Link>
        </div>
        <span className={`text-[11px] capitalize shrink-0 ${priorityCls(item.priority)}`}>
          {item.priority}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className={`text-xs ${overdue ? "text-destructive" : "text-muted-foreground"}`}>
          {item.due_date
            ? overdue
              ? `${Math.abs(days!)}d overdue`
              : item.due_date
            : "No due date"}
        </span>
        <MilestoneStatusSelect item={item} />
      </div>
      {item.status === "blocked" && item.notes && (
        <div className="text-[11px] text-destructive mt-2 flex items-start gap-1">
          <Ban className="size-3 mt-0.5 shrink-0" />
          <span>{item.notes}</span>
        </div>
      )}
    </Card>
  );
}

function TemplateDialog({ projects, onClose }: { projects: any[]; onClose: () => void }) {
  const fn = useServerFn(createMilestone);
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(MILESTONE_TEMPLATES[0]?.id ?? "");
  const tpl = MILESTONE_TEMPLATES.find((t) => t.id === templateId);
  const mutation = useMutation({
    mutationFn: async () => {
      const items = expandTemplate(templateId, projectId, new Date());
      await Promise.all(items.map((m) => fn({ data: m as any })));
      return items.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["milestones"] });
      toast.success(`Added ${n} milestones`);
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Apply checklist template</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>Deal</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Template</Label>
          <div className="mt-1.5 space-y-2">
            {MILESTONE_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTemplateId(t.id)}
                className={`w-full text-left rounded-lg border p-3 transition-colors ${
                  templateId === t.id
                    ? "border-primary/50 bg-primary/5"
                    : "border-border hover:bg-accent/40"
                }`}
              >
                <div className="text-sm font-medium">{t.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  {t.items.length} milestones · dated from today (editable)
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!projectId || !tpl || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "Adding…" : `Add ${tpl?.items.length ?? 0} milestones`}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function MilestoneDialog({ projects, onClose }: { projects: any[]; onClose: () => void }) {
  const fn = useServerFn(createMilestone);
  const qc = useQueryClient();
  const [form, setForm] = useState({
    project_id: projects[0]?.id ?? "",
    title: "",
    category: "diligence",
    due_date: "",
    status: "not_started",
    priority: "medium",
  });
  const mutation = useMutation({
    mutationFn: () => fn({ data: { ...form, due_date: form.due_date || null } as any }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["milestones"] });
      toast.success("Milestone added");
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>New execution milestone</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>Deal</Label>
          <Select
            value={form.project_id}
            onValueChange={(value) => setForm({ ...form, project_id: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Milestone</Label>
          <Input
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
            placeholder="Financing commitment received"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Category</Label>
            <Select
              value={form.category}
              onValueChange={(value) => setForm({ ...form, category: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="diligence">Diligence</SelectItem>
                <SelectItem value="financing">Financing</SelectItem>
                <SelectItem value="legal">Legal</SelectItem>
                <SelectItem value="closing">Closing</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Priority</Label>
            <Select
              value={form.priority}
              onValueChange={(value) => setForm({ ...form, priority: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>Due date</Label>
          <Input
            type="date"
            value={form.due_date}
            onChange={(event) => setForm({ ...form, due_date: event.target.value })}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!form.project_id || !form.title || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Add milestone
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof CalendarCheck;
  label: string;
  value: string;
  tone?: "success" | "danger";
}) {
  return (
    <Card className="p-4 elevated">
      <div className="flex justify-between">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</div>
        <Icon
          className={`size-4 ${tone === "success" ? "text-success" : tone === "danger" ? "text-destructive" : "text-primary"}`}
        />
      </div>
      <div className="num text-2xl mt-2">{value}</div>
    </Card>
  );
}
