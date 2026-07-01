import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { listPortfolio, type DealSummary } from "@/lib/portfolio.functions";
import { PageHeader, PageBody } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { fmtCompact } from "@/lib/finance";
import {
  buildPortfolioInsights,
  daysUntil,
  dealVelocityScore,
  summarizePortfolio,
} from "@/lib/platform-insights";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import { usePreferences } from "@/lib/preferences";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import { DemoGuide } from "@/components/demo-guide";
import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarClock,
  CircleDollarSign,
  Gauge,
  Radio,
  ShieldAlert,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { RECOMMENDATION_TONE } from "@/lib/decision";
import { TONE_TEXT } from "@/components/decision-ui";

const portfolioQ = queryOptions({ queryKey: ["portfolio"], queryFn: () => listPortfolio() });

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard | Agir" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(portfolioQ),
  component: ExecutiveOverview,
});

function ExecutiveOverview() {
  const { data: deals } = useSuspenseQuery(portfolioQ);
  const { t } = usePreferences();
  useRealtimeRefresh();

  // One shared, deterministic rollup: no per-component ad-hoc reductions.
  const summary = summarizePortfolio(deals);
  const active = deals.filter((deal) => !["Approved", "Rejected"].includes(deal.stage));
  const capital = summary.grossCapital;
  const weighted = summary.weightedCapital;
  const averageScore = summary.avgInvestmentScore ?? 0;
  const scoredCount = deals.filter((d) => d.investmentScore != null).length;
  const averageVelocity = average(active.map(dealVelocityScore));
  const upcoming = deals
    .map((deal) => ({ deal, days: daysUntil(deal.targetCloseDate) }))
    .filter(
      (item): item is { deal: DealSummary; days: number } => item.days != null && item.days >= -30,
    )
    .sort((a, b) => a.days - b.days)
    .slice(0, 5);
  const opportunities = [...deals]
    .filter((deal) => deal.investmentScore != null)
    .sort((a, b) => (b.investmentScore ?? 0) - (a.investmentScore ?? 0))
    .slice(0, 4);
  const insights = buildPortfolioInsights(deals).slice(0, 3);

  return (
    <>
      <PageHeader
        title={t("dash.title")}
        subtitle={t("dash.subtitle")}
        actions={
          <Link to="/deals">
            <Button size="sm">
              {t("dash.openDealFlow")}
              <ArrowRight className="size-4 ml-1.5" />
            </Button>
          </Link>
        }
      />
      <PageBody>
        <DemoGuide />
        <OnboardingChecklist />
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-success">
          <Radio className="size-3" />
          {t("dash.liveData")}
        </div>

        <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-3">
          <Metric
            icon={BriefcaseBusiness}
            label={t("dash.activeDeals")}
            value={String(active.length)}
            detail={`${deals.length} ${t("dash.total")}`}
          />
          <Metric
            icon={CircleDollarSign}
            label={t("dash.grossPipeline")}
            value={fmtCompact(capital)}
            detail={`${fmtCompact(weighted)} ${t("dash.weighted")}`}
          />
          <Metric
            icon={TrendingUp}
            label={t("dash.avgScore")}
            value={averageScore ? String(averageScore) : "–"}
            detail={
              scoredCount
                ? `avg of ${scoredCount} scored deal${scoredCount === 1 ? "" : "s"}`
                : "no scored deals yet"
            }
          />
          <Metric
            icon={Gauge}
            label={t("dash.velocity")}
            value={String(averageVelocity)}
            detail="/ 100"
          />
          <Metric
            icon={ShieldAlert}
            label={t("dash.elevatedRisk")}
            value={String(summary.elevatedRiskCount)}
            detail={t("dash.needReview")}
          />
        </div>

        <div className="grid xl:grid-cols-[1.45fr_1fr] gap-5">
          <section>
            <SectionTitle
              title={t("dash.pipelineFlow")}
              action={
                <Link to="/deals" className="text-xs text-primary">
                  {t("dash.manage")}
                </Link>
              }
            />
            <Card className="p-5 elevated">
              <div className="space-y-4">
                {summary.stages.map(({ stage, count, capital: stageCapital }) => {
                  const width = deals.length ? (count / deals.length) * 100 : 0;
                  return (
                    <div key={stage}>
                      <div className="flex items-center justify-between gap-4 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{stage}</span>
                          <span className="num text-xs text-muted-foreground">{count}</span>
                        </div>
                        <span className="num text-xs">{fmtCompact(stageCapital)}</span>
                      </div>
                      <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${Math.max(width, count ? 4 : 0)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </section>

          <section>
            <SectionTitle
              title={t("dash.upcomingDates")}
              action={
                <Link to="/execution" className="text-xs text-primary">
                  {t("nav.execution")}
                </Link>
              }
            />
            <Card className="divide-y divide-border elevated overflow-hidden">
              {upcoming.length ? (
                upcoming.map(({ deal, days }) => (
                  <Link
                    key={deal.id}
                    to="/projects/$id"
                    params={{ id: deal.id }}
                    className="flex items-center gap-3 p-4 hover:bg-accent/30"
                  >
                    <div
                      className={`size-9 rounded-md flex items-center justify-center ${days < 0 ? "bg-destructive/10 text-destructive" : days <= 14 ? "bg-warning/10 text-warning" : "bg-primary/10 text-primary"}`}
                    >
                      <CalendarClock className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{deal.name}</div>
                      <div className="text-xs text-muted-foreground">{deal.targetCloseDate}</div>
                    </div>
                    <div className="num text-xs">
                      {days < 0
                        ? `${Math.abs(days)}d ${t("dash.overdueShort")}`
                        : days === 0
                          ? t("common.today")
                          : `${days}d`}
                    </div>
                  </Link>
                ))
              ) : (
                <Empty text={t("dash.addTargetDates")} />
              )}
            </Card>
          </section>
        </div>

        <div className="grid xl:grid-cols-[1.15fr_1fr] gap-5">
          <section>
            <SectionTitle title={t("dash.topOpportunities")} />
            <Card className="overflow-hidden elevated">
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-2.5 bg-muted/35 text-[10px] uppercase tracking-widest text-muted-foreground">
                <span>{t("common.deal")}</span>
                <span>{t("dash.confidence")}</span>
                <span>{t("dash.score")}</span>
              </div>
              {opportunities.map((deal) => {
                const tone =
                  RECOMMENDATION_TONE[deal.recommendation as keyof typeof RECOMMENDATION_TONE] ??
                  "neutral";
                return (
                  <Link
                    key={deal.id}
                    to="/projects/$id"
                    params={{ id: deal.id }}
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-3 border-t border-border hover:bg-accent/30"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{deal.name}</div>
                      <div className={`text-[10px] uppercase tracking-wider ${TONE_TEXT[tone]}`}>
                        {deal.recommendationLabel}
                      </div>
                    </div>
                    <div className="w-24 hidden sm:block">
                      <Progress value={deal.confidenceScore} className="h-1.5" />
                    </div>
                    <div className={`num text-lg ${TONE_TEXT[tone]}`}>{deal.investmentScore}</div>
                  </Link>
                );
              })}
              {!opportunities.length && <Empty text={t("dash.opportunitiesRank")} />}
            </Card>
          </section>

          <section>
            <SectionTitle
              title={t("dash.priorityInsights")}
              action={
                <Link to="/portfolio" className="text-xs text-primary">
                  {t("nav.portfolio")}
                </Link>
              }
            />
            <div className="space-y-3">
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
                      <p className="text-xs text-foreground mt-2">{insight.action}</p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        </div>
      </PageBody>
    </>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card className="p-4 elevated">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
        <Icon className="size-4 text-primary" />
      </div>
      <div className="num text-2xl mt-3">{value}</div>
      <div className="text-[10px] text-muted-foreground mt-1">{detail}</div>
    </Card>
  );
}

function SectionTitle({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="display text-lg font-semibold">{title}</h2>
      {action}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="p-8 text-center text-sm text-muted-foreground">{text}</div>;
}

function average(values: number[]) {
  return values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : 0;
}
