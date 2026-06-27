// IC-grade financial modeling (Workstream 1): equity draw timing, multi-tranche
// debt, and the LP/GP distribution waterfall. Every assertion is either a
// hand-computed number or a backward-compatibility guarantee that a deal with
// none of the new inputs reproduces today's engine output exactly.

import { describe, expect, test } from "vitest";
import {
  applyStress,
  buildAllowedValues,
  buildEquityContributions,
  isWaterfallActive,
  leaseUpAbsorptionIncome,
  mapleHeightsInput,
  runUnderwriting,
  runWaterfall,
  STRESS_PRESETS,
  verifyNumericProvenance,
  xirr,
  type UnderwritingInput,
  type WaterfallConfig,
} from "@/lib/engine";
import { buildMemoReport, memoReportText } from "@/lib/memo-report";
import { computeInvestmentVerdict } from "@/lib/verdict";
import { ASSUMPTION_BY_KEY } from "@/lib/assumption-taxonomy";

const NEUTRAL_WF: WaterfallConfig = {
  lpEquityPct: 100,
  gpEquityPct: 0,
  preferredReturnPct: 0,
  gpCatchUpPct: 0,
  tiers: [],
};

// A turnkey, comfortably profitable deal: no construction delay, no financing
// reserve, so its returns are easy to reason about for waterfall + timing tests.
function profitableInput(overrides: Partial<UnderwritingInput> = {}): UnderwritingInput {
  return {
    budget: { land: 10_000_000, hard: 0, soft: 0, contingency: 0, financingInterest: 0 },
    revenueProgram: [
      { unitType: "Residential", unitCount: 100, rent: 2_000, rentBasis: "per_unit" },
    ],
    constructionMonths: 0,
    leaseUpMonths: 0,
    stabilizedOccupancyPct: 100,
    expenseRatioPct: 0,
    otherIncomeAnnual: 0,
    exitCapRatePct: 5,
    loanAmount: 5_000_000,
    interestRatePct: 5,
    amortYears: 30,
    ioMonths: 0,
    avgOutstandingFactor: 0,
    sellingCostsPct: 0,
    holdYears: 5,
    equityAmount: 5_000_000,
    rentGrowthPct: 0,
    expenseGrowthPct: 0,
    ...overrides,
  };
}

describe("WS1 backward compatibility: no new inputs reproduce today's output", () => {
  test("a neutral waterfall / no mezz / upfront draw is byte-identical to the base run", () => {
    const base = runUnderwriting(mapleHeightsInput());
    const neutral = runUnderwriting({
      ...mapleHeightsInput(),
      equityDrawMonths: 0,
      mezzanine: null,
      waterfall: NEUTRAL_WF,
    });
    expect(neutral.values).toEqual(base.values);
    expect(neutral.cashFlows).toEqual(base.cashFlows);
  });

  test("LP figures mirror the deal and GP promote is zero when no promote is set", () => {
    const v = runUnderwriting(mapleHeightsInput()).values;
    // Senior-only stack equals today's single-loan figures.
    expect(v.totalDebt).toBe(mapleHeightsInput().loanAmount);
    expect(v.seniorDscr).toBe(v.dscr);
    expect(v.allInDscr).toBe(v.dscr);
    expect(v.totalDebtService).toBeCloseTo(v.seniorDebtService, 9);
    expect(v.mezzDebtService).toBe(0);
    // LP holds the whole deal; GP earns nothing.
    expect(v.lpIrrPct).toBe(v.irrPct);
    expect(v.lpEquityMultiple).toBe(v.equityMultiple);
    expect(v.gpPromote).toBe(0);
    expect(v.lpPreferredReturn).toBe(0);
    expect(Number.isNaN(v.gpIrrPct)).toBe(true);
    expect(v.gpEquityMultiple).toBe(0);
  });
});

describe("WS1.1A equity draw timing", () => {
  test("upfront draw is the conservative default and a straight-line draw raises IRR", () => {
    const base = profitableInput({ constructionMonths: 24, leaseUpMonths: 12, holdYears: 5 });
    const upfront = runUnderwriting(base);
    const drawn = runUnderwriting({ ...base, equityDrawMonths: 24 });

    // Deferring part of the equity outflow over the build raises the levered IRR.
    expect(drawn.values.irrPct).toBeGreaterThan(upfront.values.irrPct);
    // The equity multiple is a money multiple and stays timing-free.
    expect(drawn.values.equityMultiple).toBeCloseTo(upfront.values.equityMultiple, 9);
    // The cash-flow ledger is unchanged: only the IRR timing moves.
    expect(drawn.cashFlows).toEqual(upfront.cashFlows);
  });

  test("buildEquityContributions: lump sum by default, straight-line when requested", () => {
    expect(buildEquityContributions(1_000_000, 0)).toEqual([{ t: 0, amount: -1_000_000 }]);
    const drawn = buildEquityContributions(1_200_000, 12);
    expect(drawn).toHaveLength(12);
    expect(drawn[0]).toEqual({ t: 0, amount: -100_000 });
    expect(drawn.reduce((s, c) => s + c.amount, 0)).toBeCloseTo(-1_200_000, 6);
  });
});

describe("WS1.1B multi-tranche debt (mezzanine)", () => {
  test("a mezzanine tranche raises total debt service and lowers required equity", () => {
    // Implied-equity deal (equityAmount null) so adding mezz visibly lowers equity.
    const senior = profitableInput({ equityAmount: null });
    const withMezz = runUnderwriting({
      ...senior,
      mezzanine: { amount: 2_000_000, ratePct: 12, amortYears: 0, ioMonths: 60 },
    });
    const base = runUnderwriting(senior);

    expect(withMezz.values.totalDebt).toBe(base.values.totalDebt + 2_000_000);
    // All-in debt service rises by the mezzanine's interest-only payment.
    expect(withMezz.values.totalDebtService).toBeGreaterThan(base.values.totalDebtService);
    expect(withMezz.values.mezzDebtService).toBeCloseTo(2_000_000 * 0.12, 6);
    // The senior coverage reference is unchanged; all-in DSCR is lower.
    expect(withMezz.values.seniorDscr).toBeCloseTo(base.values.seniorDscr, 9);
    expect(withMezz.values.allInDscr).toBeLessThan(withMezz.values.seniorDscr);
    // More debt funds the project, so required equity falls by the mezz amount.
    expect(withMezz.values.requiredEquity).toBeCloseTo(base.values.requiredEquity - 2_000_000, 6);
  });
});

describe("WS1.1C LP/GP waterfall and promote (hand-computed)", () => {
  test("8% preferred return then an 80/20 promote splits a known vector correctly", () => {
    const events = [
      { t: 0, amount: -1_000_000 },
      { t: 5, amount: 2_000_000 },
    ];
    const cfg: WaterfallConfig = {
      lpEquityPct: 100,
      gpEquityPct: 0,
      preferredReturnPct: 8,
      gpCatchUpPct: 0,
      tiers: [{ hurdlePct: null, gpPct: 20 }],
    };
    expect(isWaterfallActive(cfg)).toBe(true);
    const wf = runWaterfall(events, cfg);

    // Hand math: LP preferred return = 1,000,000 x 1.08^5 = 1,469,328.08.
    const pref = 1_000_000 * Math.pow(1.08, 5);
    const residual = 2_000_000 - pref;
    const lpExpected = pref + 0.8 * residual;
    const gpExpected = 0.2 * residual;

    expect(wf.lp.distributed).toBeCloseTo(lpExpected, 4);
    expect(wf.gp.distributed).toBeCloseTo(gpExpected, 4);
    // GP has no capital, so all of its take is promote (carried interest).
    expect(wf.gpPromote).toBeCloseTo(gpExpected, 4);
    expect(wf.lpPreferredPaid).toBeCloseTo(pref - 1_000_000, 4);

    // LP IRR from its own cash flows, hand-computed.
    const lpIrrExpected = (Math.pow(lpExpected / 1_000_000, 1 / 5) - 1) * 100;
    expect(xirr(wf.lp.flows)).toBeCloseTo(lpIrrExpected, 4);
    // GP contributed nothing: its IRR is not meaningful (no sign change).
    expect(Number.isNaN(xirr(wf.gp.flows))).toBe(true);
  });

  test("ordering holds: GP IRR > deal IRR > LP IRR with GP co-invest and a promote", () => {
    // pari-passu return of capital (pref 0), then an 80/20 carry. LP 90% / GP 10%.
    const events = [
      { t: 0, amount: -1_000_000 },
      { t: 5, amount: 2_000_000 },
    ];
    const cfg: WaterfallConfig = {
      lpEquityPct: 90,
      gpEquityPct: 10,
      preferredReturnPct: 0,
      gpCatchUpPct: 0,
      tiers: [{ hurdlePct: null, gpPct: 20 }],
    };
    const wf = runWaterfall(events, cfg);

    // Hand math: return of capital 1,000,000 split 900k/100k; residual 1,000,000
    // split 80/20 -> LP +800k, GP +200k. LP total 1,700,000, GP total 300,000.
    expect(wf.lp.distributed).toBeCloseTo(1_700_000, 4);
    expect(wf.gp.distributed).toBeCloseTo(300_000, 4);
    expect(wf.gpPromote).toBeCloseTo(100_000, 4); // 300,000 - 10% x 2,000,000

    const lpIrr = xirr(wf.lp.flows);
    const gpIrr = xirr(wf.gp.flows);
    const dealIrr = xirr(events);
    expect(lpIrr).toBeCloseTo((Math.pow(1_700_000 / 900_000, 1 / 5) - 1) * 100, 4);
    expect(gpIrr).toBeCloseTo((Math.pow(300_000 / 100_000, 1 / 5) - 1) * 100, 4);
    // The promote rewards the GP above its pro-rata share and dilutes the LP.
    expect(gpIrr).toBeGreaterThan(dealIrr);
    expect(dealIrr).toBeGreaterThan(lpIrr);
  });

  test("GP catch-up gives the GP 100% until it reaches its carry share of the pref", () => {
    // 8% pref, full (100%) catch-up, then 80/20. Single contribution + sale.
    const events = [
      { t: 0, amount: -1_000_000 },
      { t: 5, amount: 3_000_000 },
    ];
    const cfg: WaterfallConfig = {
      lpEquityPct: 100,
      gpEquityPct: 0,
      preferredReturnPct: 8,
      gpCatchUpPct: 100,
      tiers: [{ hurdlePct: null, gpPct: 20 }],
    };
    const wf = runWaterfall(events, cfg);

    const pref = 1_000_000 * Math.pow(1.08, 5); // LP capital + preferred
    const lpPref = pref - 1_000_000;
    // Full catch-up: GP receives 25% of the LP preferred (20/80 x pref) at 100%.
    const catchUp = (0.2 / 0.8) * lpPref;
    const residual = 3_000_000 - pref - catchUp;
    const gpExpected = catchUp + 0.2 * residual;
    const lpExpected = pref + 0.8 * residual;

    expect(wf.lp.distributed + wf.gp.distributed).toBeCloseTo(3_000_000, 3);
    expect(wf.gp.distributed).toBeCloseTo(gpExpected, 3);
    expect(wf.lp.distributed).toBeCloseTo(lpExpected, 3);
    // After a full catch-up the GP's share of total profit equals its 20% carry.
    const profit = 3_000_000 - 1_000_000;
    expect(wf.gp.distributed / profit).toBeCloseTo(0.2, 3);
  });

  test("LP/GP figures render and pass numeric provenance in the IC memo report", () => {
    // A profitable deal with a real promote so the LP / GP Returns section renders.
    const input = profitableInput({
      expenseRatioPct: 30,
      waterfall: {
        lpEquityPct: 90,
        gpEquityPct: 10,
        preferredReturnPct: 8,
        gpCatchUpPct: 0,
        tiers: [{ hurdlePct: null, gpPct: 20 }],
      },
    });
    const base = runUnderwriting(input);
    const combined = runUnderwriting(applyStress(input, STRESS_PRESETS[6]));
    const toRows = (scenario: string, out: ReturnType<typeof runUnderwriting>) =>
      out.metrics.map((m) => ({
        scenario_key: scenario,
        metric_key: m.key,
        metric_label: m.label,
        value_numeric: m.value,
        unit: m.unit,
        formula_text: m.formula,
      }));
    const outputs = [...toRows("base", base), ...toRows("combined", combined)];

    const A = (key: string, value: number) => {
      const def = ASSUMPTION_BY_KEY[key];
      return {
        field_key: key,
        value_numeric: value,
        field_label: def.label,
        unit: def.unit,
        status: "approved",
        source_location: "Demo",
      };
    };
    const assumptions = [
      A("land_cost", 10_000_000),
      A("debt_amount", 5_000_000),
      A("equity_amount", 5_000_000),
      A("residential_units", 100),
      A("residential_rent_monthly", 2_000),
      A("residential_occupancy", 100),
      A("interest_rate", 5),
      A("amortization_years", 30),
      A("exit_cap_rate", 5),
      A("opex_ratio", 30),
      A("lp_equity_pct", 90),
      A("gp_equity_pct", 10),
      A("preferred_return_pct", 8),
      A("promote_tier1_gp_pct", 20),
    ];
    const verdict = computeInvestmentVerdict({
      equity_multiple: base.values.equityMultiple,
      profit_margin: base.values.profitOnCostPct,
      development_spread: base.values.developmentSpreadBps,
      stress_dscr: combined.values.dscr,
      stress_equity_multiple: combined.values.equityMultiple,
      error_flag_count: 0,
    });
    const report = buildMemoReport({
      project: {
        name: "Promote Demo",
        location: "Test City",
        type: "multifamily",
        status: "underwriting",
      },
      assumptions,
      engineInputs: [],
      outputs,
      flags: [],
      risks: [],
      documents: [],
      verdict,
      generationMode: "deterministic",
      generatedLabel: "June 2026",
    });

    // The LP / GP Returns section is present (the promote is active).
    expect(report.sections.some((s) => s.heading === "LP / GP Returns")).toBe(true);

    // Allowed set mirrors generateMemo: assumptions + engine inputs + outputs +
    // cash flows + verdict thresholds + the report's own derived values.
    const cashFlows = base.cashFlows.map((c) => ({ amount: c.amount }));
    const allowed = [
      ...buildAllowedValues(
        assumptions.map((a) => Number(a.value_numeric)),
        outputs.map((o) => (o.value_numeric == null ? null : Number(o.value_numeric))),
        cashFlows.map((c) => Number(c.amount)),
        [1.5, 15, 100, 1.2, 1.0],
        report.derived_values,
      ),
      ...cashFlows.map((c) => ({ value: Number(c.amount), unit: "$" as const })),
    ];
    const prov = verifyNumericProvenance(memoReportText(report), allowed);
    expect(prov.orphans, JSON.stringify(prov.orphans)).toEqual([]);
    expect(prov.pass).toBe(true);
  });

  test("the engine wires the waterfall: promote triggers and returns order correctly", () => {
    const base = runUnderwriting(profitableInput());
    const withWaterfall = runUnderwriting(
      profitableInput({
        waterfall: {
          lpEquityPct: 90,
          gpEquityPct: 10,
          preferredReturnPct: 8,
          gpCatchUpPct: 0,
          tiers: [{ hurdlePct: null, gpPct: 20 }],
        },
      }),
    );
    // The deal-level IRR is unchanged by the split.
    expect(withWaterfall.values.irrPct).toBeCloseTo(base.values.irrPct, 9);
    // A promote is earned and the LP/GP ordering holds around the deal return.
    expect(withWaterfall.values.gpPromote).toBeGreaterThan(0);
    expect(withWaterfall.values.lpIrrPct).toBeLessThan(withWaterfall.values.irrPct);
    expect(withWaterfall.values.gpIrrPct).toBeGreaterThan(withWaterfall.values.irrPct);
  });
});

describe("WS1.1D lease-up absorption curve", () => {
  test("off by default: the lease-up adjusted IRR equals the deal IRR and adds no metric", () => {
    const out = runUnderwriting(
      profitableInput({ constructionMonths: 12, leaseUpMonths: 12, holdYears: 5 }),
    );
    expect(out.values.leaseUpAdjustedIrrPct).toBe(out.values.irrPct);
    expect(out.metrics.some((m) => m.key === "lease_up_adjusted_irr")).toBe(false);
  });

  test("on: crediting partial lease-up income raises IRR, emits the metric, and leaves the deal outputs unchanged", () => {
    const base = profitableInput({ constructionMonths: 12, leaseUpMonths: 12, holdYears: 5 });
    const off = runUnderwriting(base);
    const on = runUnderwriting({ ...base, leaseUpCurve: true });
    expect(on.values.leaseUpAdjustedIrrPct).toBeGreaterThan(off.values.irrPct);
    expect(on.metrics.some((m) => m.key === "lease_up_adjusted_irr")).toBe(true);
    // The opt-in figure never disturbs the conservative deal-level outputs.
    expect(on.values.irrPct).toBeCloseTo(off.values.irrPct, 9);
    expect(on.values.equityMultiple).toBeCloseTo(off.values.equityMultiple, 9);
    expect(on.cashFlows).toEqual(off.cashFlows);
  });

  test("leaseUpAbsorptionIncome: a linear ramp is half the stabilized cash flow over the window", () => {
    expect(leaseUpAbsorptionIncome(1_000_000, 12)).toBeCloseTo(500_000, 6); // 1.0 yr x 0.5
    expect(leaseUpAbsorptionIncome(1_000_000, 6)).toBeCloseTo(250_000, 6); // 0.5 yr x 0.5
    expect(leaseUpAbsorptionIncome(1_000_000, 0)).toBe(0);
    expect(leaseUpAbsorptionIncome(-50_000, 12)).toBe(0); // a stabilized loss contributes nothing
  });
});
