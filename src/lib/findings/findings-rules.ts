import type { Finding, FindingSeverity, NormalizedMetricSet } from "./findings-types";

export const FINDING_THRESHOLDS = {
  strongOccupancyPct: 92,
  minDscr: 1.2,
  thinSpreadBps: 100,
  weakEquityMultiple: 1.3,
  institutionalEquityMultiple: 1.5,
  weakProfitMarginPct: 5,
  leverageOptimizationPct: 10,
} as const;

export const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function sortFindings(findings: Finding[]) {
  return [...findings].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.id.localeCompare(b.id),
  );
}

export function metric(metrics: NormalizedMetricSet, key: string): number | null {
  const v = metrics[key];
  return Number.isFinite(v) ? v : null;
}

export function money(n: number) {
  return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n))}`;
}

export function pct(n: number) {
  return `${n.toFixed(2)}%`;
}

export function x(n: number) {
  return `${n.toFixed(2)}x`;
}

export function bps(n: number) {
  return `${Math.round(n)} bps`;
}

export function f(
  id: string,
  category: Finding["category"],
  severity: Finding["severity"],
  title: string,
  evidence: string[],
  metrics: Record<string, number>,
  rationale: string,
  source: Finding["source"],
  recommendation?: string,
): Finding {
  return { id, category, severity, title, evidence, metrics, rationale, source, recommendation };
}
