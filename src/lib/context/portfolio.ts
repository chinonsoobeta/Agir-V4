// Portfolio-derived norms: percentile bands computed from the firm's own deals,
// so context-aware judgment can blend "what we actually do" with the curated
// institutional defaults. Pure function over persisted base-scenario metrics.

import { BENCHMARKED_METRICS } from "./benchmarks";
import type { PortfolioNorms } from "./types";

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function computePortfolioNorms(
  rows: { project_id: string; metric_key: string; value_numeric: number | null }[],
): PortfolioNorms {
  const byMetric = new Map<string, number[]>();
  const projects = new Set<string>();
  for (const r of rows) {
    if (!BENCHMARKED_METRICS.includes(r.metric_key)) continue;
    const v = r.value_numeric == null ? NaN : Number(r.value_numeric);
    if (!Number.isFinite(v)) continue;
    projects.add(r.project_id);
    if (!byMetric.has(r.metric_key)) byMetric.set(r.metric_key, []);
    byMetric.get(r.metric_key)!.push(v);
  }
  const bands: PortfolioNorms["bands"] = {};
  for (const [k, vals] of byMetric) {
    const s = [...vals].sort((a, b) => a - b);
    bands[k] = {
      p25: percentile(s, 0.25),
      p50: percentile(s, 0.5),
      p75: percentile(s, 0.75),
      n: s.length,
    };
  }
  return { bands, sampleSize: projects.size };
}
