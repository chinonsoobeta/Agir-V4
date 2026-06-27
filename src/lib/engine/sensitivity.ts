// WS3 / 3B. Flexible sensitivity: flex ANY input over a range and RE-RUN the pure
// engine. Every number a tornado, breakeven, or 2-variable grid produces is a real
// runUnderwriting output -- nothing is synthesized -- exactly like STRESS_PRESETS
// (scenarios.ts), just generalized to an arbitrary driver, range, and metric.

import { runUnderwriting } from "./proforma";
import type { EngineOutput, UnderwritingInput } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const scaleBudget = (input: UnderwritingInput, f: number): UnderwritingInput["budget"] => ({
  ...input.budget,
  land: input.budget.land * f,
  hard: input.budget.hard * f,
  soft: input.budget.soft * f,
  contingency: input.budget.contingency * f,
  financingInterest:
    input.budget.financingInterest == null ? undefined : input.budget.financingInterest * f,
  other: input.budget.other == null ? undefined : input.budget.other * f,
});

// A flexable driver. `read` is the current (base) value; `set` returns a NEW input
// with the driver at an ABSOLUTE value (clamped to a sensible domain). rent_level
// and cost_level are index drivers (base 100) that scale every rent / cost line.
export type SensitivityVar = {
  key: string;
  label: string;
  unit: "%" | "x" | "$" | "yr" | "index";
  read: (input: UnderwritingInput) => number;
  set: (input: UnderwritingInput, value: number) => UnderwritingInput;
  // Default breakeven search bounds; omitted => [base*0.5, base*1.5].
  bounds?: [number, number];
};

export const SENSITIVITY_VARS: SensitivityVar[] = [
  {
    key: "interest_rate",
    label: "Interest Rate",
    unit: "%",
    bounds: [0, 25],
    read: (i) => i.interestRatePct,
    set: (i, v) => ({ ...i, interestRatePct: clamp(v, 0, 40) }),
  },
  {
    key: "exit_cap_rate",
    label: "Exit Cap Rate",
    unit: "%",
    bounds: [1, 15],
    read: (i) => i.exitCapRatePct,
    set: (i, v) => ({ ...i, exitCapRatePct: clamp(v, 0.5, 20) }),
  },
  {
    key: "expense_ratio",
    label: "Operating Expense Ratio",
    unit: "%",
    bounds: [0, 90],
    read: (i) => i.expenseRatioPct,
    set: (i, v) => ({ ...i, expenseRatioPct: clamp(v, 0, 95) }),
  },
  {
    key: "stabilized_occupancy",
    label: "Stabilized Occupancy",
    unit: "%",
    bounds: [40, 100],
    read: (i) => i.stabilizedOccupancyPct,
    set: (i, v) => {
      const nv = clamp(v, 0, 100);
      const delta = nv - i.stabilizedOccupancyPct;
      return {
        ...i,
        stabilizedOccupancyPct: nv,
        revenueProgram: i.revenueProgram.map((r) =>
          r.occupancyPct == null
            ? r
            : { ...r, occupancyPct: clamp(r.occupancyPct + delta, 0, 100) },
        ),
      };
    },
  },
  {
    key: "rent_growth",
    label: "Annual Rent Growth",
    unit: "%",
    bounds: [-20, 20],
    read: (i) => i.rentGrowthPct,
    set: (i, v) => ({ ...i, rentGrowthPct: clamp(v, -50, 50) }),
  },
  {
    key: "selling_costs",
    label: "Disposition Costs",
    unit: "%",
    bounds: [0, 20],
    read: (i) => i.sellingCostsPct,
    set: (i, v) => ({ ...i, sellingCostsPct: clamp(v, 0, 50) }),
  },
  {
    key: "loan_amount",
    label: "Loan Amount",
    unit: "$",
    read: (i) => i.loanAmount,
    set: (i, v) => ({ ...i, loanAmount: Math.max(0, v) }),
  },
  {
    key: "hold_years",
    label: "Hold Period",
    unit: "yr",
    bounds: [1, 15],
    read: (i) => i.holdYears,
    set: (i, v) => ({ ...i, holdYears: Math.max(1, Math.round(v)) }),
  },
  {
    key: "rent_level",
    label: "Rent Level (index)",
    unit: "index",
    bounds: [50, 150],
    read: () => 100,
    set: (i, pct) => ({
      ...i,
      revenueProgram: i.revenueProgram.map((r) => ({ ...r, rent: r.rent * (pct / 100) })),
      otherIncomeAnnual: i.otherIncomeAnnual * (pct / 100),
    }),
  },
  {
    key: "cost_level",
    label: "Cost Level (index)",
    unit: "index",
    bounds: [50, 150],
    read: () => 100,
    set: (i, pct) => ({ ...i, budget: scaleBudget(i, pct / 100) }),
  },
];

const VAR_BY_KEY: Record<string, SensitivityVar> = Object.fromEntries(
  SENSITIVITY_VARS.map((v) => [v.key, v]),
);

export type SensitivityMetric = {
  key: string;
  label: string;
  unit: "%" | "x" | "$";
  read: (o: EngineOutput) => number;
};

export const SENSITIVITY_METRICS: SensitivityMetric[] = [
  { key: "irr", label: "Levered IRR", unit: "%", read: (o) => o.values.irrPct },
  {
    key: "equity_multiple",
    label: "Equity Multiple",
    unit: "x",
    read: (o) => o.values.equityMultiple,
  },
  { key: "dscr", label: "DSCR", unit: "x", read: (o) => o.values.dscr },
  {
    key: "profit_on_cost",
    label: "Profit on Cost",
    unit: "%",
    read: (o) => o.values.profitOnCostPct,
  },
  { key: "yield_on_cost", label: "Yield on Cost", unit: "%", read: (o) => o.values.yieldOnCostPct },
  {
    key: "development_profit",
    label: "Development Profit",
    unit: "$",
    read: (o) => o.values.developmentProfit,
  },
  { key: "debt_yield", label: "Debt Yield", unit: "%", read: (o) => o.values.debtYieldPct },
  { key: "cash_on_cash", label: "Cash-on-Cash", unit: "%", read: (o) => o.values.cashOnCashPct },
];

const METRIC_BY_KEY: Record<string, SensitivityMetric> = Object.fromEntries(
  SENSITIVITY_METRICS.map((m) => [m.key, m]),
);

function getVar(key: string): SensitivityVar {
  const v = VAR_BY_KEY[key];
  if (!v) throw new Error(`Unknown sensitivity variable: ${key}`);
  return v;
}
function getMetric(key: string): SensitivityMetric {
  const m = METRIC_BY_KEY[key];
  if (!m) throw new Error(`Unknown sensitivity metric: ${key}`);
  return m;
}

// A single deterministic re-run: set the driver to `value`, run the engine, read
// the metric.
export function runPoint(
  input: UnderwritingInput,
  varKey: string,
  value: number,
  metricKey: string,
): number {
  const v = getVar(varKey);
  const m = getMetric(metricKey);
  return m.read(runUnderwriting(v.set(input, value)));
}

export type TornadoBar = {
  key: string;
  label: string;
  unit: SensitivityMetric["unit"];
  base: number; // base driver value
  low: number; // driver value at the low end
  high: number; // driver value at the high end
  lowValue: number; // metric at low
  highValue: number; // metric at high
  swing: number; // |highValue - lowValue|
};

// Flex each driver by +/- deltaPct of its base value and measure the metric swing,
// sorted widest-first. Each bar is two real engine re-runs.
export function tornado(
  input: UnderwritingInput,
  varKeys: string[],
  deltaPct: number,
  metricKey: string,
): TornadoBar[] {
  const m = getMetric(metricKey);
  const baseMetric = m.read(runUnderwriting(input));
  const f = deltaPct / 100;
  const bars = varKeys.map((k) => {
    const v = getVar(k);
    const base = v.read(input);
    const low = base * (1 - f);
    const high = base * (1 + f);
    const lowValue = m.read(runUnderwriting(v.set(input, low)));
    const highValue = m.read(runUnderwriting(v.set(input, high)));
    const lo = Number.isFinite(lowValue) ? lowValue : baseMetric;
    const hi = Number.isFinite(highValue) ? highValue : baseMetric;
    return {
      key: k,
      label: v.label,
      unit: m.unit,
      base,
      low,
      high,
      lowValue,
      highValue,
      swing: Math.abs(hi - lo),
    };
  });
  return bars.sort((a, b) => b.swing - a.swing);
}

export type BreakevenResult = { value: number; metricAtValue: number; iterations: number };

// Bisection for the driver value where the metric hits `target`. Returns null when
// the bounds do not bracket a root (no sign change) or the engine yields a
// non-finite metric, so a missing breakeven is never faked.
export function breakeven(
  input: UnderwritingInput,
  varKey: string,
  metricKey: string,
  target: number,
  bounds?: [number, number],
): BreakevenResult | null {
  const v = getVar(varKey);
  const m = getMetric(metricKey);
  const base = v.read(input);
  const [lo0, hi0] = bounds ?? v.bounds ?? [base * 0.5, base * 1.5];
  if (!(hi0 > lo0)) return null;
  const f = (x: number) => m.read(runUnderwriting(v.set(input, x))) - target;
  let flo = f(lo0);
  const fhi = f(hi0);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi)) return null;
  if (flo === 0) return { value: lo0, metricAtValue: target, iterations: 0 };
  if (fhi === 0) return { value: hi0, metricAtValue: target, iterations: 0 };
  if (flo * fhi > 0) return null; // no bracketed root
  let lo = lo0;
  let hi = hi0;
  for (let i = 1; i <= 60; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (!Number.isFinite(fm)) return null;
    if (Math.abs(fm) < 1e-7 || (hi - lo) / 2 < 1e-7)
      return { value: mid, metricAtValue: fm + target, iterations: i };
    if (flo * fm <= 0) {
      hi = mid;
    } else {
      lo = mid;
      flo = fm;
    }
  }
  const mid = (lo + hi) / 2;
  return { value: mid, metricAtValue: f(mid) + target, iterations: 60 };
}

export type Grid2D = {
  xVar: string;
  yVar: string;
  xs: number[];
  ys: number[];
  metricKey: string;
  unit: SensitivityMetric["unit"];
  cells: number[][]; // cells[y][x]
};

// A 2-variable scenario grid: cells[y][x] is the metric from a real re-run with the
// x-driver at xs[x] AND the y-driver at ys[y].
export function grid2d(
  input: UnderwritingInput,
  xVarKey: string,
  xs: number[],
  yVarKey: string,
  ys: number[],
  metricKey: string,
): Grid2D {
  const vx = getVar(xVarKey);
  const vy = getVar(yVarKey);
  const m = getMetric(metricKey);
  const cells = ys.map((y) => xs.map((x) => m.read(runUnderwriting(vy.set(vx.set(input, x), y)))));
  return { xVar: xVarKey, yVar: yVarKey, xs, ys, metricKey, unit: m.unit, cells };
}

// Evenly spaced inclusive range [from, to] with `steps` points (steps>=2).
export function linspace(from: number, to: number, steps: number): number[] {
  const n = Math.max(2, Math.round(steps));
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
}
