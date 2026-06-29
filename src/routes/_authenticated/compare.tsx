import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Download, GitCompareArrows, ExternalLink, Check } from "lucide-react";
import { PageHeader, PageBody } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/lib/preferences";
import { listPortfolio, compareDeals } from "@/lib/portfolio.functions";
import {
  COMPARISON_METRICS,
  bestDealForMetric,
  type ComparisonDeal,
} from "@/lib/reports/comparison-model";
import { formatReportCell } from "@/lib/reports/format-cell";
import { RECOMMENDATION_TONE } from "@/lib/decision";
import { TONE_TEXT } from "@/components/decision-ui";

const portfolioQ = queryOptions({ queryKey: ["portfolio"], queryFn: () => listPortfolio() });

export const Route = createFileRoute("/_authenticated/compare")({
  head: () => ({ meta: [{ title: "Compare | Agir" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    deals: typeof s.deals === "string" ? s.deals : undefined,
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(portfolioQ),
  component: ComparePage,
});

function ComparePage() {
  const { t, fmt } = usePreferences();
  const navigate = useNavigate();
  const { deals: dealsParam } = Route.useSearch();
  const { data: portfolio } = useSuspenseQuery(portfolioQ);

  const selectedIds = useMemo(
    () =>
      dealsParam ? dealsParam.split(",").filter((id) => portfolio.some((d) => d.id === id)) : [],
    [dealsParam, portfolio],
  );

  function toggle(id: string) {
    const set = new Set(selectedIds);
    if (set.has(id)) set.delete(id);
    else if (set.size < 6) set.add(id);
    const next = [...set];
    navigate({
      to: "/compare",
      search: { deals: next.length ? next.join(",") : undefined },
      replace: true,
    });
  }

  const compareQ = useQuery({
    queryKey: ["compare", [...selectedIds].sort()],
    queryFn: () => compareDeals({ data: { ids: selectedIds } }),
    enabled: selectedIds.length >= 1,
  });
  const compared = compareQ.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow={t("page.compare.eyebrow")}
        title={t("page.compare.title")}
        subtitle={t("page.compare.subtitle")}
        actions={
          compared.length >= 2 ? (
            <Button size="sm" variant="outline" onClick={() => exportComparisonCsv(compared, fmt)}>
              <Download className="size-4 mr-1.5" /> CSV
            </Button>
          ) : null
        }
      />
      <PageBody>
        {/* Deal picker */}
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">
            Select deals to compare ({selectedIds.length}/6)
          </div>
          <div className="flex flex-wrap gap-2">
            {portfolio.map((d) => {
              const on = selectedIds.includes(d.id);
              return (
                <button
                  key={d.id}
                  onClick={() => toggle(d.id)}
                  disabled={!on && selectedIds.length >= 6}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors disabled:opacity-40",
                    on
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent/40",
                  )}
                >
                  {on && <Check className="size-3" />}
                  {d.name}
                </button>
              );
            })}
          </div>
        </Card>

        {selectedIds.length < 2 ? (
          <Card className="p-16 text-center elevated">
            <GitCompareArrows className="size-7 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm font-medium">{t("empty.compare.title")}</p>
            <p className="text-sm text-muted-foreground mt-1">{t("empty.compare.body")}</p>
          </Card>
        ) : compareQ.isLoading ? (
          <Card className="p-16 text-center text-sm text-muted-foreground elevated">Loading…</Card>
        ) : (
          <>
            <ComparisonGrid deals={compared} />
            <FindingsGrid deals={compared} />
          </>
        )}
      </PageBody>
    </>
  );
}

function ComparisonGrid({ deals }: { deals: ComparisonDeal[] }) {
  const { fmt } = usePreferences();
  return (
    <Card className="overflow-hidden elevated">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/35">
              <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground font-medium sticky left-0 bg-muted/35 min-w-[10rem]">
                Metric
              </th>
              {deals.map((d) => (
                <th key={d.id} className="px-4 py-3 text-right min-w-[9rem]">
                  <Link
                    to="/projects/$id"
                    params={{ id: d.id }}
                    className="inline-flex items-center gap-1 text-sm font-semibold hover:text-primary"
                  >
                    {d.name}
                    <ExternalLink className="size-3 opacity-50" />
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARISON_METRICS.map((metric) => {
              const winner = bestDealForMetric(deals, metric);
              return (
                <tr key={metric.key} className="border-t border-border">
                  <td className="px-4 py-2.5 text-left text-muted-foreground sticky left-0 bg-card">
                    {metric.label}
                  </td>
                  {deals.map((d) => {
                    const raw = d[metric.key];
                    const isWinner = winner === d.id;
                    let display: React.ReactNode = formatReportCell(raw as any, metric.type, fmt);
                    if (metric.key === "recommendation") {
                      const tone =
                        RECOMMENDATION_TONE[d.recommendation as keyof typeof RECOMMENDATION_TONE] ??
                        "neutral";
                      display = (
                        <span className={cn("font-medium", TONE_TEXT[tone])}>
                          {d.recommendationLabel}
                        </span>
                      );
                    }
                    return (
                      <td
                        key={d.id}
                        className={cn(
                          "px-4 py-2.5 text-right",
                          metric.type !== "text" && "num",
                          isWinner && "bg-success/10 font-semibold",
                        )}
                      >
                        {display}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function FindingsGrid({ deals }: { deals: ComparisonDeal[] }) {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(${Math.min(deals.length, 3)}, minmax(0, 1fr))` }}
    >
      {deals.map((d) => (
        <Card key={d.id} className="p-4">
          <div className="text-sm font-semibold truncate">{d.name}</div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-2 mb-1.5">
            Key findings
          </div>
          {d.keyFindings.length ? (
            <ul className="space-y-1">
              {d.keyFindings.map((f, i) => (
                <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                  <span className="text-primary">•</span>
                  {f}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No critical or high-priority findings.</p>
          )}
        </Card>
      ))}
    </div>
  );
}

// Lightweight CSV for the comparison matrix (metric rows × deal columns).
function exportComparisonCsv(
  deals: ComparisonDeal[],
  fmt: ReturnType<typeof usePreferences>["fmt"],
) {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const header = ["Metric", ...deals.map((d) => d.name)];
  const lines = [header.map(esc).join(",")];
  for (const m of COMPARISON_METRICS) {
    const cells = deals.map((d) => {
      const v = d[m.key];
      if (m.key === "recommendation") return esc(d.recommendationLabel);
      return typeof v === "number" ? String(v) : esc(String(v ?? ""));
    });
    lines.push([esc(m.label), ...cells].join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `agir_comparison_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
