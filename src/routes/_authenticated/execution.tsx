import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { CalendarCheck, CheckCircle2, CircleDashed, Plus, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

const projectsQ = queryOptions({ queryKey: ["projects"], queryFn: () => listProjects() });
const milestonesQ = queryOptions({ queryKey: ["milestones"], queryFn: () => listMilestones() });

export const Route = createFileRoute("/_authenticated/execution")({
  head: () => ({ meta: [{ title: "Execution — Agir" }] }),
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
  useRealtimeRefresh();

  const completed = milestones.filter((item: any) => item.status === "complete").length;
  const blocked = milestones.filter((item: any) => item.status === "blocked");
  const overdue = milestones.filter(
    (item: any) => item.status !== "complete" && (daysUntil(item.due_date) ?? 1) < 0,
  );
  const completion = milestones.length ? Math.round((completed / milestones.length) * 100) : 0;

  return (
    <>
      <PageHeader
        eyebrow="Close management"
        title="Deal execution"
        subtitle="Own the path from approval to close, with deadlines, blockers and accountability in one place."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="size-4 mr-1.5" />
                New milestone
              </Button>
            </DialogTrigger>
            <MilestoneDialog projects={projects} onClose={() => setOpen(false)} />
          </Dialog>
        }
      />
      <div className="p-5 md:p-8 space-y-6">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat
            icon={CalendarCheck}
            label="Open milestones"
            value={String(milestones.length - completed)}
          />
          <Stat icon={CheckCircle2} label="Completed" value={String(completed)} tone="success" />
          <Stat icon={ShieldAlert} label="Blocked" value={String(blocked.length)} tone="danger" />
          <Card className="p-4 elevated">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Execution progress
            </div>
            <div className="num text-2xl mt-2">{completion}%</div>
            <Progress value={completion} className="h-1.5 mt-3" />
          </Card>
        </div>

        {(blocked.length > 0 || overdue.length > 0) && (
          <Card className="p-4 border-warning/35 bg-warning/5">
            <div className="text-xs font-semibold uppercase tracking-widest text-warning">
              Attention required
            </div>
            <p className="text-sm mt-1">
              {blocked.length} blocked and {overdue.length} overdue milestone
              {blocked.length + overdue.length === 1 ? "" : "s"} may affect close timing.
            </p>
          </Card>
        )}

        <Card className="overflow-x-auto elevated">
          {milestones.length ? (
            <table className="data-grid w-full min-w-[900px]">
              <thead>
                <tr>
                  <th className="text-left">Milestone</th>
                  <th className="text-left">Deal</th>
                  <th className="text-left">Priority</th>
                  <th className="text-left">Due</th>
                  <th className="text-left">Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {milestones.map((item: any) => (
                  <MilestoneRow key={item.id} item={item} />
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-14 text-center">
              <CircleDashed className="size-8 mx-auto text-muted-foreground" />
              <div className="text-sm font-medium mt-3">No execution milestones yet</div>
              <p className="text-xs text-muted-foreground mt-1">
                Add diligence, financing, legal and closing dates to keep every deal moving.
              </p>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function MilestoneRow({ item }: { item: any }) {
  const fn = useServerFn(updateMilestone);
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (status: any) => fn({ data: { id: item.id, status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["milestones"] }),
    onError: (error: Error) => toast.error(error.message),
  });
  const days = daysUntil(item.due_date);
  return (
    <tr>
      <td>
        <div className="font-medium">{item.title}</div>
        <div className="text-[11px] text-muted-foreground">{item.category}</div>
      </td>
      <td>
        <Link to="/projects/$id" params={{ id: item.project_id }} className="hover:text-primary">
          {item.projects?.name ?? "Deal"}
        </Link>
      </td>
      <td>
        <span
          className={
            item.priority === "critical"
              ? "text-destructive"
              : item.priority === "high"
                ? "text-warning"
                : ""
          }
        >
          {item.priority}
        </span>
      </td>
      <td
        className={days != null && days < 0 && item.status !== "complete" ? "text-destructive" : ""}
      >
        {item.due_date ?? "—"}
        {days != null && days < 0 && item.status !== "complete"
          ? ` · ${Math.abs(days)}d overdue`
          : ""}
      </td>
      <td>
        <Select value={item.status} onValueChange={(value) => mutation.mutate(value)}>
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="not_started">Not started</SelectItem>
            <SelectItem value="in_progress">In progress</SelectItem>
            <SelectItem value="blocked">Blocked</SelectItem>
            <SelectItem value="complete">Complete</SelectItem>
          </SelectContent>
        </Select>
      </td>
      <td />
    </tr>
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
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
        <Icon
          className={`size-4 ${tone === "success" ? "text-success" : tone === "danger" ? "text-destructive" : "text-primary"}`}
        />
      </div>
      <div className="num text-2xl mt-2">{value}</div>
    </Card>
  );
}
