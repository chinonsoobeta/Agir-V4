// Side-by-side deal comparison model.
//
// Every value originates from the deterministic decision layer (buildDecision):
// scores, recommendation and risk from the decision summary; returns/debt
// metrics from norm.base; stress outcomes from norm.worstStress. This module
// only SHAPES those values into a comparison matrix and decides which deal is
// "best" per metric for highlighting — it computes no financial figures.

import type { ReportColumnType } from "./portfolio-analytics";

export type ComparisonDeal = {
  id: string;
  name: string;
  type: string;
  location: string | null;
  hasUnderwriting: boolean;
  recommendation: string;
  recommendationLabel: string;
  riskRating: string;
  investmentScore: number | null;
  confidenceScore: number;
  capital: number;
  irr: number | null;
  equityMultiple: number | null;
  dscr: number | null;
  yieldOnCost: number | null;
  exitCap: number | null;
  worstStressDscr: number | null;
  worstStressEm: number | null;
  keyFindings: string[];
  dataGaps: number;
  targetClose: string | null;
};

export type ComparisonMetricKey =
  | "recommendation"
  | "investmentScore"
  | "confidenceScore"
  | "riskRating"
  | "capital"
  | "irr"
  | "equityMultiple"
  | "dscr"
  | "yieldOnCost"
  | "exitCap"
  | "worstStressDscr"
  | "worstStressEm"
  | "dataGaps"
  | "targetClose";

export type ComparisonMetric = {
  key: ComparisonMetricKey;
  label: string;
  type: ReportColumnType;
  /** Direction of "better" for highlighting; null = not comparable. */
  better: "high" | "low" | null;
};

// Ordered top-to-bottom in the comparison table.
export const COMPARISON_METRICS: ComparisonMetric[] = [
  { key: "recommendation", label: "Recommendation", type: "text", better: null },
  { key: "riskRating", label: "Risk rating", type: "text", better: null },
  { key: "investmentScore", label: "Investment score", type: "integer", better: "high" },
  { key: "confidenceScore", label: "Confidence score", type: "integer", better: "high" },
  { key: "capital", label: "Capital", type: "currency", better: null },
  { key: "irr", label: "Levered IRR", type: "percent", better: "high" },
  { key: "equityMultiple", label: "Equity multiple", type: "multiple", better: "high" },
  { key: "dscr", label: "DSCR", type: "multiple", better: "high" },
  { key: "yieldOnCost", label: "Yield on cost", type: "percent", better: "high" },
  { key: "exitCap", label: "Exit cap", type: "percent", better: "low" },
  { key: "worstStressDscr", label: "Worst-stress DSCR", type: "multiple", better: "high" },
  { key: "worstStressEm", label: "Worst-stress equity multiple", type: "multiple", better: "high" },
  { key: "dataGaps", label: "Data gaps", type: "integer", better: "low" },
  { key: "targetClose", label: "Target close", type: "date", better: null },
];

/**
 * Which deal wins a metric (id), or null when not comparable / tied / no data.
 * Used purely for visual highlighting in the comparison grid.
 */
export function bestDealForMetric(
  deals: ComparisonDeal[],
  metric: ComparisonMetric,
): string | null {
  if (!metric.better) return null;
  const candidates = deals
    .map((d) => ({ id: d.id, v: d[metric.key] }))
    .filter((x): x is { id: string; v: number } => typeof x.v === "number" && Number.isFinite(x.v));
  if (candidates.length < 2) return null;
  const sorted = [...candidates].sort((a, b) => (metric.better === "high" ? b.v - a.v : a.v - b.v));
  // Tie at the top → no single winner.
  if (sorted.length >= 2 && sorted[0].v === sorted[1].v) return null;
  return sorted[0].id;
}
