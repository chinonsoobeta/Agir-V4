// Golden fixture 2: Harbour Centre: a catastrophic deal, no sugarcoating.
// Asserts the exact blocked → defaults → conflict-resolution → reconciliation
// → REJECT sequence, engine outputs to the dollar, non-degenerate stress
// columns, and that no fabricated value can pass the provenance verifier.

import { describe, expect, test } from "vitest";
import {
  assembleEngineInput,
  applyStress,
  buildAllowedValues,
  computeReadiness,
  conservativePick,
  componentGpr,
  DEFAULTS,
  deriveCalculatedTdc,
  runReconciliationChecks,
  runUnderwriting,
  STRESS_PRESETS,
  UnderwritingBlockedError,
  verifyNumericProvenance,
  type ProjectInputRows,
} from "@/lib/engine";
import { harbourSeedRows, HARBOUR_EXIT_CAP_CONFLICT } from "@/lib/engine/harbour-fixture";
import { computeInvestmentVerdict } from "@/lib/verdict";

function acceptDefaults(rows: ProjectInputRows, keys: string[]) {
  for (const key of keys) {
    const def = DEFAULTS[key];
    if (!def) throw new Error(`No static default for ${key}`);
    rows.scalars.push({ key, value_numeric: def.value, status: "default_accepted", source: "default" });
  }
}

function resolveConflictConservative(rows: ProjectInputRows, key: string) {
  const row = rows.scalars.find((r) => r.key === key && r.status === "conflicting");
  if (!row?.conflict_values?.length) throw new Error(`No conflict to resolve for ${key}`);
  const winner = conservativePick(key, row.conflict_values.map((c) => c.value));
  row.value_numeric = winner;
  row.status = "approved";
  return winner;
}

describe("Harbour Centre golden fixture (catastrophic deal)", () => {
  test("full sequence: blocked → defaults → conflict → flags → REJECT", () => {
    const rows = harbourSeedRows();

    // ---- 1. BLOCKED: missing expense_ratio, hold_years, selling_costs; exit cap conflicting.
    const blocked = computeReadiness(rows);
    expect(blocked.status).toBe("blocked");
    expect(blocked.missing.sort()).toEqual(["expense_ratio_pct", "hold_years", "selling_costs_pct"]);
    expect(blocked.conflicting).toEqual(["exit_cap_rate_pct"]);
    expect(blocked.defaultable.sort()).toEqual(["expense_ratio_pct", "hold_years", "selling_costs_pct"]);
    // No metrics can be produced: assembly fails closed.
    expect(() => assembleEngineInput(rows)).toThrow(UnderwritingBlockedError);

    // A derivable total is never "missing": TDC is calculated from the five lines.
    const calculated = deriveCalculatedTdc(rows.budget);
    expect(calculated).not.toBeNull();
    expect(calculated!.value).toBe(250_000_000);
    expect(calculated!.formula_text).toContain("= 250,000,000");

    // ---- 2. Analyst accepts defaults (35% / 5y / 2%) and resolves the cap conservatively.
    acceptDefaults(rows, blocked.defaultable);
    // "use conservative" = the value producing the LOWER valuation: 5.25%, never a third value.
    const cap = resolveConflictConservative(rows, "exit_cap_rate_pct");
    expect(cap).toBe(5.25);
    expect(HARBOUR_EXIT_CAP_CONFLICT.values.map((v) => v.value)).toContain(cap);

    const ready = computeReadiness(rows);
    expect(ready.status).toBe("ready");
    const input = assembleEngineInput(rows);

    // ---- 4. Engine output (assert to $1 / 0.01%).
    const output = runUnderwriting(input);
    const v = output.values;
    expect(Math.round(v.tdc)).toBe(250_000_000);
    expect(Math.round(v.gpr)).toBe(9_960_000);
    expect(Math.round(v.egi)).toBe(9_404_640);
    expect(Math.round(v.noi)).toBe(6_113_016);
    expect(v.yieldOnCostPct).toBeCloseTo(2.45, 2);
    expect(Math.round(v.developmentSpreadBps)).toBe(-280);
    expect(Math.round(v.exitValue)).toBe(116_438_400);
    expect(Math.round(v.netSaleBeforeDebt)).toBe(114_109_632);
    expect(Math.round(v.developmentProfit)).toBe(-133_561_600);
    expect(Math.round(v.annualDebtService)).toBe(12_006_485);
    expect(v.dscr).toBeCloseTo(0.51, 2);
    expect(v.interestOnlyDscr).toBeCloseTo(0.6, 2);
    expect(Math.round(v.requiredEquity)).toBe(87_500_000);
    const equityRequirement = output.metrics.find((m) => m.key === "equity_requirement")!;
    expect(Math.round(equityRequirement.value)).toBe(87_500_000);
    expect(equityRequirement.formula).toContain("= 87,500,000");
    const cashOnCash = output.metrics.find((m) => m.key === "cash_on_cash")!;
    expect(cashOnCash.formula).toContain("committed equity 50,000,000");
    const cashShortfall = output.metrics.find((m) => m.key === "cumulative_cash_shortfall")!;
    expect(Math.round(cashShortfall.value)).toBe(26_560_036);
    expect(cashShortfall.formula).toContain("Cumulative cash shortfall");
    // Sale proceeds < loan payoff → equity wipeout, EM ≈ 0.0x, IRR not meaningful.
    expect(v.netSaleBeforeDebt).toBeLessThan(v.loanPayoffAtExit);
    expect(output.equityWipeout).toBe(true);
    expect(v.equityMultiple).toBeCloseTo(0, 1);
    expect(output.irrStatus).toBe("not_meaningful");
    expect(Number.isNaN(v.irrPct)).toBe(true);
    // Never print a positive IRR on a wipeout, never 0% as a placeholder.
    const irrMetric = output.metrics.find((m) => m.key === "irr_estimate")!;
    expect(irrMetric.formula).toContain("IRR not meaningful");

    // ---- 3. Reconciliation gates fire.
    const flags = runReconciliationChecks({
      tdc: v.tdc,
      equity: 50_000_000,
      loan: 162_500_000,
      noi: v.noi,
      amortizingAnnualDebtService: v.annualDebtService,
      minDscr: 1.2,
      lenderStabilizedOccupancyPct: 93,
      componentOccupancies: input.revenueProgram.map((r) => ({
        unitType: r.unitType,
        occupancyPct: r.occupancyPct ?? null,
      })),
      unitCounts: [220, 220],
    });
    const gapFlag = flags.find((f) => f.check_key === "sources_vs_uses")!;
    expect(gapFlag.severity).toBe("error");
    expect(Math.round(gapFlag.expected! - gapFlag.actual!)).toBe(37_500_000);
    expect(gapFlag.message).toContain("37,500,000");
    const covenantFlag = flags.find((f) => f.check_key === "covenant_feasibility")!;
    expect(covenantFlag.severity).toBe("error");
    expect(Math.round(covenantFlag.expected!)).toBe(14_407_782);
    expect(Math.round(covenantFlag.actual!)).toBe(6_113_016);
    expect(covenantFlag.message).toContain("2.4×");
    // Office (85%) and retail (92%) are below the lender's 93% stabilization.
    expect(flags.filter((f) => f.check_key.startsWith("occupancy_vs_lender")).length).toBe(2);
    // Consistent unit counts raise no flag.
    expect(flags.find((f) => f.check_key === "unit_count_consistency")).toBeUndefined();

    // ---- Verdict: REJECT, true magnitude of loss shown.
    const errorFlags = flags.filter((f) => f.severity === "error");
    expect(errorFlags.length).toBe(2);
    const verdict = computeInvestmentVerdict({
      equity_multiple: v.equityMultiple,
      profit_margin: v.profitOnCostPct,
      development_spread: v.developmentSpreadBps,
      stress_dscr: runUnderwriting(applyStress(input, STRESS_PRESETS[4])).values.dscr,
      stress_equity_multiple: runUnderwriting(applyStress(input, STRESS_PRESETS[4])).values.equityMultiple,
      equity_wipeout: output.equityWipeout,
      error_flag_count: errorFlags.length,
    });
    expect(verdict.code).toBe("REJECT");

    // ---- 5. All five stress columns are populated with non-zero engine-run values.
    for (const preset of STRESS_PRESETS) {
      const stressed = runUnderwriting(applyStress(input, preset));
      expect(stressed.values.tdc).toBeGreaterThan(0);
      expect(stressed.values.noi).toBeGreaterThan(0);
      expect(stressed.values.exitValue).toBeGreaterThan(0);
      expect(stressed.values.annualDebtService).toBeGreaterThan(0);
      expect(stressed.values.dscr).toBeGreaterThan(0);
      expect(stressed.values.egi).toBeGreaterThan(0);
    }

    // ---- 6. Provenance verifier: every displayed number traces to the seeded
    // inputs or engine math.
    const inputValues = [
      34_500_000, 162_000_000, 27_500_000, 18_000_000, 8_000_000, // budget lines
      220, 3_050, 42, 36, 18_000, 32_000, 96, 92, 85, // revenue program
      162_500_000, 6.25, 30, 1.2, 93, 50_000_000, 3, 4.75, 5.25, // capital stack & conflict candidates
      DEFAULTS.expense_ratio_pct.value, DEFAULTS.hold_years.value, DEFAULTS.selling_costs_pct.value,
    ];
    const engineValues = Object.values(v).filter((x): x is number => typeof x === "number");
    const derivedValues = [
      0, // EM ≈ 0.0x on wipeout
      calculated!.value,
      v.tdc - 162_500_000, // implied equity shown in the equity formula
      1.2 * v.annualDebtService, // covenant-required NOI
      (1.2 * v.annualDebtService) / v.noi, // covenant shortfall ratio
      162_500_000 * 0.0625, // interest-only debt service in the IO DSCR formula
      50_000_000 + 162_500_000, // sources total in the funding-gap message
      v.tdc - (50_000_000 + 162_500_000), // the gap itself
      ...input.revenueProgram.map((r) => componentGpr(r)),
      ...output.cashFlows.map((c) => c.amount),
      ...output.metrics.map((m) => m.value),
    ];
    const allowed = buildAllowedValues(inputValues, engineValues, derivedValues);

    const renderedSurface = [
      ...output.metrics.map((m) => `${m.label}: ${m.formula}`),
      ...flags.map((f) => f.message),
      calculated!.formula_text,
    ].join("\n");
    const report = verifyNumericProvenance(renderedSurface, allowed);
    expect(report.orphans).toEqual([]);
    expect(report.pass).toBe(true);

    // Absence of any value not derivable from the seed: no invented budgets,
    // no 5.35% cap, no phantom other income, no 222 units.
    const fabricated = "Exit cap 5.35%, other income $275,000, 222 units, hard costs $86,000,000.";
    const fabricationReport = verifyNumericProvenance(fabricated, allowed);
    expect(fabricationReport.pass).toBe(false);
    expect(fabricationReport.orphans.map((o) => o.value)).toEqual(
      expect.arrayContaining([5.35, 275_000, 222, 86_000_000]),
    );
    // No phantom other income reached the engine.
    expect(input.otherIncomeAnnual).toBe(0);
  });

  test("conservative resolution is a pure function: cap/costs pick higher, revenue/occupancy pick lower", () => {
    expect(conservativePick("exit_cap_rate_pct", [4.75, 5.25])).toBe(5.25);
    expect(conservativePick("expense_ratio_pct", [32, 38])).toBe(38);
    expect(conservativePick("interest_rate_pct", [5.9, 6.25])).toBe(6.25);
    expect(conservativePick("stabilized_occupancy_pct", [93, 96])).toBe(93);
    expect(conservativePick("rent_growth_pct", [2, 3])).toBe(2);
    // unknown income-like key falls back to the lower value (lower return)
    expect(conservativePick("misc_income", [10, 20])).toBe(10);
  });
});
