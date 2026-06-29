// Metamorphic whole-pipeline tests: document extraction -> approval -> engine
// run -> report generation -> provenance verification, exercised end to end in
// memory. Metamorphic relations assert a transformation of the INPUT produces a
// predictable transformation of the OUTPUT, catching whole-pipeline bugs that no
// single fixture would:
//   * Permutation invariance: the order documents arrive in cannot change the
//     approved inputs or the engine result.
//   * Dollar-scale covariance: scaling every dollar input by k scales every
//     dollar output by k and leaves dimensionless outputs (LTC, DSCR, cap,
//     occupancy, multiples, IRR) invariant -- a dimensional-analysis check that
//     catches a stray additive constant or a unit slip anywhere in the engine.
// The generated report is then provenance-verified: every number traces to an
// approved input or an engine output, before and after each transform.

import { describe, expect, test } from "vitest";
import {
  assembleEngineInput,
  buildAllowedValues,
  runUnderwriting,
  verifyNumericProvenance,
  type ProjectInputRows,
} from "@/lib/engine";
import { extractCandidates } from "@/lib/assumption-candidates.server";
import { groupAndResolve, mapCandidates } from "@/lib/assumption-mapping";
import {
  TAXONOMY_TO_BUDGET_CATEGORY,
  TAXONOMY_TO_ENGINE_SCALAR,
  TAXONOMY_TO_REVENUE_FIELD,
} from "@/lib/taxonomy-engine-map";

// ---- A complete, approved base deal (the post-approval state) ----
function baseRows(): ProjectInputRows {
  return {
    scalars: [
      { key: "loan_amount", value_numeric: 120_000_000, status: "approved" },
      { key: "interest_rate_pct", value_numeric: 6, status: "approved" },
      { key: "amort_years", value_numeric: 30, status: "approved" },
      { key: "equity_amount", value_numeric: 60_000_000, status: "approved" },
      { key: "exit_cap_rate_pct", value_numeric: 5.25, status: "approved" },
      { key: "expense_ratio_pct", value_numeric: 35, status: "approved" },
      { key: "hold_years", value_numeric: 5, status: "approved" },
      { key: "selling_costs_pct", value_numeric: 2, status: "approved" },
      { key: "stabilized_occupancy_pct", value_numeric: 94, status: "approved" },
    ],
    budget: [
      { category: "land", amount: 18_000_000, status: "approved" },
      { category: "hard", amount: 120_000_000, status: "approved" },
      { category: "soft", amount: 18_000_000, status: "approved" },
      { category: "contingency", amount: 6_000_000, status: "approved" },
      { category: "financing_interest", amount: 8_000_000, status: "approved" },
    ],
    revenue: [
      {
        unit_type: "Residential",
        unit_count: 300,
        rent: 3_000,
        rent_basis: "per_unit",
        occupancy_pct: 94,
        status: "approved",
      },
    ],
  };
}

const clone = (r: ProjectInputRows): ProjectInputRows => JSON.parse(JSON.stringify(r));

// ---- Extraction -> approval bridge -------------------------------------------
// Resolve every doc to taxonomy field_key -> value, then apply each over the
// approved base (an analyst approving a freshly-extracted value).
function extractDeal(docs: string[]): Map<string, number> {
  const mapped = docs.flatMap((d, i) => mapCandidates(extractCandidates(`doc-${i}.txt`, d)));
  const grouped = groupAndResolve(mapped);
  const out = new Map<string, number>();
  for (const g of grouped.values()) {
    if (g.status === "extracted" && g.value_numeric != null)
      out.set(g.field_key, Number(g.value_numeric));
  }
  return out;
}

function applyExtraction(base: ProjectInputRows, extracted: Map<string, number>): ProjectInputRows {
  const rows = clone(base);
  for (const [taxonomyKey, value] of extracted) {
    const scalarKey = TAXONOMY_TO_ENGINE_SCALAR[taxonomyKey];
    if (scalarKey) {
      const existing = rows.scalars.find((s) => s.key === scalarKey);
      if (existing) existing.value_numeric = value;
      else rows.scalars.push({ key: scalarKey, value_numeric: value, status: "approved" });
      continue;
    }
    const budgetCategory = TAXONOMY_TO_BUDGET_CATEGORY[taxonomyKey];
    if (budgetCategory) {
      const existing = rows.budget.find((b) => b.category === (budgetCategory as any));
      if (existing) existing.amount = value;
      continue;
    }
    const rev = TAXONOMY_TO_REVENUE_FIELD[taxonomyKey];
    if (rev) {
      const comp = rows.revenue.find((r) => r.unit_type === rev.unitType);
      if (comp && rev.field === "rent") comp.rent = value;
      if (comp && rev.field === "unit_count") comp.unit_count = value;
      if (comp && rev.field === "occupancy_pct") comp.occupancy_pct = value;
    }
  }
  return rows;
}

// ---- Report generation + provenance verification -----------------------------
function pipeline(rows: ProjectInputRows) {
  const output = runUnderwriting(assembleEngineInput(rows));
  const v = output.values;
  // A numbers-only report card. Every figure is an engine output, so a clean
  // provenance pass is the contract; an injected orphan must fail (asserted
  // separately).
  const card = [
    `Total project cost $${Math.round(v.tdc).toLocaleString("en-US")}.`,
    `Stabilized NOI $${Math.round(v.noi).toLocaleString("en-US")}.`,
    `Exit value $${Math.round(v.exitValue).toLocaleString("en-US")}.`,
    `Required equity $${Math.round(v.requiredEquity).toLocaleString("en-US")}.`,
    `LTC ${v.ltcPct.toFixed(2)}%. DSCR ${v.dscr.toFixed(2)}x. Debt yield ${v.debtYieldPct.toFixed(2)}%.`,
  ].join("\n");
  const inputNumbers = [
    ...rows.scalars.map((s) => s.value_numeric),
    ...rows.budget.map((b) => b.amount),
    ...rows.revenue.flatMap((r) => [r.unit_count, r.rent, r.occupancy_pct ?? null]),
  ];
  const outputNumbers = Object.values(v).map((n) => (typeof n === "number" ? n : null));
  const allowed = buildAllowedValues(inputNumbers, outputNumbers);
  const prov = verifyNumericProvenance(card, allowed);
  return { output, card, allowed, prov };
}

// ---- Dollar-scale transform --------------------------------------------------
const DOLLAR_SCALARS = new Set(["loan_amount", "equity_amount", "other_income_annual"]);
function scaleDollars(rows: ProjectInputRows, k: number): ProjectInputRows {
  const r = clone(rows);
  for (const s of r.scalars)
    if (DOLLAR_SCALARS.has(s.key) && s.value_numeric != null) s.value_numeric *= k;
  for (const b of r.budget) b.amount *= k;
  for (const c of r.revenue) c.rent *= k; // $/unit/mo and $/SF are both dollars
  return r;
}

const DOLLAR_OUTPUTS = [
  "tdc",
  "noi",
  "egi",
  "gpr",
  "exitValue",
  "netSaleBeforeDebt",
  "requiredEquity",
  "totalDebt",
  "annualDebtService",
  "developmentProfit",
] as const;
const RATIO_OUTPUTS = [
  "ltcPct",
  "dscr",
  "debtYieldPct",
  "yieldOnCostPct",
  "profitOnCostPct",
  "effectiveOccupancyPct",
  "equityMultiple",
  "irrPct",
] as const;
const approx = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 1e-6);

describe("metamorphic whole-pipeline", () => {
  test("baseline: the pipeline produces a provenance-clean report", () => {
    const { prov } = pipeline(baseRows());
    expect(prov.orphans, JSON.stringify(prov.orphans)).toEqual([]);
    expect(prov.pass).toBe(true);
  });

  test("provenance actually catches an untraceable number injected into the report", () => {
    const { allowed } = pipeline(baseRows());
    const tampered = "Stabilized NOI $123,456,789."; // not an engine output
    const prov = verifyNumericProvenance(tampered, allowed);
    expect(prov.pass).toBe(false);
    expect(prov.orphans.length).toBeGreaterThan(0);
  });

  test("MR1 permutation: document arrival order cannot change the engine result", () => {
    const docs = [
      "Land acquisition cost $40,000,000.",
      "Senior loan amount $150,000,000. Interest rate 6.5%.",
      "Average residential rent of $3,200 per month.",
    ];
    const permutations = [
      [0, 1, 2],
      [2, 1, 0],
      [1, 2, 0],
      [0, 2, 1],
    ];
    const results = permutations.map((order) => {
      const rows = applyExtraction(baseRows(), extractDeal(order.map((i) => docs[i])));
      return runUnderwriting(assembleEngineInput(rows)).values;
    });
    // Every permutation yields byte-identical engine values.
    for (const r of results) expect(r).toEqual(results[0]);
    // And the extracted overrides actually took effect end to end.
    const rows = applyExtraction(baseRows(), extractDeal(docs));
    expect(rows.budget.find((b) => b.category === "land")?.amount).toBe(40_000_000);
    expect(rows.scalars.find((s) => s.key === "loan_amount")?.value_numeric).toBe(150_000_000);
    expect(rows.scalars.find((s) => s.key === "interest_rate_pct")?.value_numeric).toBe(6.5);
    expect(rows.revenue[0].rent).toBe(3_200);
  });

  test("MR2 dollar-scale: every dollar output scales by k; ratios are invariant; provenance stays clean", () => {
    const k = 10;
    const base = pipeline(baseRows());
    const scaled = pipeline(scaleDollars(baseRows(), k));
    for (const key of DOLLAR_OUTPUTS) {
      const b = (base.output.values as Record<string, number>)[key];
      const s = (scaled.output.values as Record<string, number>)[key];
      expect(approx(s, b * k), `${key}: base=${b} scaled=${s} expected=${b * k}`).toBe(true);
    }
    for (const key of RATIO_OUTPUTS) {
      const b = (base.output.values as Record<string, number>)[key];
      const s = (scaled.output.values as Record<string, number>)[key];
      if (Number.isFinite(b)) expect(approx(s, b), `${key}: base=${b} scaled=${s}`).toBe(true);
    }
    // The transformed deal still generates a provenance-clean report.
    expect(scaled.prov.pass).toBe(true);
    expect(scaled.prov.orphans).toEqual([]);
  });
});
