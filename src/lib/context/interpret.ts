// Interpretation engine: grade each metric against its context-resolved
// benchmark, attach a comparative phrase, a contextual note, and a salience
// score. Pure functions over engine output + DealContext + benchmark inputs.

import type { EngineOutput } from "../engine/types";
import { resolveBenchmark } from "./benchmarks";
import type {
  Benchmark,
  BenchmarkInputs,
  DealContext,
  Interpretation,
  InterpretationBand,
} from "./types";

// metricKey -> how to pull it from EngineOutput.values, its label and unit.
const METRIC_REGISTRY: {
  key: string;
  label: string;
  unit: Benchmark["unit"];
  get: (v: EngineOutput["values"]) => number;
}[] = [
  { key: "dscr", label: "DSCR", unit: "x", get: (v) => v.dscr },
  { key: "debt_yield", label: "Debt Yield", unit: "%", get: (v) => v.debtYieldPct },
  { key: "yield_on_cost", label: "Yield on Cost", unit: "%", get: (v) => v.yieldOnCostPct },
  {
    key: "development_spread",
    label: "Development Spread",
    unit: "bps",
    get: (v) => v.developmentSpreadBps,
  },
  { key: "equity_multiple", label: "Equity Multiple", unit: "x", get: (v) => v.equityMultiple },
  { key: "irr_estimate", label: "Levered IRR", unit: "%", get: (v) => v.irrPct },
  { key: "profit_margin", label: "Profit on Cost", unit: "%", get: (v) => v.profitOnCostPct },
  { key: "cash_on_cash", label: "Cash-on-Cash", unit: "%", get: (v) => v.cashOnCashPct },
  { key: "loan_to_cost", label: "Loan-to-Cost", unit: "%", get: (v) => v.ltcPct },
  {
    key: "break_even_occupancy",
    label: "Break-even Occupancy",
    unit: "%",
    get: (v) => v.breakEvenOccupancyPct,
  },
];

const IMPORTANCE: Record<string, number> = {
  dscr: 1.0,
  debt_yield: 0.92,
  development_spread: 0.9,
  equity_multiple: 0.85,
  profit_margin: 0.82,
  irr_estimate: 0.8,
  break_even_occupancy: 0.72,
  yield_on_cost: 0.7,
  loan_to_cost: 0.6,
  cash_on_cash: 0.5,
};

const BAND_WEIGHT: Record<InterpretationBand, number> = {
  critical: 1.0,
  weak: 0.92,
  soft: 0.6,
  in_line: 0.3,
  strong: 0.5,
  exceptional: 0.55,
  neutral: 0.2,
};

export function classifyBand(value: number, b: Benchmark): InterpretationBand {
  if (b.betterDirection === "higher") {
    if (value >= b.strong) return "strong";
    if (value >= b.target) return "in_line";
    if (value >= b.weak) return "soft";
    return "weak";
  }
  if (value <= b.strong) return "strong";
  if (value <= b.target) return "in_line";
  if (value <= b.weak) return "soft";
  return "weak";
}

function fmtValue(value: number, unit: Benchmark["unit"]): string {
  if (unit === "x") return `${value.toFixed(2)}x`;
  if (unit === "bps") return `${Math.round(value)} bps`;
  if (unit === "%") return `${value.toFixed(1)}%`;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(value));
}

// Delta to target, formatted in the most analyst-natural unit for the metric
// (bps for yield-like %, points for other %, x for ratios).
function fmtDelta(metricKey: string, delta: number, unit: Benchmark["unit"]): string {
  const a = Math.abs(delta);
  if (metricKey === "debt_yield" || metricKey === "yield_on_cost")
    return `${Math.round(a * 100)} bps`;
  if (unit === "%") return `${a.toFixed(1)} pts`;
  if (unit === "bps") return `${Math.round(a)} bps`;
  if (unit === "x") return `${a.toFixed(2)}x`;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(a));
}

function contextNote(
  metricKey: string,
  band: InterpretationBand,
  ctx: DealContext,
): string | undefined {
  if (metricKey === "dscr" && ctx.loanStructure === "interest_only_full") {
    return "Headline DSCR is the amortizing payment; the loan is interest-only for the full hold, so near-term coverage runs materially higher (see interest-only DSCR).";
  }
  if (
    metricKey === "dscr" &&
    ctx.loanStructure === "partial_io" &&
    (band === "soft" || band === "weak")
  ) {
    return `Coverage tightens after the ${Math.round((ctx.ioMonths / 12) * 10) / 10}-year interest-only period converts to amortizing.`;
  }
  if (
    metricKey === "break_even_occupancy" &&
    (ctx.stage === "ground_up" || ctx.stage === "lease_up")
  ) {
    return `Stabilized break-even; the asset reaches it only after the ${ctx.monthsToStabilize}-month build and lease-up.`;
  }
  if (metricKey === "debt_yield" && ctx.marketTier === "gateway") {
    return "Gateway-market debt yields price lower against the asset's liquidity and exit depth.";
  }
  if (
    metricKey === "development_spread" &&
    (ctx.assetClass === "office" || ctx.assetClass === "retail")
  ) {
    return `${ctx.assetClass === "office" ? "Office" : "Retail"} exit caps are more volatile, so the spread cushion matters more than the headline.`;
  }
  return undefined;
}

export function interpretMetric(
  metricKey: string,
  label: string,
  value: number,
  unit: Benchmark["unit"],
  ctx: DealContext,
  inputs?: BenchmarkInputs,
): Interpretation {
  const benchmark = resolveBenchmark(metricKey, ctx, inputs) ?? undefined;
  if (!benchmark) {
    return {
      metricKey,
      label,
      value,
      unit,
      band: "neutral",
      comparativePhrase: "",
      salience: 0,
      derived: [value],
    };
  }
  const band = classifyBand(value, benchmark);
  const delta = value - benchmark.target;
  const numericallyAbove = delta > 0;
  const sourceLabel = benchmark.source === "curated" ? "" : ` (${benchmark.source} norm)`;
  const comparativePhrase = `${fmtDelta(metricKey, delta, unit)} ${numericallyAbove ? "above" : "below"} the ${benchmark.contextLabel} norm of ${fmtValue(benchmark.target, unit)}${sourceLabel}`;
  const note = contextNote(metricKey, band, ctx);
  // Salience: importance × band weight, lifted by how far the value sits from
  // target across the band's width. Deterministic and bounded 0–100.
  const width = Math.max(1e-9, Math.abs(benchmark.strong - benchmark.weak));
  const deviation = Math.min(1, Math.abs(delta) / width);
  const importance = IMPORTANCE[metricKey] ?? 0.5;
  const salience = Math.round(
    Math.min(100, 100 * importance * (BAND_WEIGHT[band] * 0.7 + deviation * 0.5)),
  );
  // Numbers the comparativePhrase renders, in the SAME representation the
  // provenance tokenizer will read (bps deltas ×100, % to one decimal, etc.).
  const a = Math.abs(delta);
  const displayedDelta =
    metricKey === "debt_yield" || metricKey === "yield_on_cost"
      ? Math.round(a * 100)
      : unit === "bps"
        ? Math.round(a)
        : unit === "x"
          ? Math.round(a * 100) / 100
          : Math.round(a * 10) / 10;
  const derived = [value, benchmark.target, displayedDelta];
  return {
    metricKey,
    label,
    value,
    unit,
    band,
    benchmark,
    deltaToTarget: delta,
    comparativePhrase,
    contextNote: note,
    salience,
    derived,
  };
}

export function interpretDeal(
  output: EngineOutput,
  ctx: DealContext,
  inputs?: BenchmarkInputs,
): Interpretation[] {
  const out: Interpretation[] = [];
  for (const m of METRIC_REGISTRY) {
    const value = m.get(output.values);
    if (!Number.isFinite(value)) continue;
    if (m.key === "break_even_occupancy" && value <= 0) continue;
    out.push(interpretMetric(m.key, m.label, value, m.unit, ctx, inputs));
  }
  return out.sort((a, b) => b.salience - a.salience);
}

// Convenience: the strongest favorable and the most material adverse reads.
export function partitionInterpretations(items: Interpretation[]) {
  const strengths = items.filter((i) => i.band === "strong" || i.band === "exceptional");
  const concerns = items.filter(
    (i) => i.band === "soft" || i.band === "weak" || i.band === "critical",
  );
  return { strengths, concerns, inLine: items.filter((i) => i.band === "in_line") };
}
