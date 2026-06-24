// Deterministic memo template: proves the no-AI fallback produces every
// required section and that EVERY numeric token traces to an approved
// assumption or a deterministic engine output (zero provenance orphans). This
// is the structural guarantee that the deterministic memo never invents a
// number.

import { describe, expect, test } from "vitest";
import {
  assembleEngineInput,
  applyStress,
  STRESS_PRESETS,
  runUnderwriting,
  conservativePick,
  DEFAULTS,
  runReconciliationChecks,
  buildAllowedValues,
  verifyNumericProvenance,
  type ProjectInputRows,
} from "@/lib/engine";
import { harbourSeedRows } from "@/lib/engine/harbour-fixture";
import { computeInvestmentVerdict } from "@/lib/verdict";
import { buildDeterministicMemo } from "@/lib/memo-template";
import { ASSUMPTION_BY_KEY } from "@/lib/assumption-taxonomy";

function acceptDefaults(rows: ProjectInputRows, keys: string[]) {
  for (const key of keys) {
    const def = DEFAULTS[key];
    rows.scalars.push({ key, value_numeric: def.value, status: "default_accepted", source: "default" });
  }
}
function resolveConflictConservative(rows: ProjectInputRows, key: string) {
  const row = rows.scalars.find((r) => r.key === key && r.status === "conflicting");
  row!.value_numeric = conservativePick(key, row!.conflict_values!.map((c) => c.value));
  row!.status = "approved";
}

// Taxonomy assumptions mirroring the (resolved) Harbour fixture.
const HARBOUR_ASSUMPTIONS = [
  ["land_cost", 34_500_000], ["hard_costs", 162_000_000], ["soft_costs", 27_500_000],
  ["financing_costs", 18_000_000], ["contingency", 8_000_000], ["debt_amount", 162_500_000],
  ["equity_amount", 50_000_000], ["interest_rate", 6.25], ["amortization_years", 30],
  ["min_dscr", 1.2], ["lender_stabilized_occupancy", 93], ["rent_growth", 3],
  ["residential_units", 220], ["residential_rent_monthly", 3050], ["residential_occupancy", 96],
  ["retail_sf", 18_000], ["retail_rent_psf", 42], ["retail_occupancy", 92],
  ["office_sf", 32_000], ["office_rent_psf", 36], ["office_occupancy", 85],
  ["exit_cap_rate", 5.25],
].map(([field_key, value_numeric]) => {
  const def = ASSUMPTION_BY_KEY[field_key as string];
  return {
    field_key, value_numeric, field_label: def.label, unit: def.unit, status: "approved",
    source_location: "Harbour_Centre_Demo",
  };
});

function buildContext() {
  const rows = harbourSeedRows();
  acceptDefaults(rows, ["expense_ratio_pct", "hold_years", "selling_costs_pct"]);
  resolveConflictConservative(rows, "exit_cap_rate_pct");
  const input = assembleEngineInput(rows);

  const SCEN = [
    { key: "base", out: runUnderwriting(input) },
    { key: "cap_expansion", out: runUnderwriting(applyStress(input, STRESS_PRESETS[0])) },
    { key: "combined", out: runUnderwriting(applyStress(input, STRESS_PRESETS[4])) },
  ];
  const outputs = SCEN.flatMap(({ key, out }) =>
    out.metrics.map((m) => ({
      scenario_key: key, metric_key: m.key, metric_label: m.label,
      value_numeric: m.value, unit: m.unit, formula_text: m.formula,
    })),
  );
  const base = SCEN[0].out;
  const cashFlows = base.cashFlows.map((c) => ({ scenario_key: "base", amount: c.amount }));
  const flags = runReconciliationChecks({
    tdc: base.values.tdc, equity: 50_000_000, loan: 162_500_000, noi: base.values.noi,
    amortizingAnnualDebtService: base.values.annualDebtService, minDscr: 1.2,
    lenderStabilizedOccupancyPct: 93,
    componentOccupancies: input.revenueProgram.map((r) => ({ unitType: r.unitType, occupancyPct: r.occupancyPct ?? null })),
    unitCounts: [220, 220],
  }).map((f) => ({ ...f, resolved: false }));
  const errorFlags = flags.filter((f) => f.severity === "error" && !f.resolved);
  const verdict = computeInvestmentVerdict({
    equity_multiple: base.values.equityMultiple, profit_margin: base.values.profitOnCostPct,
    development_spread: base.values.developmentSpreadBps, stress_dscr: SCEN[2].out.values.dscr,
    stress_equity_multiple: SCEN[2].out.values.equityMultiple, error_flag_count: errorFlags.length,
  });

  return { input, outputs, cashFlows, flags, errorFlags, verdict };
}

describe("Deterministic memo template", () => {
  test("produces all required sections, non-empty", () => {
    const { outputs, cashFlows, flags, errorFlags, verdict } = buildContext();
    const memo = buildDeterministicMemo({
      project: { name: "Harbour Centre", location: "Mixed-use waterfront", type: "mixed_use", status: "underwriting" },
      assumptions: HARBOUR_ASSUMPTIONS, engineInputs: [], outputs, cashFlows, flags, risks: [], errorFlags, verdict,
    });
    for (const key of [
      "executive_summary", "project_description", "sources_and_uses", "approved_assumptions",
      "financial_highlights", "scenario_stress_summary", "key_risks",
      "reconciliation_flags_summary", "investment_committee_recommendation", "sources_and_assumptions",
    ]) {
      expect(typeof memo[key], `${key} present`).toBe("string");
      expect(memo[key].length, `${key} non-empty`).toBeGreaterThan(0);
    }
    // The verdict (REJECT) must appear in the recommendation.
    expect(memo.investment_committee_recommendation).toContain("REJECT");
  });

  test("never invents a number: zero provenance orphans", () => {
    const { outputs, cashFlows, flags, errorFlags, verdict } = buildContext();
    const memo = buildDeterministicMemo({
      project: { name: "Harbour Centre", location: "Mixed-use waterfront", type: "mixed_use", status: "underwriting" },
      assumptions: HARBOUR_ASSUMPTIONS, engineInputs: [], outputs, cashFlows, flags, risks: [], errorFlags, verdict,
    });

    // Allowed set mirrors generateMemo (including flag-derived pure functions).
    const flagDerived: number[] = [];
    for (const f of flags) {
      const e = f.expected == null ? null : Number(f.expected);
      const a = f.actual == null ? null : Number(f.actual);
      if (e != null) flagDerived.push(e);
      if (a != null) flagDerived.push(a);
      if (e != null && a != null) {
        flagDerived.push(e - a, a - e);
        if (a !== 0) flagDerived.push(e / a);
        if (e !== 0) flagDerived.push(a / e);
      }
    }
    const allowed = buildAllowedValues(
      HARBOUR_ASSUMPTIONS.map((a) => Number(a.value_numeric)),
      [],
      outputs.map((o) => (o.value_numeric == null ? null : Number(o.value_numeric))),
      cashFlows.map((c) => Number(c.amount)),
      flags.flatMap((f) => [f.expected == null ? null : Number(f.expected), f.actual == null ? null : Number(f.actual)]),
      verdict.gates.map((g) => (g.actual == null ? null : Number(g.actual))),
      [1.5, 15, 100, 1.2, 1.0],
      flagDerived,
    );

    const memoText = Object.values(memo).filter((v) => typeof v === "string").join("\n");
    const report = verifyNumericProvenance(memoText, allowed);
    expect(report.orphans).toEqual([]);
    expect(report.pass).toBe(true);
  });
});
