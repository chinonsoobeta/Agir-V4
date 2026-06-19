import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseRentRollWorkbook } from "@/lib/parsers/rent-roll.server";
import { parseBudgetWorkbook, categoryFor } from "@/lib/parsers/budget.server";
import { aggregateBudgetRows } from "@/lib/budget-assumption-mapper";
import { mapRevenueProgramRowToAssumptions } from "@/lib/revenue-assumption-mapper";
import { mapCandidateToKey, groupAndResolve, type MappedCandidate } from "@/lib/assumption-mapping";
import type { Candidate } from "@/lib/assumption-candidates.server";
import { componentGpr, runUnderwriting } from "@/lib/engine/proforma";
import { assembleEngineInput, computeReadiness, conservativePick, type ProjectInputRows } from "@/lib/engine";
import { generateFindings } from "@/lib/findings";
import { industrialFindings } from "@/lib/findings/modules/industrial";
import type { NormalizedFindingsInput } from "@/lib/findings/findings-types";

const fixtureDir = "/Users/chinonsoobeta/Downloads/source_documents";
const rentRollPath = path.join(fixtureDir, "Summit_Point_Rent_Roll.xlsx");
const budgetPath = path.join(fixtureDir, "Summit_Point_Construction_Budget.xlsx");

async function buf(filePath: string): Promise<ArrayBuffer> {
  const bytes = await readFile(filePath);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const pct = (cands: Partial<Candidate>): Candidate => ({
  kind: "percent", value_numeric: 0, value_text: "", unit: "%", context: "", doc_name: "doc", label_hint: "", source_location: null, ...cands,
});

// ---------- Test 1: rent roll parsing ----------
describe("Summit Point rent roll parsing", () => {
  test("parses four components with per-SF rent and component occupancy", async () => {
    const { inserted } = parseRentRollWorkbook(await buf(rentRollPath));
    const names = inserted.map((r) => r.unitType);
    expect(names).toEqual(expect.arrayContaining(["Dry Warehouse", "Cold Storage", "Last-Mile Flex", "Other Income"]));
    expect(inserted).toHaveLength(4); // Total row rejected

    const dry = inserted.find((r) => r.unitType === "Dry Warehouse")!;
    expect(dry.rentBasis).toBe("per_sf");
    expect(dry.avgSf).toBe(760000);
    expect(dry.rent).toBe(18.5);
    expect(dry.occupancyPct).toBe(96);
    expect(dry.tenant).toBe("Horizon Commerce");
  });
});

// ---------- Test 2: revenue component engine ----------
describe("Summit Point revenue mapping + engine math", () => {
  test("maps industrial components to canonical keys and Other Income to a scalar", async () => {
    const { inserted } = parseRentRollWorkbook(await buf(rentRollPath));
    const mapped = inserted.flatMap((r) => mapRevenueProgramRowToAssumptions(r, { name: "rentroll" }));
    const byKey = Object.fromEntries(mapped.map((m) => [m.field_key, m.value_numeric]));
    expect(byKey.dry_warehouse_sf).toBe(760000);
    expect(byKey.dry_warehouse_rent_psf).toBe(18.5);
    expect(byKey.dry_warehouse_occupancy).toBe(96);
    expect(byKey.cold_storage_sf).toBe(280000);
    expect(byKey.last_mile_flex_sf).toBe(200000);
    expect(byKey.other_income_annual).toBe(1400000);
    expect(mapped.every((m) => m.candidate_role === "rent_row")).toBe(true);
  });

  test("componentGpr computes per-SF annual GPR and occupancy-adjusted EGI", () => {
    const dryGpr = componentGpr({ unitType: "Dry Warehouse", unitCount: 1, avgSf: 760000, rent: 18.5, rentBasis: "per_sf" });
    expect(dryGpr).toBeCloseTo(14_060_000, 0);
    expect(dryGpr * 0.96).toBeCloseTo(13_497_600, 0);
  });
});

// ---------- Test 3: budget aggregation ----------
describe("Summit Point budget aggregation", () => {
  test("classifies offsite/environmental to reserves, not land", () => {
    expect(categoryFor("Offsite")).toBe("other");
    expect(categoryFor("Environmental")).toBe("other");
    expect(categoryFor("Land")).toBe("land");
    expect(categoryFor("Hard Costs")).toBe("hard");
  });

  test("sums line items per category into a single total", async () => {
    const { inserted } = parseBudgetWorkbook(await buf(budgetPath));
    const agg = aggregateBudgetRows(inserted, { name: "budget" });
    const byKey = Object.fromEntries(agg.map((m) => [m.field_key, m.value_numeric]));
    expect(byKey.hard_costs).toBe(220_000_000);
    expect(byKey.soft_costs).toBe(39_500_000);
    expect(byKey.land_cost).toBe(42_000_000);
    expect(byKey.contingency).toBe(12_000_000);
    expect(byKey.financing_costs).toBe(17_250_000);
    expect(byKey.environmental_reserve).toBe(6_500_000);
    expect(byKey.offsite_improvements).toBe(9_000_000);
    expect(agg.every((m) => m.candidate_role === "category_total")).toBe(true);
    const total = agg.reduce((s, m) => s + (m.value_numeric ?? 0), 0);
    expect(total).toBe(346_250_000);
  });
});

// ---------- Test 4 + 5: conflict vs aggregation, structured precedence ----------
describe("Summit Point conflict semantics", () => {
  const cat = (key: string, value: number, role: MappedCandidate["candidate_role"], source: string): MappedCandidate => ({
    field_key: key, value_numeric: value, value_text: null, unit: "$", confidence: 99,
    source_doc_name: source, source_text: "", source_location: null, matched_alias: "", via: "alias", candidate_role: role,
  });

  test("aggregated category total wins over loose line-item scalars (no false conflict)", () => {
    const resolved = groupAndResolve([
      cat("hard_costs", 118_500_000, "line_item", "budget"),
      cat("hard_costs", 220_000_000, "category_total", "budget"),
    ]);
    const hard = resolved.get("hard_costs")!;
    expect(hard.status).toBe("extracted");
    expect(hard.value_numeric).toBe(220_000_000);
  });

  test("two competing totals from different documents conflict (sponsor TDC vs budget TDC)", () => {
    const resolved = groupAndResolve([
      cat("total_project_cost", 334_000_000, "stated_total", "sponsor"),
      cat("total_project_cost", 346_250_000, "stated_total", "budget"),
    ]);
    const tdc = resolved.get("total_project_cost")!;
    expect(tdc.status).toBe("conflicting");
    expect(tdc.value_numeric).toBeNull();
    expect(tdc.conflict_values?.map((c) => c.value)).toEqual(expect.arrayContaining([334_000_000, 346_250_000]));
  });
});

// ---------- Test 5b: mapping contamination guards ----------
describe("Summit Point mapping contamination guards", () => {
  test("an exit-cap value of 5.75% never maps to operating expense ratio", () => {
    const c = pct({ value_numeric: 5.75, value_text: "5.75%", label_hint: "appraisal exit cap rate", context: "appraisal exit cap rate 5.75%" });
    expect(mapCandidateToKey(c)?.field_key).not.toBe("opex_ratio");
    expect(mapCandidateToKey(c)?.field_key).toBe("exit_cap_rate");
  });

  test("an operating expense ratio of 27% maps to opex_ratio", () => {
    const c = pct({ value_numeric: 27, value_text: "27%", label_hint: "operating expense ratio", context: "appraisal operating expense ratio 27%" });
    expect(mapCandidateToKey(c)?.field_key).toBe("opex_ratio");
  });

  test("component occupancy does not collapse into stabilized occupancy", () => {
    const c = pct({ value_numeric: 96, value_text: "96%", label_hint: "dry warehouse occupancy", context: "dry warehouse occupancy 96%" });
    expect(mapCandidateToKey(c)?.field_key).not.toBe("stabilized_occupancy");
    const sponsor = pct({ value_numeric: 95, value_text: "95%", label_hint: "stabilized occupancy", context: "sponsor stabilized occupancy 95%" });
    expect(mapCandidateToKey(sponsor)?.field_key).toBe("stabilized_occupancy");
  });
});

// ---------- Test conservative resolution direction ----------
describe("Summit Point conservative resolution", () => {
  test("conservative picks the worse value per field, never an average", () => {
    expect(conservativePick("exit_cap_rate_pct", [5.25, 5.75])).toBe(5.75);
    expect(conservativePick("interest_rate_pct", [6.65, 7.15])).toBe(7.15);
    expect(conservativePick("expense_ratio_pct", [24, 27])).toBe(27);
    expect(conservativePick("loan_amount", [200_400_000, 210_000_000])).toBe(200_400_000);
    expect(conservativePick("equity_amount", [120_000_000, 133_600_000])).toBe(133_600_000);
  });
});

// ---------- Test 8: engine readiness + run ----------
function summitRows(): ProjectInputRows {
  return {
    scalars: [
      { key: "loan_amount", value_numeric: 200_400_000, status: "approved" },
      { key: "interest_rate_pct", value_numeric: 7.15, status: "approved" },
      { key: "amort_years", value_numeric: 30, status: "approved" },
      { key: "equity_amount", value_numeric: 133_600_000, status: "approved" },
      { key: "exit_cap_rate_pct", value_numeric: 5.75, status: "approved" },
      { key: "expense_ratio_pct", value_numeric: 27, status: "approved" },
      { key: "hold_years", value_numeric: 5, status: "approved" },
      { key: "selling_costs_pct", value_numeric: 2, status: "approved" },
      { key: "other_income_annual", value_numeric: 1_400_000, status: "approved" },
    ],
    budget: [
      { category: "land", amount: 42_000_000, status: "approved" },
      { category: "hard", amount: 220_000_000, status: "approved" },
      { category: "soft", amount: 39_500_000, status: "approved" },
      { category: "contingency", amount: 12_000_000, status: "approved" },
      { category: "financing_interest", amount: 17_250_000, status: "approved" },
      { category: "other", amount: 6_500_000, status: "approved" },
      { category: "other", amount: 9_000_000, status: "approved" },
    ],
    revenue: [
      { unit_type: "Dry Warehouse", unit_count: 1, avg_sf: 760000, rent: 18.5, rent_basis: "per_sf", occupancy_pct: 96, status: "approved" },
      { unit_type: "Cold Storage", unit_count: 1, avg_sf: 280000, rent: 31, rent_basis: "per_sf", occupancy_pct: 94, status: "approved" },
      { unit_type: "Last-Mile Flex", unit_count: 1, avg_sf: 200000, rent: 23.5, rent_basis: "per_sf", occupancy_pct: 92, status: "approved" },
    ],
  };
}

describe("Summit Point engine readiness + run", () => {
  test("becomes ready and underwrites with TDC including reserves and occupancy-preserved EGI", () => {
    const rows = summitRows();
    expect(computeReadiness(rows).status).toBe("ready");
    const input = assembleEngineInput(rows);
    const out = runUnderwriting(input);
    const tdc = out.values.tdc;
    expect(Math.round(tdc)).toBe(346_250_000); // reserves (15.5M) included in TDC
    expect(Math.round(out.values.egi)).toBe(27_380_800); // component occupancy preserved
  });
});

// ---------- Test 9: industrial findings ----------
describe("Summit Point industrial findings", () => {
  test("detects concentration, cap sensitivity, cold-storage, rate-lock, infrastructure timing", () => {
    const normalized: NormalizedFindingsInput = {
      base: { dscr: 1.1, projected_profit: 10_000_000 },
      scenarios: { cap_expansion: { projected_profit: -5_000_000 } },
      assumptions: [
        { field_key: "tenant_concentration_pct", value_numeric: 64, status: "approved" },
        { field_key: "cold_storage_sf", value_numeric: 280000, status: "approved" },
        { field_key: "offsite_improvements", value_numeric: 9_000_000, status: "approved" },
        { field_key: "tenant_termination_option_year", value_numeric: 6, status: "approved" },
        { field_key: "interest_rate", value_numeric: 7.15, status: "approved", source_location: "Summit_Point_Rate_Lock_Addendum.pdf" },
      ],
      input: {
        revenueProgram: [
          { unitType: "Dry Warehouse", unitCount: 1, avgSf: 760000, rent: 18.5, rentBasis: "per_sf", occupancyPct: 96 },
          { unitType: "Cold Storage", unitCount: 1, avgSf: 280000, rent: 31, rentBasis: "per_sf", occupancyPct: 94 },
        ],
        holdYears: 5,
      } as NormalizedFindingsInput["input"],
      risks: [],
      reconciliation: [],
    };
    const ids = industrialFindings(normalized).map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining([
      "industrial.tenant_concentration",
      "industrial.cap_sensitivity",
      "industrial.cold_storage_retenanting",
      "industrial.rate_lock",
      "industrial.infrastructure_timing",
      "industrial.termination_option",
    ]));
  });

  test("generateFindings runs end-to-end on Summit engine output without throwing", () => {
    const out = runUnderwriting(assembleEngineInput(summitRows()));
    const report = generateFindings(out, [
      { field_key: "tenant_concentration_pct", value_numeric: 64, status: "approved" },
      { field_key: "cold_storage_sf", value_numeric: 280000, status: "approved" },
    ], [], { input: assembleEngineInput(summitRows()) });
    expect(report.recommendation).toBeDefined();
    expect(Array.isArray(report.risks)).toBe(true);
  });
});
