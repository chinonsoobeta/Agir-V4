import { describe, expect, test } from "vitest";
import {
  annualDebtService,
  applyStress,
  irr,
  loanBalanceAfterYears,
  mapleHeightsInput,
  runReconciliationChecks,
  runUnderwriting,
  STRESS_PRESETS,
} from "@/lib/engine";

const closeToDollars = (actual: number, expected: number) => expect(Math.round(actual)).toBe(expected);
const closeToPct = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 2);

describe("development underwriting engine", () => {
  test("Maple Heights golden fixture", () => {
    const output = runUnderwriting(mapleHeightsInput());
    closeToDollars(output.values.gpr, 3_528_000);
    closeToDollars(output.values.egi, 3_351_600);
    closeToDollars(output.values.opex, 1_173_060);
    closeToDollars(output.values.noi, 2_178_540);
    closeToDollars(output.values.tdc, 42_500_000);
    closeToPct(output.values.yieldOnCostPct, 5.13);
    expect(Math.round(output.values.developmentSpreadBps)).toBe(13);
    closeToDollars(output.values.exitValue, 43_570_800);
    closeToDollars(output.values.developmentProfit, 1_070_800);
    closeToDollars(output.values.costPerUnit, 354_167);
    closeToDollars(output.values.equity, 14_875_000);
    closeToPct(output.values.ltcPct, 65.0);
    expect(output.values.interestOnlyDscr).toBeCloseTo(1.31, 2);
    // Equity multiple includes the sale-year operating cash flow (a real
    // distribution), and the hold cash flow uses the debt service actually due.
    // interest-only for the full 1-year Maple hold (ioMonths = 12). Together
    // those fixes moved the prior 1.07 to 1.107.
    expect(output.values.equityMultiple).toBeCloseTo(1.107, 2);
    expect(output.equityWipeout).toBe(false);
    // Debt yield (NOI / loan) and break-even occupancy are now first-class
    // engine outputs. Break-even uses the in-force (interest-only) debt service.
    expect(output.values.debtYieldPct).toBeCloseTo((2_178_540 / 27_625_000) * 100, 4);
    const mapleYear1DebtService = 27_625_000 * 0.06; // interest-only: ioMonths=12 covers the 1-year hold
    expect(output.values.breakEvenOccupancyPct).toBeCloseTo(
      (mapleYear1DebtService / (1 - 0.35) / 3_528_000) * 100,
      4,
    );
    // Headline DSCR is amortizing whenever an amortization term exists; the
    // IO DSCR is secondary and always lower coverage than IO at same rate.
    const ads = annualDebtService(27_625_000, 6, 30);
    expect(output.values.annualDebtService).toBeCloseTo(ads, 6);
    expect(output.values.dscr).toBeCloseTo(2_178_540 / ads, 4);
    expect(output.values.dscr).toBeLessThan(output.values.interestOnlyDscr);
  });

  test("stress scenarios are deterministic engine re-runs that strictly degrade the deal", () => {
    const base = mapleHeightsInput();
    const baseOut = runUnderwriting(base);
    for (const preset of STRESS_PRESETS) {
      const out = runUnderwriting(applyStress(base, preset));
      // identical re-run is identical (determinism)
      const again = runUnderwriting(applyStress(base, preset));
      expect(again.values).toEqual(out.values);
      // every stressed metric is a real number from a real run
      expect(out.values.noi).not.toBe(0);
      expect(out.values.exitValue).not.toBe(0);
      expect(out.values.annualDebtService).toBeGreaterThan(0);
      expect(out.values.dscr).toBeGreaterThan(0);
      // stress never improves development profit
      expect(out.values.developmentProfit).toBeLessThanOrEqual(baseOut.values.developmentProfit + 1);
    }
    expect(STRESS_PRESETS.map((p) => p.key)).toEqual([
      "cap_expansion",
      "cost_overrun",
      "rate_shock",
      "revenue_down",
      "occupancy_down",
      "expense_inflation",
      "combined",
    ]);
  });

  test("amortizing debt service is positive and above interest only at the same rate", () => {
    expect(annualDebtService(1_000_000, 6, 30)).toBeGreaterThan(60_000);
  });

  test("loan balance schedule honors IO then amortizes", () => {
    // During IO the balance is flat
    expect(loanBalanceAfterYears(1_000_000, 6, 30, 12, 1)).toBe(1_000_000);
    // After IO it declines monotonically
    const y2 = loanBalanceAfterYears(1_000_000, 6, 30, 12, 2);
    const y3 = loanBalanceAfterYears(1_000_000, 6, 30, 12, 3);
    expect(y2).toBeLessThan(1_000_000);
    expect(y3).toBeLessThan(y2);
  });

  test("IRR returns NaN when cash flows have no sign change", () => {
    expect(Number.isNaN(irr([100, 50, 25]))).toBe(true);
    expect(Number.isNaN(irr([-100, -50, -25]))).toBe(true);
  });

  test("debt yield and break-even occupancy are computed and exposed", () => {
    const out = runUnderwriting(mapleHeightsInput());
    expect(out.values.debtYieldPct).toBeGreaterThan(0);
    expect(out.values.breakEvenOccupancyPct).toBeGreaterThan(0);
    expect(out.metrics.some((m) => m.key === "debt_yield")).toBe(true);
    expect(out.metrics.some((m) => m.key === "break_even_occupancy")).toBe(true);
  });

  test("hold cash flow uses the interest-only payment while the loan is IO for the whole hold", () => {
    // 3-year hold, interest-only for 36 months -> every hold year is IO.
    const io = runUnderwriting({ ...mapleHeightsInput(), holdYears: 3, ioMonths: 36 });
    const amortizing = annualDebtService(27_625_000, 6, 30);
    const ioPayment = 27_625_000 * 0.06;
    const ds = io.cashFlows.find((c) => c.periodYear === 1 && c.lineKey === "debt_service");
    // The ledger bills the interest-only payment actually due, not amortizing P&I.
    expect(Math.round(-(ds?.amount ?? 0))).toBe(Math.round(ioPayment));
    expect(ioPayment).toBeLessThan(amortizing);
    // ...and the headline DSCR metric stays on the (conservative) amortizing basis.
    expect(io.values.dscr).toBeCloseTo(io.values.noi / amortizing, 4);
  });

  test("returns are phased on the construction + lease-up timeline", () => {
    // Multi-year hold so interim operating flows exist and IRR is finite. Maple
    // pins budget.financingInterest, so changing the construction / lease-up
    // months moves ONLY the return timeline -- never the interest reserve, TDC,
    // or equity -- which isolates the phasing effect.
    const base = { ...mapleHeightsInput(), holdYears: 5 };
    const turnkey = runUnderwriting({ ...base, constructionMonths: 0, leaseUpMonths: 0 });
    const development = runUnderwriting({ ...base, constructionMonths: 24, leaseUpMonths: 12 });

    expect(turnkey.irrStatus).toBe("computed");
    expect(development.irrStatus).toBe("computed");

    // The delay changes WHEN cash is received, not the undiscounted amounts: the
    // cash-flow ledger and the (timing-free) equity multiple stay identical.
    expect(development.cashFlows).toEqual(turnkey.cashFlows);
    expect(development.values.equityMultiple).toBeCloseTo(turnkey.values.equityMultiple, 9);

    // A 3-year build/lease-up delay pushes every distribution later, so the
    // levered IRR must be strictly lower than the instant-turnkey case (but a
    // gain stays a gain: equity multiple > 1 keeps IRR positive).
    expect(development.values.irrPct).toBeLessThan(turnkey.values.irrPct);
    expect(development.values.irrPct).toBeGreaterThan(0);

    // The phasing is recorded in the IRR metric formula for auditability.
    const irrMetric = development.metrics.find((m) => m.key === "irr_estimate");
    expect(irrMetric?.formula).toContain("24 months construction");
  });

  test("absent IC-grade inputs preserve legacy outputs exactly", () => {
    const legacy = runUnderwriting(mapleHeightsInput());
    const explicitDefaults = runUnderwriting({
      ...mapleHeightsInput(),
      phaseEquityDraws: false,
      mezzanine: null,
      waterfall: null,
    });
    expect(explicitDefaults).toEqual(legacy);
  });

  test("mezzanine debt lowers required equity and weakens all-in coverage", () => {
    const base = runUnderwriting(mapleHeightsInput());
    const withMezz = runUnderwriting({
      ...mapleHeightsInput(),
      mezzanine: {
        amount: 3_000_000,
        interestRatePct: 12,
        amortYears: 0,
        ioMonths: 60,
      },
    });
    expect(withMezz.values.totalDebt).toBe(base.values.totalDebt + 3_000_000);
    expect(withMezz.values.requiredEquity).toBe(base.values.requiredEquity - 3_000_000);
    expect(withMezz.values.allInAnnualDebtService).toBeGreaterThan(
      base.values.allInAnnualDebtService,
    );
    expect(withMezz.values.seniorDscr).toBeCloseTo(base.values.seniorDscr, 8);
    expect(withMezz.values.allInDscr).toBeLessThan(withMezz.values.seniorDscr);
    expect(withMezz.values.loanPayoffAtExit).toBeGreaterThan(base.values.loanPayoffAtExit);
    for (const key of ["senior_annual_debt_service", "senior_dscr"]) {
      const metric = withMezz.metrics.find((row) => row.key === key);
      expect(metric?.formula.length).toBeGreaterThan(20);
    }
  });

  test("straight-line construction draws change timing without changing total equity", () => {
    const base = { ...mapleHeightsInput(), holdYears: 5, constructionMonths: 24 };
    const upfront = runUnderwriting(base);
    const phased = runUnderwriting({ ...base, phaseEquityDraws: true });
    const phasedEquity = phased.cashFlows
      .filter((row) => row.lineKey === "equity")
      .reduce((sum, row) => sum + row.amount, 0);
    expect(phasedEquity).toBeCloseTo(-phased.values.equity, 6);
    expect(phased.values.equityMultiple).toBeCloseTo(upfront.values.equityMultiple, 9);
    expect(phased.values.irrPct).toBeGreaterThan(upfront.values.irrPct);
    expect(phased.cashFlows.filter((row) => row.lineKey === "equity").length).toBe(2);
    expect(phased.metrics.find((row) => row.key === "irr_estimate")?.formula).toContain(
      "drawn straight-line monthly",
    );
  });

  test("waterfall outputs are first-class engine metrics with formula text", () => {
    const output = runUnderwriting({
      ...mapleHeightsInput(),
      holdYears: 5,
      waterfall: {
        lpEquityPct: 90,
        preferredReturnPct: 8,
        gpCatchUp: true,
        promoteTiers: [{ hurdleRatePct: 8, gpSplitPct: 20 }],
      },
    });
    for (const key of [
      "lp_irr",
      "lp_equity_multiple",
      "gp_irr",
      "gp_equity_multiple",
      "gp_promote",
    ]) {
      const metric = output.metrics.find((row) => row.key === key);
      expect(metric).toBeDefined();
      expect(metric?.formula.length).toBeGreaterThan(20);
    }
    expect(Number.isFinite(output.values.lpIrrPct)).toBe(true);
    expect(Number.isFinite(output.values.gpIrrPct)).toBe(true);
    expect(output.values.gpPromote).toBeGreaterThanOrEqual(0);
  });
});

describe("reconciliation gates", () => {
  const ctxBase = {
    tdc: 91_500_000,
    equity: 29_000_000,
    loan: 62_500_000,
    noi: 5_195_203,
    amortizingAnnualDebtService: 4_617_879,
  };

  test("unit-count consistency compares the building total, not each unit type", () => {
    // 120 + 80 + 20 = 220 building total, matching the stated 220: no flag.
    const ok = runReconciliationChecks({ ...ctxBase, unitCounts: [220, 220] });
    expect(ok.some((f) => f.check_key === "unit_count_consistency")).toBe(false);
    // A genuine disagreement (rent roll 218 vs stated 220) still flags.
    const bad = runReconciliationChecks({ ...ctxBase, unitCounts: [218, 220] });
    expect(bad.some((f) => f.check_key === "unit_count_consistency" && f.severity === "error")).toBe(true);
  });

  test("covenant feasibility uses the interest-only payment when the loan is IO for the whole hold", () => {
    const base = { ...ctxBase, minDscr: 1.2, interestOnlyAnnualDebtService: 3_906_250 };
    // Amortizing basis: 1.2 × 4,617,879 = 5,541,455 > NOI → would false-fail.
    const amortizing = runReconciliationChecks({ ...base, ioCoversHold: false });
    expect(amortizing.some((f) => f.check_key === "covenant_feasibility")).toBe(true);
    // IO-for-the-hold basis: 1.2 × 3,906,250 = 4,687,500 < NOI → passes.
    const io = runReconciliationChecks({ ...base, ioCoversHold: true });
    expect(io.some((f) => f.check_key === "covenant_feasibility")).toBe(false);
  });

  test("debt-yield covenant flags a deal whose debt yield is below the minimum", () => {
    const pass = runReconciliationChecks({ ...ctxBase, minDebtYield: 8, debtYieldPct: 9 });
    expect(pass.some((f) => f.check_key === "debt_yield_covenant")).toBe(false);
    const fail = runReconciliationChecks({ ...ctxBase, minDebtYield: 9, debtYieldPct: 8 });
    expect(fail.some((f) => f.check_key === "debt_yield_covenant" && f.severity === "error")).toBe(true);
  });
});
