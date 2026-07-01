// The Decision view: the first thing seen on a deal. It answers "what
// decision should be made, and why?" before any metric is shown. Findings
// dominate; metrics are demoted to a supporting band at the bottom.

import { Card } from "@/components/ui/card";
import { SectionLabel, Eyebrow, TONE_CHIP, TONE_TEXT } from "@/components/decision-ui";
import type { DecisionSummary } from "@/lib/decision";
import type { Finding } from "@/lib/findings";
import type { Interpretation } from "@/lib/context/types";
import { fmtCompact } from "@/lib/finance";
import {
  TrendingUp,
  AlertTriangle,
  Lightbulb,
  ListChecks,
  ArrowUpRight,
  ArrowDownRight,
  Quote,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const SEV_TONE: Record<string, keyof typeof TONE_CHIP> = {
  critical: "reject",
  high: "reject",
  medium: "condition",
  low: "neutral",
};

function metricFmt(v: number | undefined, unit: string): string {
  if (v == null || !Number.isFinite(v)) return "–";
  if (unit === "$") return fmtCompact(v);
  if (unit === "%") return `${v.toFixed(1)}%`;
  if (unit === "x") return `${v.toFixed(2)}x`;
  if (unit === "bps") return `${v.toFixed(0)} bps`;
  return v.toLocaleString();
}

export function DealOverview({ decision }: { decision: DecisionSummary }) {
  const f = decision.findings;
  const b = decision.norm.base;

  if (!decision.hasUnderwriting) {
    return (
      <Card className="p-12 text-center elevated">
        <ListChecks className="size-8 mx-auto text-muted-foreground" />
        <h3 className="display text-xl mt-4">No decision yet</h3>
        <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
          This deal has not been underwritten. Approve the required assumptions in the{" "}
          <span className="text-foreground">Assumptions</span> tab, then run the deterministic
          engine in <span className="text-foreground">Analysis</span>. The Investment Score,
          findings and recommendation will appear here.
        </p>
      </Card>
    );
  }

  const primaryReason =
    f?.recommendationFindings?.[0]?.rationale ??
    f?.strengths?.[0]?.rationale ??
    "Recommendation derived from the deterministic gate set.";
  const topRisk = f?.criticalFindings?.[0] ?? f?.risks?.[0] ?? f?.weaknesses?.[0] ?? null;
  const topOpp = f?.opportunities?.[0] ?? f?.strengths?.[0] ?? null;

  return (
    <div className="space-y-5">
      {/* Executive summary: the single most important element */}
      <Card className="p-6 elevated">
        <div className="flex items-center justify-between">
          <Eyebrow>Executive Summary</Eyebrow>
          <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Findings Engine
          </span>
        </div>
        <p className="mt-3 text-lg leading-relaxed text-foreground/90 max-w-3xl">{primaryReason}</p>
        {decision.insight && (
          <div className="mt-4 rounded-md border border-primary/20 bg-primary/5 p-4 max-w-3xl">
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              <span className="text-[11px] uppercase tracking-widest text-primary font-semibold">
                Deterministic Read · Contextual
              </span>
              {decision.insight.context?.marketLabel && (
                <span className="text-[11px] capitalize border border-border rounded px-1.5 py-0.5 text-muted-foreground">
                  {decision.insight.context.marketLabel}
                </span>
              )}
              {decision.insight.context?.loanStructure && (
                <span className="text-[11px] capitalize border border-border rounded px-1.5 py-0.5 text-muted-foreground">
                  {String(decision.insight.context.loanStructure).replace(/_/g, " ")}
                </span>
              )}
            </div>
            <p className="text-sm leading-relaxed text-foreground/90">{decision.insight.thesis}</p>
            {decision.insight.interpretations?.length > 0 && (
              <ul className="mt-3 space-y-1">
                {decision.insight.interpretations
                  .filter((i: Interpretation) => i.band !== "neutral")
                  .slice(0, 4)
                  .map((i: Interpretation) => (
                    <li key={i.metricKey} className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground/80">{i.label}</span>:{" "}
                      {i.comparativePhrase}.
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}
        <div className="grid md:grid-cols-2 gap-3 mt-5">
          <SummaryBox
            icon={AlertTriangle}
            tone="reject"
            label="Top Risk"
            title={topRisk?.title ?? "No material risk identified"}
            body={topRisk?.rationale}
          />
          <SummaryBox
            icon={Lightbulb}
            tone="approve"
            label="Top Opportunity"
            title={topOpp?.title ?? "No standout opportunity identified"}
            body={topOpp?.rationale}
          />
        </div>
      </Card>

      {/* Findings panel: dominates the screen */}
      <div className="grid lg:grid-cols-2 gap-4">
        <FindingsColumn
          title="Strengths"
          icon={TrendingUp}
          tone="approve"
          findings={f?.strengths ?? []}
          empty="No strengths surfaced."
        />
        <FindingsColumn
          title="Risks"
          icon={AlertTriangle}
          tone="reject"
          findings={[...(f?.risks ?? []), ...(f?.weaknesses ?? [])]}
          empty="No risks surfaced."
        />
        <FindingsColumn
          title="Opportunities"
          icon={Lightbulb}
          tone="return"
          findings={f?.opportunities ?? []}
          empty="No opportunities surfaced."
        />
        <FindingsColumn
          title="Approval Conditions"
          icon={ListChecks}
          tone="condition"
          findings={f?.approvalConditions ?? []}
          empty="No conditions required."
        />
      </div>

      {/* Investment thesis + key drivers */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-6 elevated">
          <div className="flex items-center gap-2">
            <Quote className="size-4 text-primary" />
            <SectionLabel>Investment Thesis</SectionLabel>
          </div>
          <p className="text-sm text-muted-foreground mt-3">What creates value in this deal:</p>
          <ul className="mt-3 space-y-2.5">
            {(f?.strengths ?? []).slice(0, 4).map((s) => (
              <li key={s.id} className="flex gap-2.5 text-sm">
                <span className="mt-1.5 size-1.5 rounded-full bg-success shrink-0" />
                <span>
                  <span className="font-medium">{s.title}.</span>{" "}
                  <span className="text-muted-foreground">{s.rationale}</span>
                </span>
              </li>
            ))}
            {(f?.strengths ?? []).length === 0 && (
              <li className="text-sm text-muted-foreground">
                The deterministic strengths set is empty: value creation is unproven at current
                assumptions.
              </li>
            )}
          </ul>
        </Card>

        <Card className="p-6 elevated">
          <SectionLabel>Key Drivers</SectionLabel>
          <div className="grid grid-cols-2 gap-5 mt-3">
            <DriverList
              title="Value drivers"
              icon={ArrowUpRight}
              tone="approve"
              drivers={f?.primaryDrivers ?? []}
            />
            <DriverList
              title="Risk drivers"
              icon={ArrowDownRight}
              tone="reject"
              drivers={f?.downsideDrivers ?? []}
            />
          </div>
        </Card>
      </div>

      {/* Metrics: supporting, demoted to the bottom */}
      <div>
        <Eyebrow>Supporting Metrics</Eyebrow>
        <Card className="p-5 mt-3">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-x-6 gap-y-4">
            <MetricItem
              label="Investment Score"
              value={decision.investmentScore != null ? `${decision.investmentScore}` : "–"}
            />
            <MetricItem label="Equity Multiple" value={metricFmt(b.equity_multiple, "x")} />
            <MetricItem label="Levered IRR" value={metricFmt(b.irr_estimate, "%")} />
            <MetricItem label="DSCR" value={metricFmt(b.dscr, "x")} />
            <MetricItem label="Profit Margin" value={metricFmt(b.profit_margin, "%")} />
            <MetricItem label="Yield on Cost" value={metricFmt(b.yield_on_cost, "%")} />
            <MetricItem label="Dev. Spread" value={metricFmt(b.development_spread, "bps")} />
            <MetricItem label="LTC" value={metricFmt(b.loan_to_cost, "%")} />
            <MetricItem label="Total Cost" value={metricFmt(b.total_project_cost, "$")} />
            <MetricItem label="Exit Value" value={metricFmt(b.exit_value, "$")} />
            <MetricItem label="Equity Req." value={metricFmt(b.equity_requirement, "$")} />
            <MetricItem label="Dev. Profit" value={metricFmt(b.projected_profit, "$")} />
          </div>
          <p className="text-[11px] text-muted-foreground mt-4">
            Every figure is a deterministic engine output. Metrics support the decision: they do not
            make it.
          </p>
        </Card>
      </div>
    </div>
  );
}

function SummaryBox({
  icon: Icon,
  tone,
  label,
  title,
  body,
}: {
  icon: LucideIcon;
  tone: keyof typeof TONE_CHIP;
  label: string;
  title: string;
  body?: string;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${TONE_CHIP[tone].replace(/text-\S+/, "")} border-border bg-muted/20`}
    >
      <div className="flex items-center gap-2">
        <Icon className={`size-4 ${TONE_TEXT[tone]}`} />
        <span className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
          {label}
        </span>
      </div>
      <div className="text-sm font-medium mt-2">{title}</div>
      {body && <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{body}</p>}
    </div>
  );
}

function FindingsColumn({
  title,
  icon: Icon,
  tone,
  findings,
  empty,
}: {
  title: string;
  icon: LucideIcon;
  tone: keyof typeof TONE_CHIP;
  findings: Finding[];
  empty: string;
}) {
  return (
    <Card className="p-5 elevated">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={`size-4 ${TONE_TEXT[tone]}`} />
          <SectionLabel>{title}</SectionLabel>
        </div>
        <span className="num text-xs text-muted-foreground">{findings.length}</span>
      </div>
      {findings.length === 0 ? (
        <p className="text-sm text-muted-foreground mt-3">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {findings.slice(0, 5).map((x) => (
            <li
              key={x.id}
              className="border-l-2 pl-3"
              style={{
                borderColor: `var(--color-${tone === "approve" ? "success" : tone === "reject" ? "destructive" : tone === "condition" ? "warning" : "chart-2"})`,
              }}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{x.title}</span>
                <span
                  className={`text-[11px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${TONE_CHIP[SEV_TONE[x.severity] ?? "neutral"]}`}
                >
                  {x.severity}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{x.rationale}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DriverList({
  title,
  icon: Icon,
  tone,
  drivers,
}: {
  title: string;
  icon: LucideIcon;
  tone: keyof typeof TONE_CHIP;
  drivers: { rank: number; name: string; rationale: string }[];
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <Icon className={`size-3.5 ${TONE_TEXT[tone]}`} />
        <span className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
          {title}
        </span>
      </div>
      <ol className="mt-2.5 space-y-2">
        {drivers.slice(0, 5).map((d) => (
          <li key={d.rank} className="flex gap-2 text-xs">
            <span className="num text-muted-foreground">{d.rank}.</span>
            <span className="font-medium" title={d.rationale}>
              {d.name}
            </span>
          </li>
        ))}
        {drivers.length === 0 && <li className="text-xs text-muted-foreground">None ranked.</li>}
      </ol>
    </div>
  );
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground leading-tight">
        {label}
      </div>
      <div className="num text-base mt-1">{value}</div>
    </div>
  );
}
