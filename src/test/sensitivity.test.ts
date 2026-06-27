import { describe, test, expect } from "vitest";
import { runUnderwriting, mapleHeightsInput } from "@/lib/engine";
import {
  SENSITIVITY_VARS,
  SENSITIVITY_METRICS,
  runPoint,
  tornado,
  breakeven,
  grid2d,
  linspace,
} from "@/lib/engine/sensitivity";

const base = mapleHeightsInput();
const varSet = (key: string) => SENSITIVITY_VARS.find((v) => v.key === key)!;

describe("WS3 3B sensitivity registries", () => {
  test("every metric reads a finite number from the base run", () => {
    const out = runUnderwriting(base);
    for (const m of SENSITIVITY_METRICS) expect(Number.isFinite(m.read(out))).toBe(true);
  });
});

describe("WS3 3B tornado", () => {
  test("bars are real re-runs, sorted by swing, and an irrelevant driver has no swing", () => {
    const keys = ["exit_cap_rate", "cost_level", "rent_level", "interest_rate"];
    const bars = tornado(base, keys, 10, "profit_on_cost");
    // Sorted widest-first.
    for (let i = 1; i < bars.length; i++)
      expect(bars[i - 1].swing).toBeGreaterThanOrEqual(bars[i].swing);
    // Interest rate does not enter development profit / profit-on-cost, so ~0 swing,
    // and it must sort last.
    const rate = bars.find((b) => b.key === "interest_rate")!;
    expect(rate.swing).toBeLessThan(1e-6);
    expect(bars[bars.length - 1].key).toBe("interest_rate");
    // A bar endpoint equals a direct engine re-run at that driver value.
    const cost = bars.find((b) => b.key === "cost_level")!;
    expect(cost.lowValue).toBeCloseTo(runPoint(base, "cost_level", 90, "profit_on_cost"), 9);
    expect(cost.highValue).toBeCloseTo(runPoint(base, "cost_level", 110, "profit_on_cost"), 9);
  });
});

describe("WS3 3B breakeven", () => {
  test("development-profit breakeven on exit cap equals the going-in yield on cost", () => {
    const out = runUnderwriting(base);
    const r = breakeven(base, "exit_cap_rate", "development_profit", 0, [1, 15]);
    expect(r).not.toBeNull();
    // profit = NOI/(cap) - TDC = 0  <=>  cap = NOI/TDC = yield on cost.
    expect(r!.value).toBeCloseTo(out.values.yieldOnCostPct, 2);
    expect(Math.abs(r!.metricAtValue)).toBeLessThan(1); // ~$0 profit at the root
  });

  test("an unreachable target returns null (no faked breakeven)", () => {
    expect(breakeven(base, "exit_cap_rate", "development_profit", 1e12, [1, 15])).toBeNull();
  });
});

describe("WS3 3B two-variable grid", () => {
  test("every cell is a real engine re-run and the grid is monotonic", () => {
    const xs = [4, 5, 6]; // exit cap
    const ys = [90, 100, 110]; // cost level
    const g = grid2d(base, "exit_cap_rate", xs, "cost_level", ys, "development_profit");
    expect(g.cells.length).toBe(3);
    expect(g.cells[0].length).toBe(3);
    // cells[y][x] equals a direct re-run with BOTH drivers set.
    const vx = varSet("exit_cap_rate");
    const vy = varSet("cost_level");
    const expected = runUnderwriting(vy.set(vx.set(base, 6), 110)).values.developmentProfit;
    expect(g.cells[2][2]).toBeCloseTo(expected, 6);
    // Higher exit cap -> lower profit (along a row); higher cost -> lower profit (down a column).
    expect(g.cells[0][0]).toBeGreaterThan(g.cells[0][2]);
    expect(g.cells[0][0]).toBeGreaterThan(g.cells[2][0]);
  });

  test("linspace is inclusive and evenly spaced", () => {
    expect(linspace(4, 6, 3)).toEqual([4, 5, 6]);
    expect(linspace(0, 1, 5)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
});

describe("WS3 3B provenance: sensitivity numbers trace to engine outputs", () => {
  test("tornado endpoints are admissible engine values (no orphan number)", () => {
    // Each endpoint is itself an engine output value, so the no-orphan invariant
    // holds by construction: a tornado endpoint equals runPoint(...) exactly.
    const bars = tornado(base, ["exit_cap_rate", "rent_level"], 10, "irr");
    for (const b of bars) {
      if (Number.isFinite(b.lowValue)) expect(b.lowValue).toBe(runPoint(base, b.key, b.low, "irr"));
      if (Number.isFinite(b.highValue))
        expect(b.highValue).toBe(runPoint(base, b.key, b.high, "irr"));
    }
  });
});
