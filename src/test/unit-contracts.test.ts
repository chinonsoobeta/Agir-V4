import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { runUnderwriting } from "@/lib/engine";
import type { MetricOutput } from "@/lib/engine/types";
import { ASSUMPTION_DEFS } from "@/lib/assumption-taxonomy";
import {
  assertTaxonomyEngineUnitConsistency,
  CANONICAL_UNITS,
  expectedUnitForEngineScalar,
  isCanonicalUnit,
  validateFinancialOutputUnits,
  validatePersistedAssumptionUnits,
  allowedValueForUnit,
} from "@/lib/unit-contracts";

describe("canonical unit contracts", () => {
  test("taxonomy-to-engine and taxonomy-to-revenue mappings preserve units", () => {
    expect(assertTaxonomyEngineUnitConsistency()).toEqual([]);
    expect(expectedUnitForEngineScalar("min_all_in_dscr")).toBe("x");
    expect(expectedUnitForEngineScalar("refinance_amount")).toBe("$");
  });

  test("persisted assumptions must carry the taxonomy unit for their field key", () => {
    const rows = ASSUMPTION_DEFS.map((def) => ({ field_key: def.key, unit: def.unit }));
    expect(validatePersistedAssumptionUnits(rows)).toEqual([]);

    expect(
      validatePersistedAssumptionUnits([
        { field_key: "retail_rent_psf", unit: "$" },
        { field_key: "min_all_in_dscr", unit: "%" },
        { field_key: "residential_rent_monthly", unit: "$/SF" },
      ]).map((issue) => issue.key),
    ).toEqual(["retail_rent_psf", "min_all_in_dscr", "residential_rent_monthly"]);
  });

  test("unit validator catches arbitrary wrong canonical units", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ASSUMPTION_DEFS),
        fc.constantFrom(...CANONICAL_UNITS),
        (def, unit) => {
          const issues = validatePersistedAssumptionUnits([{ field_key: def.key, unit }]);
          expect(issues.length === 0).toBe(unit === def.unit);
        },
      ),
      { seed: 0x51a1e, numRuns: 300 },
    );
  });

  test("financial output metrics emit canonical units", () => {
    const out = runUnderwriting({
      budget: { land: 5_000_000, hard: 20_000_000, soft: 3_000_000, contingency: 1_000_000 },
      revenueProgram: [
        { unitType: "Residential", unitCount: 120, rent: 3_000, rentBasis: "per_unit" },
      ],
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
      equityAmount: 11_000_000,
      rentGrowthPct: 3,
      expenseGrowthPct: 2,
    });

    expect(validateFinancialOutputUnits(out.metrics)).toEqual([]);
    const bad: MetricOutput = { ...out.metrics[0], unit: "$/mo" as MetricOutput["unit"] };
    expect(validateFinancialOutputUnits([bad])[0].actual).toBe("$/mo");
    expect(allowedValueForUnit(100, "$/mo")).toBeNull();
    expect(allowedValueForUnit(100, undefined)).toBe(100);
  });

  test("database migration uses the same canonical unit vocabulary", async () => {
    const sql = await readFile(
      new URL(
        "../../supabase/migrations/20260629000100_canonical_unit_constraints.sql",
        import.meta.url,
      ),
      "utf8",
    );
    for (const unit of CANONICAL_UNITS) {
      expect(sql).toContain(`'${unit}'`);
      expect(isCanonicalUnit(unit)).toBe(true);
    }
  });
});
