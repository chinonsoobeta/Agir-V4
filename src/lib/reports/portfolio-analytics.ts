// Deterministic portfolio analytics.
//
// Every figure here is an AGGREGATION of values that already came out of the
// deterministic engine (via DealSummary / decision_logs). These builders group,
// count, weight and sort — they never invent or re-derive a financial value.
// Numbers stay numbers (no formatting) so exports get real numeric cells and the
// UI can format per the active locale. Each report carries a plain-language
// formula/data-source note for transparency.

import type { DealSummary } from "../portfolio.functions";
import { PIPELINE_STAGES, type PipelineStage } from "../decision";
import { assetTypeLabel } from "../asset-types";

export type ReportColumnType =
  | "text"
  | "integer"
  | "number"
  | "currency"
  | "percent"
  | "multiple"
  | "date";

export type ReportColumn = { key: string; label: string; type: ReportColumnType };
export type ReportCell = string | number | null;
export type ReportRow = { cells: Record<string, ReportCell>; dealId?: string };
export type ReportSummaryStat = { label: string; value: ReportCell; type: ReportColumnType };

export type PortfolioReportId =
  | "pipeline_conversion"
  | "capital_deployment"
  | "deal_velocity"
  | "risk_confidence"
  | "upcoming_deadlines"
  | "concentration"
  | "decision_history"
  | "sourcing";

export type AnalyticsReport = {
  id: PortfolioReportId;
  columns: ReportColumn[];
  rows: ReportRow[];
  summary: ReportSummaryStat[];
  formula: string;
  rowCount: number;
};

export type DecisionHistoryRow = {
  project_id: string;
  deal_name: string;
  decision: string;
  rationale: string | null;
  conditions: string | null;
  user_name: string | null;
  created_at: string;
};

const ACTIVE_STAGES: PipelineStage[] = [
  "Screening",
  "Document Review",
  "Underwriting",
  "Investment Committee",
];

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const weighted = (deals: DealSummary[]) => sum(deals.map((d) => d.capital * (d.probability / 100)));
const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}

/** Whole-day difference from today (UTC date math, deterministic given `now`). */
export function daysBetween(target: string | null, now: Date): number | null {
  if (!target) return null;
  const t = new Date(target).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.round((t - now.getTime()) / 86_400_000);
}

// ---- Pipeline conversion ----
export function buildPipelineConversion(deals: DealSummary[]): AnalyticsReport {
  const total = deals.length || 1;
  const rows: ReportRow[] = PIPELINE_STAGES.map((stage) => {
    const inStage = deals.filter((d) => d.stage === stage);
    return {
      cells: {
        stage,
        deals: inStage.length,
        share: (inStage.length / total) * 100,
        gross: sum(inStage.map((d) => d.capital)),
        weighted: weighted(inStage),
      },
    };
  });
  const approved = deals.filter((d) => d.stage === "Approved").length;
  const decided = deals.filter((d) => d.stage === "Approved" || d.stage === "Rejected").length;
  return {
    id: "pipeline_conversion",
    columns: [
      { key: "stage", label: "Stage", type: "text" },
      { key: "deals", label: "Deals", type: "integer" },
      { key: "share", label: "Share of pipeline", type: "percent" },
      { key: "gross", label: "Gross capital", type: "currency" },
      { key: "weighted", label: "Probability-weighted", type: "currency" },
    ],
    rows,
    summary: [
      { label: "Deals in pipeline", value: deals.length, type: "integer" },
      { label: "Approved", value: approved, type: "integer" },
      {
        label: "Win rate (approved / decided)",
        value: decided ? (approved / decided) * 100 : 0,
        type: "percent",
      },
      { label: "Gross pipeline", value: sum(deals.map((d) => d.capital)), type: "currency" },
      { label: "Probability-weighted", value: weighted(deals), type: "currency" },
    ],
    formula:
      "Counts and capital grouped by deterministic pipeline stage. Probability-weighted = Σ(capital × probability). Win rate = approved ÷ (approved + rejected).",
    rowCount: rows.length,
  };
}

// ---- Capital deployment by asset class ----
export function buildCapitalDeployment(deals: DealSummary[]): AnalyticsReport {
  const groups = groupBy(deals, (d) => d.type || "other");
  const rows: ReportRow[] = [...groups.entries()]
    .map(([type, ds]) => ({
      cells: {
        type: assetTypeLabel(type),
        deals: ds.length,
        gross: sum(ds.map((d) => d.capital)),
        weighted: weighted(ds),
        avgScore:
          Math.round(avg(ds.map((d) => d.investmentScore ?? 0).filter((v) => v > 0))) || null,
      },
    }))
    .sort((a, b) => (b.cells.gross as number) - (a.cells.gross as number));
  return {
    id: "capital_deployment",
    columns: [
      { key: "type", label: "Asset class", type: "text" },
      { key: "deals", label: "Deals", type: "integer" },
      { key: "gross", label: "Gross capital", type: "currency" },
      { key: "weighted", label: "Probability-weighted", type: "currency" },
      { key: "avgScore", label: "Avg investment score", type: "integer" },
    ],
    rows,
    summary: [
      { label: "Asset classes", value: groups.size, type: "integer" },
      { label: "Gross capital", value: sum(deals.map((d) => d.capital)), type: "currency" },
      { label: "Probability-weighted", value: weighted(deals), type: "currency" },
    ],
    formula:
      "Capital grouped by deterministic asset class. Gross = Σ capital requirement; weighted = Σ(capital × probability); avg score = mean Investment Score of underwritten deals.",
    rowCount: rows.length,
  };
}

// ---- Deal velocity / freshness ----
export function buildDealVelocity(deals: DealSummary[], now: Date): AnalyticsReport {
  const rows: ReportRow[] = deals
    .map((d) => {
      const ageDays = Math.max(0, -(daysBetween(d.updatedAt, now) ?? 0));
      return {
        dealId: d.id,
        cells: {
          name: d.name,
          stage: d.stage,
          owner: d.source ?? null,
          ageDays,
          stale: ageDays > 14 && ACTIVE_STAGES.includes(d.stage) ? "Stale" : "",
        },
      };
    })
    .sort((a, b) => (b.cells.ageDays as number) - (a.cells.ageDays as number));
  const staleCount = rows.filter((r) => r.cells.stale === "Stale").length;
  return {
    id: "deal_velocity",
    columns: [
      { key: "name", label: "Deal", type: "text" },
      { key: "stage", label: "Stage", type: "text" },
      { key: "ageDays", label: "Days since update", type: "integer" },
      { key: "stale", label: "Flag", type: "text" },
    ],
    rows,
    summary: [
      {
        label: "Active deals",
        value: deals.filter((d) => ACTIVE_STAGES.includes(d.stage)).length,
        type: "integer",
      },
      { label: "Stale (>14d, active)", value: staleCount, type: "integer" },
    ],
    formula:
      "Days since update = today − last updated. A deal is flagged Stale when it has not moved in over 14 days while still in an active stage.",
    rowCount: rows.length,
  };
}

// ---- Risk & confidence ----
export function buildRiskConfidence(deals: DealSummary[]): AnalyticsReport {
  const underwritten = deals.filter((d) => d.hasUnderwriting);
  const rows: ReportRow[] = underwritten
    .map((d) => ({
      dealId: d.id,
      cells: {
        name: d.name,
        risk: d.riskRating,
        investment: d.investmentScore,
        confidence: d.confidenceScore,
        topRisk: d.topRisk ?? "—",
      },
    }))
    .sort((a, b) => (a.cells.confidence as number) - (b.cells.confidence as number));
  const lowConfidence = underwritten.filter((d) => d.confidenceScore < 65).length;
  const elevated = underwritten.filter(
    (d) => d.riskRating === "High" || d.riskRating === "Critical",
  ).length;
  return {
    id: "risk_confidence",
    columns: [
      { key: "name", label: "Deal", type: "text" },
      { key: "risk", label: "Risk rating", type: "text" },
      { key: "investment", label: "Investment score", type: "integer" },
      { key: "confidence", label: "Confidence score", type: "integer" },
      { key: "topRisk", label: "Top finding", type: "text" },
    ],
    rows,
    summary: [
      { label: "Underwritten deals", value: underwritten.length, type: "integer" },
      { label: "Low confidence (<65)", value: lowConfidence, type: "integer" },
      { label: "High/Critical risk", value: elevated, type: "integer" },
      {
        label: "Avg confidence",
        value: Math.round(avg(underwritten.map((d) => d.confidenceScore))),
        type: "integer",
      },
    ],
    formula:
      "Investment Score, Confidence Score, risk rating and top finding from the deterministic decision layer. Low-confidence threshold = 65/100.",
    rowCount: rows.length,
  };
}

// ---- Upcoming deadlines ----
export function buildUpcomingDeadlines(deals: DealSummary[], now: Date): AnalyticsReport {
  const rows: ReportRow[] = deals
    .map((d) => ({ d, days: daysBetween(d.targetCloseDate, now) }))
    .filter((x): x is { d: DealSummary; days: number } => x.days != null)
    .sort((a, b) => a.days - b.days)
    .map(({ d, days }) => ({
      dealId: d.id,
      cells: {
        name: d.name,
        stage: d.stage,
        target: d.targetCloseDate,
        days,
        flag: days < 0 ? "Overdue" : days <= 14 ? "Due soon" : "",
      },
    }));
  const overdue = rows.filter((r) => r.cells.flag === "Overdue").length;
  const dueSoon = rows.filter((r) => r.cells.flag === "Due soon").length;
  return {
    id: "upcoming_deadlines",
    columns: [
      { key: "name", label: "Deal", type: "text" },
      { key: "stage", label: "Stage", type: "text" },
      { key: "target", label: "Target close", type: "date" },
      { key: "days", label: "Days to close", type: "integer" },
      { key: "flag", label: "Flag", type: "text" },
    ],
    rows,
    summary: [
      { label: "With target dates", value: rows.length, type: "integer" },
      { label: "Overdue", value: overdue, type: "integer" },
      { label: "Due within 14 days", value: dueSoon, type: "integer" },
    ],
    formula:
      "Days to close = target close date − today. Overdue when negative; Due soon within 14 days. Deals without a target date are omitted.",
    rowCount: rows.length,
  };
}

// ---- Concentration ----
export function buildConcentration(deals: DealSummary[]): AnalyticsReport {
  const totalCapital = sum(deals.map((d) => d.capital)) || 1;
  const rows: ReportRow[] = [...deals]
    .sort((a, b) => b.capital - a.capital)
    .map((d) => ({
      dealId: d.id,
      cells: {
        name: d.name,
        type: assetTypeLabel(d.type),
        capital: d.capital,
        share: (d.capital / totalCapital) * 100,
      },
    }));
  const top = rows[0];
  return {
    id: "concentration",
    columns: [
      { key: "name", label: "Deal", type: "text" },
      { key: "type", label: "Asset class", type: "text" },
      { key: "capital", label: "Capital", type: "currency" },
      { key: "share", label: "Share of capital", type: "percent" },
    ],
    rows,
    summary: [
      {
        label: "Largest single deal",
        value: top ? (top.cells.share as number) : 0,
        type: "percent",
      },
      {
        label: "Top 3 concentration",
        value: (sum(rows.slice(0, 3).map((r) => r.cells.capital as number)) / totalCapital) * 100,
        type: "percent",
      },
      { label: "Gross capital", value: sum(deals.map((d) => d.capital)), type: "currency" },
    ],
    formula:
      "Share of capital = deal capital ÷ total portfolio capital. Top-3 concentration sums the three largest positions.",
    rowCount: rows.length,
  };
}

// ---- Sourcing ----
export function buildSourcing(deals: DealSummary[]): AnalyticsReport {
  const groups = groupBy(deals, (d) => (d.source && d.source.trim()) || "Unattributed");
  const rows: ReportRow[] = [...groups.entries()]
    .map(([source, ds]) => {
      const decided = ds.filter((d) => d.stage === "Approved" || d.stage === "Rejected").length;
      const approved = ds.filter((d) => d.stage === "Approved").length;
      return {
        cells: {
          source,
          deals: ds.length,
          gross: sum(ds.map((d) => d.capital)),
          approved,
          winRate: decided ? (approved / decided) * 100 : null,
        },
      };
    })
    .sort((a, b) => (b.cells.deals as number) - (a.cells.deals as number));
  return {
    id: "sourcing",
    columns: [
      { key: "source", label: "Source", type: "text" },
      { key: "deals", label: "Deals", type: "integer" },
      { key: "gross", label: "Gross capital", type: "currency" },
      { key: "approved", label: "Approved", type: "integer" },
      { key: "winRate", label: "Win rate", type: "percent" },
    ],
    rows,
    summary: [
      { label: "Sourcing channels", value: groups.size, type: "integer" },
      { label: "Deals sourced", value: deals.length, type: "integer" },
    ],
    formula:
      "Deals grouped by source channel. Win rate = approved ÷ (approved + rejected) within the channel; blank when nothing has been decided yet.",
    rowCount: rows.length,
  };
}

// ---- Decision history (from decision_logs) ----
export function buildDecisionHistory(decisions: DecisionHistoryRow[]): AnalyticsReport {
  const LABEL: Record<string, string> = {
    approve: "Approved",
    approve_with_conditions: "Approved with conditions",
    reject: "Rejected",
    return_to_underwriting: "Returned to underwriting",
  };
  const rows: ReportRow[] = decisions.map((d) => ({
    dealId: d.project_id,
    cells: {
      date: d.created_at,
      name: d.deal_name,
      decision: LABEL[d.decision] ?? d.decision,
      by: d.user_name ?? "—",
      conditions: d.conditions ?? "—",
    },
  }));
  const approvals = decisions.filter((d) => d.decision.startsWith("approve")).length;
  return {
    id: "decision_history",
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "name", label: "Deal", type: "text" },
      { key: "decision", label: "Decision", type: "text" },
      { key: "by", label: "Recorded by", type: "text" },
      { key: "conditions", label: "Conditions", type: "text" },
    ],
    rows,
    summary: [
      { label: "Decisions recorded", value: decisions.length, type: "integer" },
      { label: "Approvals", value: approvals, type: "integer" },
    ],
    formula:
      "Every recorded Investment Committee decision, newest first, from the immutable decision log.",
    rowCount: rows.length,
  };
}

export const PORTFOLIO_REPORT_IDS: PortfolioReportId[] = [
  "pipeline_conversion",
  "capital_deployment",
  "deal_velocity",
  "risk_confidence",
  "upcoming_deadlines",
  "concentration",
  "decision_history",
  "sourcing",
];

/** Build any portfolio-data report (decision_history is handled separately). */
export function buildPortfolioReport(
  id: PortfolioReportId,
  deals: DealSummary[],
  now: Date,
): AnalyticsReport {
  switch (id) {
    case "pipeline_conversion":
      return buildPipelineConversion(deals);
    case "capital_deployment":
      return buildCapitalDeployment(deals);
    case "deal_velocity":
      return buildDealVelocity(deals, now);
    case "risk_confidence":
      return buildRiskConfidence(deals);
    case "upcoming_deadlines":
      return buildUpcomingDeadlines(deals, now);
    case "concentration":
      return buildConcentration(deals);
    case "sourcing":
      return buildSourcing(deals);
    case "decision_history":
      return buildDecisionHistory([]);
  }
}
