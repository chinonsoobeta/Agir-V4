import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPortfolio, type DealSummary } from "@/lib/portfolio.functions";
import { createProject, deleteProject, updateProject } from "@/lib/projects.functions";
import { seedHarbourCentre } from "@/lib/demo.functions";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Plus,
  Trash2,
  Sparkles,
  MapPin,
  ArrowRight,
  Search,
  Rows3,
  LayoutGrid,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Columns3,
  Bookmark,
  ArrowUpDown,
  X,
  Check,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { fmtCompact } from "@/lib/finance";
import { ASSET_TYPES, assetTypeLabel } from "@/lib/asset-types";
import { DEAL_TEMPLATES, dealTemplate } from "@/lib/deal-templates";
import { PIPELINE_STAGES, RECOMMENDATION_TONE } from "@/lib/decision";
import { RecommendationPill, RiskPill, TONE_TEXT } from "@/components/decision-ui";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import { daysUntil } from "@/lib/platform-insights";
import { useWorkspace } from "@/lib/workspace-context";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  useSavedDealViews,
  sortDeals,
  DEAL_COLUMNS,
  DEAL_SORTS,
  DEFAULT_COLUMNS,
  type DealSort,
  type DealColumnKey,
} from "@/lib/deal-views";

const portfolioQ = queryOptions({ queryKey: ["portfolio"], queryFn: () => listPortfolio() });

export const Route = createFileRoute("/_authenticated/deals")({
  head: () => ({ meta: [{ title: "Deals | Agir" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(portfolioQ),
  component: DealsPage,
});

function DealsPage() {
  const { data: deals } = useSuspenseQuery(portfolioQ);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">("list");
  const [sort, setSort] = useState<DealSort>("updated");
  const [columns, setColumns] = useState<DealColumnKey[]>(DEFAULT_COLUMNS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const createFn = useServerFn(createProject);
  const seedFn = useServerFn(seedHarbourCentre);
  const updateFn = useServerFn(updateProject);
  const { views, save, remove } = useSavedDealViews();
  useRealtimeRefresh();

  const seed = useMutation({
    mutationFn: () => seedFn(),
    onSuccess: ({ project_id }) => {
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Harbour Centre seeded: opening deal");
      navigate({ to: "/projects/$id", params: { id: project_id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Bulk stage update across the selected deals: invalidates once at the end.
  const bulkUpdate = useMutation({
    mutationFn: async (status: string) => {
      const ids = [...selected];
      await Promise.all(ids.map((id) => updateFn({ data: { id, status: status as any } })));
      return ids.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      setSelected(new Set());
      toast.success(`Updated ${n} deal${n === 1 ? "" : "s"}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const stageCounts = PIPELINE_STAGES.map((s) => ({
    stage: s,
    count: deals.filter((d) => d.stage === s).length,
  }));
  const filtered = deals.filter((deal) => {
    if (filter !== "all" && deal.stage !== filter) return false;
    const term = search.trim().toLowerCase();
    return (
      !term ||
      [deal.name, deal.location, deal.type, deal.source].some((value) =>
        value?.toLowerCase().includes(term),
      )
    );
  });
  const visible = sortDeals(filtered, sort);

  function applyView(v: {
    filter: string;
    search: string;
    sort: DealSort;
    view: "grid" | "list";
    columns: DealColumnKey[];
  }) {
    setFilter(v.filter);
    setSearch(v.search);
    setSort(v.sort);
    setView(v.view);
    setColumns(v.columns?.length ? v.columns : DEFAULT_COLUMNS);
    setSelected(new Set());
  }
  function saveCurrentView() {
    const name = viewName.trim();
    if (!name) return;
    save(name, { filter, search, sort, view, columns });
    toast.success(`Saved view "${name}"`);
    setViewName("");
    setSaveViewOpen(false);
  }
  function resetView() {
    applyView({
      filter: "all",
      search: "",
      sort: "updated",
      view: "list",
      columns: DEFAULT_COLUMNS,
    });
  }
  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected((prev) =>
      prev.size === visible.length ? new Set() : new Set(visible.map((d) => d.id)),
    );

  return (
    <>
      <PageHeader
        eyebrow="Pipeline"
        title="Deals"
        subtitle={`${deals.length} deals across the underwriting pipeline`}
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => seed.mutate()}
              disabled={seed.isPending}
            >
              <Sparkles className="size-4 mr-1.5" />
              {seed.isPending ? "Seeding…" : "Seed demo deal"}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="size-4 mr-1.5" /> New deal
                </Button>
              </DialogTrigger>
              <NewDealDialog onClose={() => setOpen(false)} createFn={createFn} />
            </Dialog>
          </>
        }
      />
      <PageBody>
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <FilterChip
              label={`All (${deals.length})`}
              active={filter === "all"}
              onClick={() => setFilter("all")}
            />
            {stageCounts.map((s) => (
              <FilterChip
                key={s.stage}
                label={`${s.stage} (${s.count})`}
                active={filter === s.stage}
                onClick={() => setFilter(s.stage)}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-56">
              <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search deals, markets, sources…"
                className="pl-9"
              />
            </div>

            {/* Sort */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9">
                  <ArrowUpDown className="size-3.5 mr-1.5" />
                  {DEAL_SORTS.find((s) => s.value === sort)?.label ?? "Sort"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                {DEAL_SORTS.map((s) => (
                  <DropdownMenuItem key={s.value} onClick={() => setSort(s.value)}>
                    {sort === s.value && <Check className="size-3.5 mr-1.5" />}
                    <span className={sort === s.value ? "" : "ml-[22px]"}>{s.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Column visibility (list view) */}
            {view === "list" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9">
                    <Columns3 className="size-3.5 mr-1.5" />
                    Columns
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
                  {DEAL_COLUMNS.map((c) => (
                    <DropdownMenuCheckboxItem
                      key={c.key}
                      checked={columns.includes(c.key)}
                      onCheckedChange={(on) =>
                        setColumns((prev) =>
                          on ? [...new Set([...prev, c.key])] : prev.filter((k) => k !== c.key),
                        )
                      }
                    >
                      {c.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setColumns(DEFAULT_COLUMNS)}>
                    Reset columns
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Saved views */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9">
                  <Bookmark className="size-3.5 mr-1.5" />
                  Views
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Saved views</DropdownMenuLabel>
                {views.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No saved views yet
                  </div>
                )}
                {views.map((v) => (
                  <div key={v.id} className="flex items-center">
                    <DropdownMenuItem className="flex-1" onClick={() => applyView(v)}>
                      {v.name}
                    </DropdownMenuItem>
                    <button
                      className="px-2 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.preventDefault();
                        remove(v.id);
                      }}
                      aria-label={`Delete ${v.name}`}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setSaveViewOpen(true);
                  }}
                >
                  Save current view…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={resetView}>Reset to default</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex rounded-md border border-border p-0.5">
              <Button
                variant={view === "list" ? "secondary" : "ghost"}
                size="icon"
                className="size-8"
                onClick={() => setView("list")}
              >
                <Rows3 className="size-4" />
              </Button>
              <Button
                variant={view === "grid" ? "secondary" : "ghost"}
                size="icon"
                className="size-8"
                onClick={() => setView("grid")}
              >
                <LayoutGrid className="size-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Bulk action bar (list view) */}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-4 py-2.5">
            <span className="text-sm font-medium">{selected.size} selected</span>
            <Select onValueChange={(v) => bulkUpdate.mutate(v)}>
              <SelectTrigger className="h-8 w-48 text-xs" disabled={bulkUpdate.isPending}>
                <SelectValue placeholder="Set pipeline status…" />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              <X className="size-3.5 mr-1" /> Clear
            </Button>
          </div>
        )}

        {visible.length === 0 ? (
          <Card className="p-16 text-center elevated">
            <p className="text-sm text-muted-foreground">
              No deals here. Seed the Harbour Centre demo or create a new deal.
            </p>
          </Card>
        ) : view === "grid" ? (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {visible.map((d) => (
              <DealCard key={d.id} d={d} />
            ))}
          </div>
        ) : (
          <DealTable
            deals={visible}
            columns={columns}
            selected={selected}
            onToggle={toggleSelected}
            onToggleAll={toggleAll}
          />
        )}
      </PageBody>

      <Dialog open={saveViewOpen} onOpenChange={setSaveViewOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Save current view</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveCurrentView();
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="view-name">View name</Label>
              <Input
                id="view-name"
                autoFocus
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                placeholder="e.g. Office deals, near close"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setViewName("");
                  setSaveViewOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!viewName.trim()}>
                Save view
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-[11px] uppercase tracking-widest px-3 py-1.5 rounded-full border transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"}`}
    >
      {label}
    </button>
  );
}

function DealCard({ d }: { d: DealSummary }) {
  const qc = useQueryClient();
  const delFn = useServerFn(deleteProject);
  const updateFn = useServerFn(updateProject);
  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Deal deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: (status: any) => updateFn({ data: { id: d.id, status } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      toast.success("Deal stage updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const tone =
    RECOMMENDATION_TONE[d.recommendation as keyof typeof RECOMMENDATION_TONE] ?? "neutral";

  return (
    <Card className="p-5 flex flex-col gap-4 elevated hover:border-primary/40 transition-colors group">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {d.stage}
          </div>
          <Link
            to="/projects/$id"
            params={{ id: d.id }}
            className="display text-lg font-semibold leading-tight hover:text-primary block truncate mt-0.5"
          >
            {d.name}
          </Link>
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
            <MapPin className="size-3" />
            {d.location || "Not available"} · <span>{assetTypeLabel(d.type)}</span>
          </div>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              aria-label={`Delete ${d.name}`}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {d.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the deal and its underwriting from your pipeline. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep deal</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => del.mutate(d.id)}
              >
                Delete deal
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
            Pipeline status
          </div>
          <Select value={d.status} onValueChange={(value) => update.mutate(value)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROJECT_STATUSES.map((status) => (
                <SelectItem key={status.value} value={status.value}>
                  {status.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
            Target close
          </div>
          <div className="h-8 flex items-center gap-1.5 text-xs">
            <CalendarClock className="size-3.5 text-muted-foreground" />
            {d.targetCloseDate ?? "Not available"}
          </div>
        </div>
      </div>

      {d.hasUnderwriting ? (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <RecommendationPill rec={d.recommendation as any} />
            <RiskPill rating={d.riskRating as any} />
          </div>
          <div className="grid grid-cols-3 gap-2 border-t border-border pt-4">
            <Stat
              label="Investment"
              value={d.investmentScore != null ? String(d.investmentScore) : "Not available"}
              accent={tone}
            />
            <Stat label="Confidence" value={String(d.confidenceScore)} />
            <Stat label="Capital" value={fmtCompact(d.capital)} />
          </div>
        </>
      ) : (
        <div className="border-t border-border pt-4">
          <div className="text-sm text-muted-foreground">Not yet underwritten.</div>
          <div className={`text-xs font-semibold uppercase tracking-wider mt-1 ${TONE_TEXT[tone]}`}>
            {(d.nextAction ?? "Begin review").toUpperCase()}
          </div>
        </div>
      )}

      <Link
        to="/projects/$id"
        params={{ id: d.id }}
        className="mt-auto flex items-center justify-between text-sm text-primary hover:gap-2 transition-all"
      >
        <span>Open deal</span>
        <ArrowRight className="size-4" />
      </Link>
    </Card>
  );
}

const PROJECT_STATUSES = [
  { value: "pipeline", label: "Pipeline" },
  { value: "underwriting", label: "Underwriting" },
  { value: "approved", label: "Approved" },
  { value: "active", label: "Active / closing" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

function DealTable({
  deals,
  columns,
  selected,
  onToggle,
  onToggleAll,
}: {
  deals: DealSummary[];
  columns: DealColumnKey[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}) {
  const show = (k: DealColumnKey) => columns.includes(k);
  const allSelected = deals.length > 0 && deals.every((d) => selected.has(d.id));
  return (
    <Card className="overflow-x-auto elevated">
      <table className="data-grid w-full min-w-[720px]">
        <thead>
          <tr>
            <th className="w-9">
              <Checkbox
                checked={allSelected}
                onCheckedChange={onToggleAll}
                aria-label="Select all"
              />
            </th>
            <th className="text-left">Deal</th>
            {show("stage") && <th className="text-left">Stage</th>}
            {show("source") && <th className="text-left">Source</th>}
            {show("capital") && <th className="text-right">Capital</th>}
            {show("probability") && <th className="text-right">Probability</th>}
            {show("investment") && <th className="text-right">Investment</th>}
            {show("confidence") && <th className="text-right">Confidence</th>}
            {show("close") && <th className="text-left">Target close</th>}
            <th />
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => {
            const days = daysUntil(deal.targetCloseDate);
            const overdue = days != null && days < 0;
            const isSelected = selected.has(deal.id);
            return (
              <tr key={deal.id} className={isSelected ? "bg-primary/5" : ""}>
                <td>
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => onToggle(deal.id)}
                    aria-label={`Select ${deal.name}`}
                  />
                </td>
                <td>
                  <Link
                    to="/projects/$id"
                    params={{ id: deal.id }}
                    className="font-medium hover:text-primary"
                  >
                    {deal.name}
                  </Link>
                  <div className="text-[11px] text-muted-foreground">
                    {deal.location || "Not available"}
                  </div>
                </td>
                {show("stage") && (
                  <td>
                    <span className="text-xs">{deal.stage}</span>
                  </td>
                )}
                {show("source") && (
                  <td className="text-muted-foreground">{deal.source || "Direct"}</td>
                )}
                {show("capital") && <td className="num text-right">{fmtCompact(deal.capital)}</td>}
                {show("probability") && <td className="num text-right">{deal.probability}%</td>}
                {show("investment") && (
                  <td className="num text-right">{deal.investmentScore ?? "Not available"}</td>
                )}
                {show("confidence") && <td className="num text-right">{deal.confidenceScore}</td>}
                {show("close") && (
                  <td>
                    <span className={overdue ? "text-destructive font-medium" : ""}>
                      {deal.targetCloseDate || "Not available"}
                      {overdue && ` · ${Math.abs(days!)}d overdue`}
                    </span>
                  </td>
                )}
                <td>
                  <Link to="/projects/$id" params={{ id: deal.id }}>
                    <Button variant="ghost" size="icon">
                      <ArrowRight className="size-4" />
                    </Button>
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "approve" | "condition" | "return" | "reject" | "neutral";
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`num text-lg mt-0.5 ${accent ? TONE_TEXT[accent] : ""}`}>{value}</div>
    </div>
  );
}

function NewDealDialog({ onClose, createFn }: { onClose: () => void; createFn: any }) {
  const qc = useQueryClient();
  const { activeWorkspaceId } = useWorkspace();
  const [templateId, setTemplateId] = useState("blank");
  const [showFinancials, setShowFinancials] = useState(false);
  const [form, setForm] = useState({
    name: "",
    location: "",
    type: "industrial",
    status: "pipeline",
    acquisition_cost: 0,
    construction_cost: 0,
    revenue_forecast: 0,
    debt_amount: 0,
    equity_amount: 0,
    interest_rate: 0,
    notes: "",
    source: "",
    probability: 25,
    target_close_date: "",
    lead_owner: "",
  });
  const create = useMutation({
    mutationFn: (data: any) =>
      createFn({
        data: {
          ...data,
          source: data.source || null,
          lead_owner: data.lead_owner || null,
          target_close_date: data.target_close_date || null,
          // Tag the deal with the active workspace (null for personal / unmigrated).
          workspace_id: activeWorkspaceId !== "personal" ? activeWorkspaceId : null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["onboarding"] });
      toast.success("Deal created");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const num = (v: string) => Number(v) || 0;

  // Templates pre-fill DEAL METADATA only (type, source, probability, a name
  // prefix). They never seed underwriting numbers: those still come from
  // documents the user reviews. Every default is shown in the picker.
  function applyTemplate(id: string) {
    setTemplateId(id);
    const tpl = dealTemplate(id);
    if (!tpl) return;
    setForm((f) => ({
      ...f,
      type: tpl.type,
      source: tpl.source,
      probability: tpl.probability,
      name: tpl.namePrefix && !f.name ? tpl.namePrefix : f.name,
    }));
  }
  const selected = dealTemplate(templateId);

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="display text-xl">New deal</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(form);
        }}
      >
        <div className="space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground">Start from a template</Label>
            <div className="mt-1.5 grid sm:grid-cols-2 gap-2">
              {DEAL_TEMPLATES.map((tpl) => (
                <button
                  type="button"
                  key={tpl.id}
                  onClick={() => applyTemplate(tpl.id)}
                  className={`text-left rounded-lg border p-3 transition-colors ${
                    templateId === tpl.id
                      ? "border-primary/50 bg-primary/5"
                      : "border-border hover:bg-accent/40"
                  }`}
                >
                  <div className="text-sm font-medium">{tpl.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{tpl.description}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Deal name</Label>
              <Input
                required
                autoFocus
                placeholder="e.g. Harbour Centre"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <Label>Location</Label>
              <Input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSET_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Source</Label>
              <Input
                placeholder="Broker, direct, partner…"
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
              />
            </div>
            <div>
              <Label>Deal lead</Label>
              <Input
                value={form.lead_owner}
                onChange={(e) => setForm({ ...form, lead_owner: e.target.value })}
              />
            </div>
            <div>
              <Label>Probability %</Label>
              <Input
                type="number"
                min="0"
                max="100"
                value={form.probability}
                onChange={(e) => setForm({ ...form, probability: num(e.target.value) })}
              />
            </div>
            <div>
              <Label>Target close</Label>
              <Input
                type="date"
                value={form.target_close_date}
                onChange={(e) => setForm({ ...form, target_close_date: e.target.value })}
              />
            </div>
          </div>

          {selected && selected.suggestedDocs.length > 0 && (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="text-xs font-medium text-muted-foreground">
                Suggested documents to gather next
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {selected.suggestedDocs.map((doc) => (
                  <span
                    key={doc}
                    className="text-[11px] rounded-full border border-border bg-card px-2 py-0.5"
                  >
                    {doc}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={() => setShowFinancials((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              {showFinancials ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              Optional quick financial summary
            </button>
            <p className="text-[11px] text-muted-foreground mt-1">
              For reference only: underwriting always runs on the documents and approved
              assumptions, never these figures.
            </p>
            {showFinancials && (
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <Label>Acquisition cost</Label>
                  <Input
                    type="number"
                    value={form.acquisition_cost}
                    onChange={(e) => setForm({ ...form, acquisition_cost: num(e.target.value) })}
                  />
                </div>
                <div>
                  <Label>Construction cost</Label>
                  <Input
                    type="number"
                    value={form.construction_cost}
                    onChange={(e) => setForm({ ...form, construction_cost: num(e.target.value) })}
                  />
                </div>
                <div>
                  <Label>Revenue forecast</Label>
                  <Input
                    type="number"
                    value={form.revenue_forecast}
                    onChange={(e) => setForm({ ...form, revenue_forecast: num(e.target.value) })}
                  />
                </div>
                <div>
                  <Label>Debt amount</Label>
                  <Input
                    type="number"
                    value={form.debt_amount}
                    onChange={(e) => setForm({ ...form, debt_amount: num(e.target.value) })}
                  />
                </div>
                <div>
                  <Label>Equity amount</Label>
                  <Input
                    type="number"
                    value={form.equity_amount}
                    onChange={(e) => setForm({ ...form, equity_amount: num(e.target.value) })}
                  />
                </div>
                <div>
                  <Label>Interest rate %</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.interest_rate}
                    onChange={(e) => setForm({ ...form, interest_rate: num(e.target.value) })}
                  />
                </div>
              </div>
            )}
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter className="mt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create deal"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
