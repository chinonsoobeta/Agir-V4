// Curated CRE benchmark knowledge base + a layered resolver.
//
// Norms come from three sources, merged in this order of authority:
//   1. CURATED institutional defaults (below): transparent and versioned.
//   2. Firm config overrides (the configurable policy box).
//   3. Portfolio-derived percentiles (the firm's own deals), blended when there
//      is a large enough sample.
// Every resolved benchmark carries its `source` so the narrative can say where
// the bar came from. These defaults are deliberately conservative and tunable.

import type {
  AssetClass,
  Benchmark,
  BenchmarkBand,
  BenchmarkInputs,
  DealContext,
  MarketTier,
} from "./types";

type Bands = Record<string, BenchmarkBand>;

const higher = (
  weak: number,
  target: number,
  strong: number,
  unit: BenchmarkBand["unit"],
): BenchmarkBand => ({ betterDirection: "higher", weak, target, strong, unit });
const lower = (
  strong: number,
  target: number,
  weak: number,
  unit: BenchmarkBand["unit"],
): BenchmarkBand => ({ betterDirection: "lower", weak, target, strong, unit });

// Asset-class-agnostic baseline (institutional, mid-cycle).
const BASE: Bands = {
  dscr: higher(1.15, 1.25, 1.45, "x"),
  debt_yield: higher(7.5, 9.5, 11.5, "%"),
  yield_on_cost: higher(5.5, 6.5, 7.5, "%"),
  development_spread: higher(75, 150, 250, "bps"),
  equity_multiple: higher(1.4, 1.7, 2.2, "x"),
  irr_estimate: higher(10, 15, 20, "%"),
  profit_margin: higher(10, 18, 28, "%"),
  cash_on_cash: higher(4, 7, 10, "%"),
  loan_to_cost: lower(55, 65, 75, "%"), // lower leverage is safer
  break_even_occupancy: lower(72, 82, 90, "%"), // lower break-even is safer
};

// Additive per-asset-class adjustments to (weak, target, strong). Riskier
// classes demand higher yield/coverage; trophy classes tolerate less.
const ASSET_DELTA: Partial<Record<AssetClass, Partial<Record<string, number>>>> = {
  multifamily: { debt_yield: -0.5, yield_on_cost: -0.3 },
  industrial: { debt_yield: 0.0, yield_on_cost: 0.3, development_spread: 25 },
  office: {
    debt_yield: 1.5,
    dscr: 0.1,
    yield_on_cost: 0.7,
    development_spread: 50,
    break_even_occupancy: -5,
  },
  retail: { debt_yield: 1.0, dscr: 0.05, yield_on_cost: 0.5, break_even_occupancy: -3 },
  hospitality: { debt_yield: 3.0, dscr: 0.2, yield_on_cost: 1.5, development_spread: 100 },
  mixed_use: { debt_yield: 0.3, development_spread: 15 },
  other: {},
};

// Market tier shifts yields/coverage: gateway markets clear at lower yields,
// tertiary markets need more cushion.
const TIER_YIELD_DELTA: Record<MarketTier, number> = {
  gateway: -1.0,
  primary: -0.3,
  secondary: 0,
  tertiary: 0.8,
};
const TIER_DSCR_DELTA: Record<MarketTier, number> = {
  gateway: -0.05,
  primary: -0.02,
  secondary: 0,
  tertiary: 0.05,
};
const TIER_YIELD_METRICS = new Set(["debt_yield", "yield_on_cost", "cash_on_cash"]);

function shiftBand(band: BenchmarkBand, delta: number): BenchmarkBand {
  return {
    ...band,
    weak: band.weak + delta,
    target: band.target + delta,
    strong: band.strong + delta,
  };
}

export function curatedBenchmark(metricKey: string, context: DealContext): BenchmarkBand | null {
  const base = BASE[metricKey];
  if (!base) return null;
  let band = base;
  const assetDelta = ASSET_DELTA[context.assetClass]?.[metricKey];
  if (assetDelta != null) band = shiftBand(band, assetDelta);
  if (TIER_YIELD_METRICS.has(metricKey))
    band = shiftBand(band, TIER_YIELD_DELTA[context.marketTier]);
  if (metricKey === "dscr") band = shiftBand(band, TIER_DSCR_DELTA[context.marketTier]);
  return band;
}

function applyFirmOverride(
  band: BenchmarkBand,
  ctx: DealContext,
  metricKey: string,
  inputs?: BenchmarkInputs,
): BenchmarkBand {
  const cfg = inputs?.firmConfig?.overrides;
  if (!cfg) return band;
  const merged = { ...(cfg.all?.[metricKey] ?? {}), ...(cfg[ctx.assetClass]?.[metricKey] ?? {}) };
  return { ...band, ...merged };
}

// Blend portfolio percentiles with the curated/firm band when the sample is big
// enough. p50 nudges the target; p25/p75 nudge the weak/strong rails per
// direction. A 50/50 blend keeps curated discipline while reflecting the book.
function blendPortfolio(
  band: BenchmarkBand,
  metricKey: string,
  inputs?: BenchmarkInputs,
): { band: BenchmarkBand; blended: boolean; n: number } {
  const pn = inputs?.portfolioNorms;
  const min = inputs?.portfolioMinSample ?? 8;
  const stat = pn?.bands?.[metricKey];
  if (!pn || !stat || stat.n < min) return { band, blended: false, n: 0 };
  const mid = (a: number, b: number) => (a + b) / 2;
  if (band.betterDirection === "higher") {
    return {
      band: {
        ...band,
        weak: mid(band.weak, stat.p25),
        target: mid(band.target, stat.p50),
        strong: mid(band.strong, stat.p75),
      },
      blended: true,
      n: stat.n,
    };
  }
  return {
    band: {
      ...band,
      strong: mid(band.strong, stat.p25),
      target: mid(band.target, stat.p50),
      weak: mid(band.weak, stat.p75),
    },
    blended: true,
    n: stat.n,
  };
}

// The single resolver. Curated → firm override → portfolio blend, with the
// resulting provenance recorded on the returned Benchmark.
export function resolveBenchmark(
  metricKey: string,
  context: DealContext,
  inputs?: BenchmarkInputs,
): Benchmark | null {
  const curated = curatedBenchmark(metricKey, context);
  if (!curated) return null;
  const withFirm = applyFirmOverride(curated, context, metricKey, inputs);
  const firmTouched = withFirm !== curated && JSON.stringify(withFirm) !== JSON.stringify(curated);
  const { band, blended, n } = blendPortfolio(withFirm, metricKey, inputs);
  const source = blended ? "blended" : firmTouched ? "firm" : "curated";
  return {
    ...band,
    metricKey,
    source,
    contextLabel: `${context.marketLabel}${context.stage === "ground_up" ? ", ground-up" : ""}`,
    sampleSize: blended ? n : undefined,
  };
}

export const BENCHMARKED_METRICS = Object.keys(BASE);
