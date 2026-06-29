import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPortfolio, type DealSummary } from "@/lib/portfolio.functions";
import { deleteProject } from "@/lib/projects.functions";
import { PageHeader, PageBody } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { fmtCompact } from "@/lib/finance";
import {
  PIPELINE_STAGES,
  type PipelineStage,
  type RiskRating,
  RECOMMENDATION_TONE,
} from "@/lib/decision";
import { Eyebrow, TONE_TEXT } from "@/components/decision-ui";
import { ArrowRight, Plus, Sparkles, Trash2 } from "lucide-react";
import { buildPortfolioInsights, summarizePortfolio } from "@/lib/platform-insights";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import { toast } from "sonner";

const portfolioQ = queryOptions({ queryKey: ["portfolio"], queryFn: () => listPortfolio() });

export const Route = createFileRoute("/_authenticated/portfolio")({
  head: () => ({ meta: [{ title: "Portfolio | Agir" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(portfolioQ),
  component: PortfolioPage,
});

const RISK_ORDER: RiskRating[] = ["Low", "Moderate", "High", "Critical"];

function PortfolioPage() {
  const { data: deals } = useSuspenseQuery(portfolioQ);
  useRealtimeRefresh();

  // Shared deterministic rollup: keeps these numbers identical to the dashboard.
  const summary = summarizePortfolio(deals);
  const active = deals.filter((d) => d.stage !== "Approved" && d.stage !== "Rejected");
  const approved = deals.filter((d) => d.stage === "Approved");
  const rejected = deals.filter((d) => d.stage === "Rejected");
  const underReview = deals.filter((d) => !["Approved", "Rejected"].includes(d.stage));

  const cap = (xs: DealSummary[]) => xs.reduce((s, d) => s + d.capital, 0);
  const avgRisk = summary.avgRiskScore ?? 0;
  const avgConf = summary.avgConfidence;

  // Investment queue: deals that need a human action, most urgent first.
  const queue = [...deals]
    .filter((d) => d.nextAction && d.stage !== "Approved" && d.stage !== "Rejected")
    .sort((a, b) => (a.investmentScore ?? 50) - (b.investmentScore ?? 50));

  const riskCounts = RISK_ORDER.map((r) => ({
    rating: r,
    count: deals.filter((d) => d.hasUnderwriting && d.riskRating === r).length,
  }));
  const ratedTotal = riskCounts.reduce((s, r) => s + r.count, 0) || 1;
  const insights = buildPortfolioInsights(deals);

  if (!deals.length) {
    return (
      <>
        <PageHeader
          eyebrow="Portfolio"
          title="Investment Portfolio"
          subtitle="Review active deals, capital, risk, and decisions in one view."
          actions={
            <Link to="/deals">
              <Button size="sm">
                <Plus className="size-4 mr-1.5" />
                New deal
              </Button>
            </Link>
          }
        />
        <PageBody>
          <Card className="p-16 text-center elevated">
            <p className="text-sm text-muted-foreground">
              No deals yet. Open{" "}
              <Link to="/deals" className="text-primary underline">
                Deals
              </Link>{" "}
              and seed the Harbour Centre demo to see the platform in action.
            </p>
          </Card>
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Portfolio"
        title="Investment Portfolio"
        subtitle={`${deals.length} deals under management · ${fmtCompact(cap(deals))} aggregate capital`}
        actions={
          <Link to="/deals">
            <Button size="sm">
              <Plus className="size-4 mr-1.5" />
              New deal
            </Button>
          </Link>
        }
      />

      <PageBody>
        {/* Overview band */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <Kpi label="Active Deals" value={String(active.length)} />
          <Kpi label="Capital Under Review" value={fmtCompact(cap(underReview))} />
          <Kpi label="Approved Capital" value={fmtCompact(cap(approved))} tone="approve" />
          <Kpi label="Rejected Capital" value={fmtCompact(cap(rejected))} tone="reject" />
          <Kpi label="Avg Risk Score" value={String(avgRisk)} sub="/ 100" />
          <Kpi label="Avg Confidence" value={String(avgConf)} sub="/ 100" tone="return" />
          <Kpi
            label="In IC"
            value={String(deals.filter((d) => d.stage === "Investment Committee").length)}
          />
        </div>

        <section>
          <div className="flex items-baseline justify-between mb-3">
            <Eyebrow>Portfolio insights · mitigation & returns</Eyebrow>
            <span className="text-xs text-muted-foreground">
              {insights.length} current signal{insights.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {insights.map((insight) => (
              <Card key={insight.id} className="p-4 elevated">
                <div className="flex gap-3">
                  <div
                    className={`size-8 rounded-md flex items-center justify-center shrink-0 ${insight.severity === "critical" ? "bg-destructive/10 text-destructive" : insight.severity === "watch" ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}
                  >
                    <Sparkles className="size-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{insight.title}</div>
                    <p className="text-xs text-muted-foreground mt-1">{insight.detail}</p>
                    <p className="text-xs mt-2">{insight.action}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* Investment Queue: the most important widget */}
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <Eyebrow>Investment Queue · requires attention</Eyebrow>
            <span className="text-xs text-muted-foreground">{queue.length} items</span>
          </div>
          <Card className="divide-y divide-border overflow-hidden elevated">
            {queue.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Nothing in the queue. Every active deal is up to date.
              </div>
            ) : (
              queue.map((d) => {
                const tone =
                  RECOMMENDATION_TONE[d.recommendation as keyof typeof RECOMMENDATION_TONE] ??
                  "neutral";
                return (
                  <div
                    key={d.id}
                    className="flex items-center gap-4 px-5 py-4 hover:bg-accent/30 transition-colors group"
                  >
                    <div
                      className={`w-1 self-stretch rounded-full ${tone === "approve" ? "bg-success" : tone === "condition" ? "bg-warning" : tone === "reject" ? "bg-destructive" : "bg-chart-2"}`}
                    />
                    <Link to="/projects/$id" params={{ id: d.id }} className="min-w-0 flex-1">
                      <div className="font-medium truncate hover:text-primary">{d.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {d.location || "Not available"} · {d.stage}
                        {d.topRisk ? ` · ${d.topRisk}` : ""}
                      </div>
                    </Link>
                    <div className="hidden sm:block text-right">
                      <div className="num text-sm">
                        {d.investmentScore ?? "Not available"}
                        <span className="text-muted-foreground text-xs"> / 100</span>
                      </div>
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        Score
                      </div>
                    </div>
                    <div
                      className={`text-[11px] font-semibold uppercase tracking-wider ${TONE_TEXT[tone]} text-right min-w-[150px]`}
                    >
                      {(d.nextAction ?? "").toUpperCase()}
                    </div>
                    <DeleteDealButton deal={d} />
                    <Link to="/projects/$id" params={{ id: d.id }} aria-label={`Open ${d.name}`}>
                      <Button variant="ghost" size="icon">
                        <ArrowRight className="size-4" />
                      </Button>
                    </Link>
                  </div>
                );
              })
            )}
          </Card>
        </section>

        {/* Deal pipeline */}
        <section>
          <Eyebrow>Deal Pipeline</Eyebrow>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {PIPELINE_STAGES.map((stage) => (
              <PipelineColumn
                key={stage}
                stage={stage}
                deals={deals.filter((d) => d.stage === stage)}
              />
            ))}
          </div>
        </section>

        {/* Risk heatmap */}
        <section>
          <Eyebrow>Risk Distribution</Eyebrow>
          <Card className="p-5 mt-3 elevated">
            <div className="flex h-3 rounded-full overflow-hidden bg-muted">
              {riskCounts.map(
                (r) =>
                  r.count > 0 && (
                    <div
                      key={r.rating}
                      className={
                        r.rating === "Low"
                          ? "bg-success"
                          : r.rating === "Moderate"
                            ? "bg-warning"
                            : r.rating === "High"
                              ? "bg-chart-2"
                              : "bg-destructive"
                      }
                      style={{ width: `${(r.count / ratedTotal) * 100}%` }}
                      title={`${r.rating}: ${r.count}`}
                    />
                  ),
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              {riskCounts.map((r) => (
                <div key={r.rating} className="flex items-center gap-2.5">
                  <span
                    className={`size-2.5 rounded-sm ${r.rating === "Low" ? "bg-success" : r.rating === "Moderate" ? "bg-warning" : r.rating === "High" ? "bg-chart-2" : "bg-destructive"}`}
                  />
                  <div>
                    <div className="num text-lg leading-none">{r.count}</div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
                      {r.rating} Risk
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {ratedTotal === 1 && deals.every((d) => !d.hasUnderwriting) && (
              <p className="text-xs text-muted-foreground mt-3">
                Risk ratings populate once deals are underwritten.
              </p>
            )}
          </Card>
        </section>
      </PageBody>
    </>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "approve" | "reject" | "return";
}) {
  const color =
    tone === "approve"
      ? "text-success"
      : tone === "reject"
        ? "text-destructive"
        : tone === "return"
          ? "text-chart-2"
          : "";
  return (
    <Card className="p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground leading-tight">
        {label}
      </div>
      <div className={`num text-2xl mt-2 ${color}`}>
        {value}
        <span className="text-muted-foreground text-sm">{sub}</span>
      </div>
    </Card>
  );
}

function PipelineColumn({ stage, deals }: { stage: PipelineStage; deals: DealSummary[] }) {
  const accent =
    stage === "Approved"
      ? "text-success"
      : stage === "Rejected"
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-1 mb-2">
        <span className={`text-[10px] uppercase tracking-widest font-semibold ${accent}`}>
          {stage}
        </span>
        <span className="num text-xs text-muted-foreground">{deals.length}</span>
      </div>
      <div className="flex-1 space-y-2 min-h-[60px] rounded-lg bg-muted/30 p-2">
        {deals.length === 0 && (
          <div className="text-[11px] text-muted-foreground/60 text-center py-3">None</div>
        )}
        {deals.map((d) => (
          <div
            key={d.id}
            className="block rounded-md border border-border bg-card p-3 hover:border-primary/50 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <Link
                to="/projects/$id"
                params={{ id: d.id }}
                className="min-w-0 text-sm font-medium leading-tight truncate hover:text-primary"
              >
                {d.name}
              </Link>
              <DeleteDealButton deal={d} compact />
            </div>
            <div className="text-[11px] text-muted-foreground truncate mt-0.5">
              {d.location || d.type.replace("_", " ")}
            </div>
            <div className="flex items-center justify-between mt-2.5">
              <span className="num text-xs">{fmtCompact(d.capital)}</span>
              {d.hasUnderwriting && d.investmentScore != null ? (
                <span
                  className={`num text-xs font-semibold ${d.investmentScore >= 60 ? "text-success" : d.investmentScore >= 40 ? "text-warning" : "text-destructive"}`}
                >
                  {d.investmentScore}
                </span>
              ) : (
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  No UW
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DeleteDealButton({ deal, compact = false }: { deal: DealSummary; compact?: boolean }) {
  const qc = useQueryClient();
  const deleteFn = useServerFn(deleteProject);
  const del = useMutation({
    mutationFn: () => deleteFn({ data: { id: deal.id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["onboarding"] });
      toast.success("Deal deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={compact ? "size-6 shrink-0" : "shrink-0"}
          aria-label={`Delete ${deal.name}`}
          title={`Delete ${deal.name}`}
        >
          <Trash2 className={compact ? "size-3.5" : "size-4"} />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {deal.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the deal and its underwriting from your portfolio. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep deal</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => del.mutate()}
          >
            Delete deal
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
