// Monthly cash-flow spine (Workstream 1). Every assertion is either a
// hand-computed number, a backward-compatibility guarantee (a deal that does not
// opt in is byte-identical to today), a roll-up reconciliation, or a provenance
// guarantee on the new outputs.

import { describe, expect, test } from "vitest";
import {
  annualDebtService,
  buildAllowedValues,
  collectLiterals,
  cumulativeDrawFraction,
  mapleHeightsInput,
  parseExpression,
  runUnderwriting,
  smoothstep,
  verifyNumericProvenance,
  type UnderwritingInput,
} from "@/lib/engine";

// A comfortably profitable ground-up deal with a real construction + lease-up
// timeline, so the spine's phases are all exercised.
function devDeal(overrides: Partial<UnderwritingInput> = {}): UnderwritingInput {
  return {
    budget: { land: 5_000_000, hard: 20_000_000, soft: 3_000_000, contingency: 0 },
    revenueProgram: [{ unitType: "Residential", unitCount: 100, rent: 3_000, rentBasis: "per_unit" }],
    constructionMonths: 12,
    leaseUpMonths: 12,
    stabilizedOccupancyPct: 95,
    expenseRatioPct: 35,
    otherIncomeAnnual: 0,
    exitCapRatePct: 5,
    loanAmount: 18_000_000,
    interestRatePct: 6,
    amortYears: 30,
    ioMonths: 24,
    avgOutstandingFactor: 0.5,
    sellingCostsPct: 2,
    holdYears: 5,
    equityAmount: 10_000_000,
    rentGrowthPct: 3,
    expenseGrowthPct: 2,
    ...overrides,
  };
}

describe("WS1 (a): backward compatibility -- a deal that does not opt in is byte-identical", () => {
  test("off-path has no schedule and the flag off equals the flag unset", () => {
    const unset = runUnderwriting(devDeal());
    expect(unset.schedule).toBeUndefined();
    expect(unset.values.scheduleLeveredIrrPct).toBeUndefined();
    const flagOff = runUnderwriting(devDeal({ monthlyModel: false }));
    expect(flagOff).toStrictEqual(unset);
  });

  test("the golden Maple Heights fixture is byte-identical with the flag off", () => {
    const base = runUnderwriting(mapleHeightsInput());
    const withFlagOff = runUnderwriting({ ...mapleHeightsInput(), monthlyModel: false });
    expect(withFlagOff).toStrictEqual(base);
    expect(base.schedule).toBeUndefined();
  });

  test("monthly mode attaches a schedule and preserves every base metric", () => {
    const off = runUnderwriting(devDeal());
    const on = runUnderwriting(devDeal({ monthlyModel: true }));
    expect(on.schedule).toBeDefined();
    for (const m of off.metrics) {
      expect(on.metrics.some((x) => x.key === m.key)).toBe(true);
    }
  });
});

describe("WS1 (b): the monthly roll-up reconciles to the annual figures", () => {
  test("with every feature off, the annual figures and IRR are unchanged and the roll-up ties out", () => {
    const off = runUnderwriting(devDeal());
    const on = runUnderwriting(devDeal({ monthlyModel: true }));
    expect(on.values.noi).toBeCloseTo(off.values.noi, 6);
    expect(on.values.egi).toBeCloseTo(off.values.egi, 6);
    expect(on.values.opex).toBeCloseTo(off.values.opex, 6);
    expect(on.values.equity).toBeCloseTo(off.values.equity, 6);
    expect(on.values.tdc).toBeCloseTo(off.values.tdc, 6);
    // No feature engaged => the monthly IRR equals the annual deal IRR exactly.
    expect(on.values.scheduleLeveredIrrPct).toBeCloseTo(off.values.irrPct, 6);
    // Every reconciliation row ties out within tolerance.
    expect(on.schedule!.reconciliation.length).toBeGreaterThan(0);
    for (const r of on.schedule!.reconciliation) {
      expect(r.withinTolerance).toBe(true);
    }
  });
});

describe("WS1 (c): hand-computed precision checks", () => {
  test("the draw curve is the standard smoothstep S-curve", () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 12);
    expect(smoothstep(0.25)).toBeCloseTo(0.15625, 12); // 3(.0625) - 2(.015625)
    expect(cumulativeDrawFraction(0.5, "straight_line")).toBe(0.5);
    expect(cumulativeDrawFraction(0.3, "s_curve")).toBeCloseTo(smoothstep(0.3), 12);
  });

  test("1A: construction interest is computed on the actual monthly outstanding balance", () => {
    // 6,000,000 senior @ 6%, 10-month build + 2-month lease-up, no mezz. The
    // symmetric S-curve averages 0.5 of the balance over the 10 build months (= 5
    // month-equivalents); both lease-up months carry the full balance (= 2).
    // Interest = 6,000,000 * (0.06 / 12) * (5 + 2) = 210,000.
    const out = runUnderwriting(
      devDeal({
        budget: { land: 0, hard: 10_000_000, soft: 0, contingency: 0 },
        loanAmount: 6_000_000,
        interestRatePct: 6,
        constructionMonths: 10,
        leaseUpMonths: 2,
        ioMonths: 24,
        equityAmount: 4_500_000,
        monthlyModel: true,
        constructionDrawCurve: "s_curve",
      }),
    );
    expect(out.values.scheduleConstructionInterest).toBeCloseTo(210_000, 0);
    expect(out.metrics.some((m) => m.key === "schedule_construction_interest")).toBe(true);
  });

  test("1A off: the spine mirrors the annual interest reserve exactly and emits no extra metric", () => {
    const on = runUnderwriting(devDeal({ monthlyModel: true })); // straight-line draws
    expect(on.values.scheduleConstructionInterest).toBeCloseTo(on.values.interestReserve, 6);
    expect(on.metrics.some((m) => m.key === "schedule_construction_interest")).toBe(false);
  });

  test("1B: lease-up NOI ramps linearly and raises the monthly IRR above the full-delay model", () => {
    const fullDelay = runUnderwriting(devDeal({ monthlyModel: true })); // 1B off
    const absorbed = runUnderwriting(devDeal({ monthlyModel: true, leaseUpCurve: true }));
    expect(absorbed.values.scheduleLeveredIrrPct!).toBeGreaterThan(fullDelay.values.scheduleLeveredIrrPct!);

    // A specific lease-up NOI node equals (k + 0.5)/L of stabilized monthly NOI.
    const C = 12;
    const L = 12;
    const k = 5; // 6th lease-up month
    const node = absorbed.schedule!.nodes.find((n) => n.period === C + k && n.lineKey === "noi");
    expect(node).toBeDefined();
    expect(node!.amount).toBeCloseTo((absorbed.values.noi / 12) * ((k + 0.5) / L), 4);
  });

  test("1C: refinance retires the senior balance, resizes the debt, and flows cash-out to equity", () => {
    const out = runUnderwriting(
      devDeal({
        constructionMonths: 0,
        leaseUpMonths: 0,
        ioMonths: 120, // interest-only across the hold so the balance retired is the full loan
        holdYears: 7,
        loanAmount: 18_000_000,
        monthlyModel: true,
        refinance: { month: 24, newAmount: 22_000_000, ratePct: 5, amortYears: 30, ioMonths: 0 },
      }),
    );
    expect(out.values.refiNewLoanAmount).toBe(22_000_000);
    expect(out.values.refiCashOut).toBeCloseTo(22_000_000 - 18_000_000, 6); // 4,000,000
    const expectedDs = annualDebtService(22_000_000, 5, 30);
    expect(out.values.refiNewAnnualDebtService).toBeCloseTo(expectedDs, 6);
    expect(out.values.postRefiDscr).toBeCloseTo(out.values.noi / expectedDs, 6);

    const refiNodes = out.schedule!.nodes.filter((n) => n.period === 24 && n.lineKey.startsWith("refi"));
    expect(refiNodes.length).toBe(3); // proceeds, payoff, cash-out
    expect(out.metrics.some((m) => m.key === "refi_cash_out")).toBe(true);
  });
});

describe("WS1 (c): sandboxed custom line items", () => {
  test("a custom line evaluates deterministically, renders a clean formula, and emits nodes", () => {
    const out = runUnderwriting(
      devDeal({
        monthlyModel: true,
        customLines: [{ key: "mgmt_reserve", label: "Management reserve", expression: "noi * 0.03" }],
      }),
    );
    const metric = out.metrics.find((m) => m.key === "custom_mgmt_reserve");
    expect(metric).toBeDefined();
    expect(metric!.value).toBeGreaterThan(0);

    // The rendered formula is provenance-clean: the literal coefficient and the
    // total are the only numeric tokens, and both are admitted.
    const allowed = buildAllowedValues(collectLiterals(parseExpression("noi * 0.03")), [metric!.value]);
    expect(verifyNumericProvenance(metric!.formula, allowed).pass).toBe(true);
    expect(out.schedule!.nodes.some((n) => n.key === "custom_mgmt_reserve")).toBe(true);
  });

  test("an unsafe or unknown-reference custom line fails closed with a warning and no value", () => {
    const out = runUnderwriting(
      devDeal({
        monthlyModel: true,
        customLines: [{ key: "bad", label: "Bad line", expression: "ghost * 2" }],
      }),
    );
    expect(out.metrics.some((m) => m.key === "custom_bad")).toBe(false);
    expect(out.warnings.some((w) => w.key.includes("custom"))).toBe(true);
  });
});

describe("WS1 (d): provenance -- every new metric formula is orphan-free", () => {
  test("schedule and refinance metrics trace to inputs, engine values, or their own value", () => {
    const out = runUnderwriting(
      devDeal({
        monthlyModel: true,
        constructionDrawCurve: "s_curve",
        leaseUpCurve: true,
        refinance: { month: 30, newAmount: 20_000_000, ratePct: 5, amortYears: 30, ioMonths: 0 },
      }),
    );
    const allowed = buildAllowedValues(
      Object.values(out.values).filter((v): v is number => typeof v === "number" && Number.isFinite(v)),
      out.metrics.map((m) => m.value),
      out.cashFlows.map((c) => c.amount),
    );
    const newMetrics = out.metrics.filter(
      (m) => m.key.startsWith("schedule_") || m.key.startsWith("refi_") || m.key === "post_refi_dscr",
    );
    expect(newMetrics.length).toBeGreaterThan(0);
    for (const m of newMetrics) {
      const report = verifyNumericProvenance(`${m.label}: ${m.formula}`, allowed);
      expect(report.orphans).toEqual([]);
    }
  });
});
