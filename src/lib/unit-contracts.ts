import type { AllowedValue, TokenUnit } from "./engine/provenance";
import type { MetricOutput } from "./engine/types";
import { ASSUMPTION_BY_KEY } from "./assumption-taxonomy";
import {
  TAXONOMY_TO_ENGINE_SCALAR,
  TAXONOMY_TO_REVENUE_FIELD,
  type RevenueComponentMap,
} from "./taxonomy-engine-map";

export const CANONICAL_UNITS = [
  "$",
  "%",
  "x",
  "bps",
  "mo",
  "yr",
  "units",
  "count",
  "SF",
  "$/SF",
  "text",
  "number",
] as const;

export type CanonicalUnit = (typeof CANONICAL_UNITS)[number];

export const CANONICAL_UNIT_SQL_LIST = CANONICAL_UNITS.map((unit) => `'${unit}'`).join(", ");

const CANONICAL_UNIT_SET = new Set<string>(CANONICAL_UNITS);

export function isCanonicalUnit(unit: unknown): unit is CanonicalUnit {
  return typeof unit === "string" && CANONICAL_UNIT_SET.has(unit);
}

export function tokenUnitForCanonicalUnit(unit: unknown): TokenUnit | undefined {
  return unit === "$" || unit === "%" || unit === "x" || unit === "bps" ? unit : undefined;
}

export function allowedValueForUnit(value: unknown, unit: unknown): AllowedValue | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (unit != null && !isCanonicalUnit(unit)) return null;
  const tokenUnit = tokenUnitForCanonicalUnit(unit);
  return tokenUnit ? { value: numeric, unit: tokenUnit } : numeric;
}

const ENGINE_SCALAR_UNITS = {
  loan_amount: "$",
  equity_amount: "$",
  interest_rate_pct: "%",
  amort_years: "yr",
  min_dscr: "x",
  min_all_in_dscr: "x",
  exit_cap_rate_pct: "%",
  stabilized_occupancy_pct: "%",
  expense_ratio_pct: "%",
  hold_years: "yr",
  selling_costs_pct: "%",
  rent_growth_pct: "%",
  lease_up_months: "mo",
  stated_ltc_pct: "%",
  stated_total_project_cost: "$",
  lender_stabilized_occupancy_pct: "%",
  other_income_annual: "$",
  min_debt_yield: "%",
  equity_draw_months: "mo",
  lease_up_curve: "count",
  mezz_loan_amount: "$",
  mezz_interest_rate_pct: "%",
  mezz_amort_years: "yr",
  mezz_io_months: "mo",
  lp_equity_pct: "%",
  gp_equity_pct: "%",
  preferred_return_pct: "%",
  gp_catch_up_pct: "%",
  promote_tier1_hurdle_pct: "%",
  promote_tier1_gp_pct: "%",
  promote_tier2_hurdle_pct: "%",
  promote_tier2_gp_pct: "%",
  monthly_model: "count",
  construction_s_curve: "count",
  refinance_month: "mo",
  refinance_amount: "$",
  refinance_ltv_pct: "%",
  refinance_rate_pct: "%",
  refinance_amort_years: "yr",
  refinance_io_months: "mo",
} as const satisfies Record<string, CanonicalUnit>;

export type EngineScalarKey = keyof typeof ENGINE_SCALAR_UNITS;

export function expectedUnitForEngineScalar(key: string): CanonicalUnit | null {
  return (ENGINE_SCALAR_UNITS as Record<string, CanonicalUnit>)[key] ?? null;
}

function expectedRevenueUnit(map: RevenueComponentMap): CanonicalUnit {
  if (map.field === "unit_count") return "units";
  if (map.field === "avg_sf") return "SF";
  if (map.field === "occupancy_pct") return "%";
  return map.basis === "per_sf" ? "$/SF" : "$";
}

export type UnitContractIssue = {
  key: string;
  expected: CanonicalUnit | null;
  actual: string | null;
  surface: "taxonomy" | "engine_scalar" | "revenue_program" | "financial_output";
  message: string;
};

export function assertTaxonomyEngineUnitConsistency(): UnitContractIssue[] {
  const issues: UnitContractIssue[] = [];

  for (const [taxonomyKey, engineKey] of Object.entries(TAXONOMY_TO_ENGINE_SCALAR)) {
    const def = ASSUMPTION_BY_KEY[taxonomyKey];
    const expected = expectedUnitForEngineScalar(engineKey);
    if (!def || !expected || def.unit !== expected) {
      issues.push({
        key: taxonomyKey,
        expected,
        actual: def?.unit ?? null,
        surface: "engine_scalar",
        message: `${taxonomyKey} maps to ${engineKey}, expected ${expected ?? "registered unit"} but taxonomy declares ${def?.unit ?? "missing"}.`,
      });
    }
  }

  for (const [taxonomyKey, revenueMap] of Object.entries(TAXONOMY_TO_REVENUE_FIELD)) {
    const def = ASSUMPTION_BY_KEY[taxonomyKey];
    const expected = expectedRevenueUnit(revenueMap);
    if (!def || def.unit !== expected) {
      issues.push({
        key: taxonomyKey,
        expected,
        actual: def?.unit ?? null,
        surface: "revenue_program",
        message: `${taxonomyKey} maps to ${revenueMap.field}/${revenueMap.basis}, expected ${expected} but taxonomy declares ${def?.unit ?? "missing"}.`,
      });
    }
  }

  return issues;
}

export type PersistedAssumptionUnitRow = {
  field_key: string;
  unit: string | null;
};

export function validatePersistedAssumptionUnits(
  rows: PersistedAssumptionUnitRow[],
): UnitContractIssue[] {
  return rows.flatMap((row): UnitContractIssue[] => {
    const def = ASSUMPTION_BY_KEY[row.field_key];
    if (!def) {
      return [
        {
          key: row.field_key,
          expected: null,
          actual: row.unit,
          surface: "taxonomy" as const,
          message: `${row.field_key} is not a registered taxonomy key.`,
        },
      ];
    }
    if (row.unit !== def.unit) {
      return [
        {
          key: row.field_key,
          expected: def.unit as CanonicalUnit,
          actual: row.unit,
          surface: "taxonomy" as const,
          message: `${row.field_key} persisted as ${row.unit ?? "null"} but taxonomy requires ${def.unit}.`,
        },
      ];
    }
    return [];
  });
}

export type FinancialOutputUnitRow = Pick<MetricOutput, "key" | "unit">;

export function validateFinancialOutputUnits(rows: FinancialOutputUnitRow[]): UnitContractIssue[] {
  return rows
    .filter((row) => !isCanonicalUnit(row.unit))
    .map((row) => ({
      key: row.key,
      expected: null,
      actual: row.unit,
      surface: "financial_output" as const,
      message: `${row.key} emits non-canonical unit ${row.unit}.`,
    }));
}
