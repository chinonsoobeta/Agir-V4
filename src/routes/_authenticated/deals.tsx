import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPortfolio, type DealSummary } from "@/lib/portfolio.functions";
import { createProject, deleteProject } from "@/lib/projects.functions";
import { seedHarbourCentre } from "@/lib/demo.functions";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Sparkles, MapPin, ArrowRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { fmtCompact } from "@/lib/finance";
import { ASSET_TYPES, assetTypeLabel } from "@/lib/asset-types";
import { PIPELINE_STAGES, RECOMMENDATION_TONE } from "@/lib/decision";
import { RecommendationPill, RiskPill, TONE_TEXT } from "@/components/decision-ui";

const portfolioQ = queryOptions({ queryKey: ["portfolio"], queryFn: () => listPortfolio() });

export const Route = createFileRoute("/_authenticated/deals")({
  head: () => ({ meta: [{ title: "Deals — Agir" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(portfolioQ),
  component: DealsPage,
});

function DealsPage() {
  const { data: deals } = useSuspenseQuery(portfolioQ);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const createFn = useServerFn(createProject);
  const seedFn = useServerFn(seedHarbourCentre);

  const seed = useMutation({
    mutationFn: () => seedFn(),
    onSuccess: ({ project_id }) => {
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Harbour Centre seeded — opening deal");
      navigate({ to: "/projects/$id", params: { id: project_id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const stageCounts = PIPELINE_STAGES.map((s) => ({ stage: s, count: deals.filter((d) => d.stage === s).length }));
  const visible = filter === "all" ? deals : deals.filter((d) => d.stage === filter);

  return (
    <>
      <PageHeader eyebrow="Pipeline" title="Deals"
        subtitle={`${deals.length} deals across the underwriting pipeline`}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => seed.mutate()} disabled={seed.isPending}>
              <Sparkles className="size-4 mr-1.5" />{seed.isPending ? "Seeding…" : "Seed demo deal"}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button size="sm"><Plus className="size-4 mr-1.5" /> New deal</Button></DialogTrigger>
              <NewDealDialog onClose={() => setOpen(false)} createFn={createFn} />
            </Dialog>
          </>
        } />
      <div className="p-8 space-y-5">
        <div className="flex flex-wrap gap-2">
          <FilterChip label={`All (${deals.length})`} active={filter === "all"} onClick={() => setFilter("all")} />
          {stageCounts.map((s) => (
            <FilterChip key={s.stage} label={`${s.stage} (${s.count})`} active={filter === s.stage} onClick={() => setFilter(s.stage)} />
          ))}
        </div>

        {visible.length === 0 ? (
          <Card className="p-16 text-center elevated">
            <p className="text-sm text-muted-foreground">No deals here. Seed the Harbour Centre demo or create a new deal.</p>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {visible.map((d) => <DealCard key={d.id} d={d} />)}
          </div>
        )}
      </div>
    </>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`text-[11px] uppercase tracking-widest px-3 py-1.5 rounded-full border transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"}`}>
      {label}
    </button>
  );
}

function DealCard({ d }: { d: DealSummary }) {
  const qc = useQueryClient();
  const delFn = useServerFn(deleteProject);
  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["portfolio"] }); qc.invalidateQueries({ queryKey: ["projects"] }); toast.success("Deal deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const tone = RECOMMENDATION_TONE[d.recommendation as keyof typeof RECOMMENDATION_TONE] ?? "neutral";

  return (
    <Card className="p-5 flex flex-col gap-4 elevated hover:border-primary/40 transition-colors group">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{d.stage}</div>
          <Link to="/projects/$id" params={{ id: d.id }} className="display text-lg font-semibold leading-tight hover:text-primary block truncate mt-0.5">{d.name}</Link>
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
            <MapPin className="size-3" />{d.location || "—"} · <span>{assetTypeLabel(d.type)}</span>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="size-7 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          onClick={() => { if (confirm(`Delete ${d.name}?`)) del.mutate(d.id); }}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {d.hasUnderwriting ? (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <RecommendationPill rec={d.recommendation as any} />
            <RiskPill rating={d.riskRating as any} />
          </div>
          <div className="grid grid-cols-3 gap-2 border-t border-border pt-4">
            <Stat label="Investment" value={d.investmentScore != null ? String(d.investmentScore) : "—"} accent={tone} />
            <Stat label="Confidence" value={String(d.confidenceScore)} />
            <Stat label="Capital" value={fmtCompact(d.capital)} />
          </div>
        </>
      ) : (
        <div className="border-t border-border pt-4">
          <div className="text-sm text-muted-foreground">Not yet underwritten.</div>
          <div className={`text-xs font-semibold uppercase tracking-wider mt-1 ${TONE_TEXT[tone]}`}>{(d.nextAction ?? "Begin review").toUpperCase()}</div>
        </div>
      )}

      <Link to="/projects/$id" params={{ id: d.id }}
        className="mt-auto flex items-center justify-between text-sm text-primary hover:gap-2 transition-all">
        <span>Open deal</span><ArrowRight className="size-4" />
      </Link>
    </Card>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "approve" | "condition" | "return" | "reject" | "neutral" }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`num text-lg mt-0.5 ${accent ? TONE_TEXT[accent] : ""}`}>{value}</div>
    </div>
  );
}

function NewDealDialog({ onClose, createFn }: { onClose: () => void; createFn: any }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: "", location: "", type: "industrial", status: "pipeline",
    acquisition_cost: 0, construction_cost: 0, revenue_forecast: 0,
    debt_amount: 0, equity_amount: 0, interest_rate: 0, notes: "",
  });
  const create = useMutation({
    mutationFn: (data: any) => createFn({ data }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["portfolio"] }); qc.invalidateQueries({ queryKey: ["projects"] }); toast.success("Deal created"); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const num = (v: string) => Number(v) || 0;
  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader><DialogTitle className="display text-xl">New deal</DialogTitle></DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); create.mutate(form); }}>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label>Deal name</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>Location</Label><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
          <div><Label>Type</Label>
            <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ASSET_TYPES.map((t) =>
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Acquisition Cost</Label><Input type="number" value={form.acquisition_cost} onChange={(e) => setForm({ ...form, acquisition_cost: num(e.target.value) })} /></div>
          <div><Label>Construction Cost</Label><Input type="number" value={form.construction_cost} onChange={(e) => setForm({ ...form, construction_cost: num(e.target.value) })} /></div>
          <div><Label>Revenue Forecast</Label><Input type="number" value={form.revenue_forecast} onChange={(e) => setForm({ ...form, revenue_forecast: num(e.target.value) })} /></div>
          <div><Label>Debt Amount</Label><Input type="number" value={form.debt_amount} onChange={(e) => setForm({ ...form, debt_amount: num(e.target.value) })} /></div>
          <div><Label>Equity Amount</Label><Input type="number" value={form.equity_amount} onChange={(e) => setForm({ ...form, equity_amount: num(e.target.value) })} /></div>
          <div><Label>Interest Rate %</Label><Input type="number" step="0.01" value={form.interest_rate} onChange={(e) => setForm({ ...form, interest_rate: num(e.target.value) })} /></div>
          <div className="col-span-2"><Label>Notes</Label><Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <DialogFooter className="mt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={create.isPending}>{create.isPending ? "Creating…" : "Create deal"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
