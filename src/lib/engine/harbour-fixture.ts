// Golden fixture 2: Harbour Centre: a catastrophic deal whose documents were
// verified by hand. These are the ONLY numbers extraction may produce for this
// project; anything else (a 5.35% cap, a shrunken budget, 222 units, phantom
// other income) is a fabrication and a test failure.

import type { BudgetLineRow, ProjectInputRows, RevenueComponentRow, ScalarInputRow } from "./input-assembly";

export const HARBOUR_BUDGET_LINES: BudgetLineRow[] = [
  { category: "land", label: "Land acquisition", amount: 34_500_000, status: "approved" },
  { category: "hard", label: "Hard costs", amount: 162_000_000, status: "approved" },
  { category: "soft", label: "Soft costs", amount: 27_500_000, status: "approved" },
  { category: "financing_interest", label: "Financing costs", amount: 18_000_000, status: "approved" },
  { category: "contingency", label: "Contingency", amount: 8_000_000, status: "approved" },
];

export const HARBOUR_REVENUE_COMPONENTS: RevenueComponentRow[] = [
  { unit_type: "Residential", unit_count: 220, avg_sf: null, rent: 3_050, rent_basis: "per_unit", occupancy_pct: 96, status: "approved" },
  { unit_type: "Retail", unit_count: 1, avg_sf: 18_000, rent: 42, rent_basis: "per_sf", occupancy_pct: 92, status: "approved" },
  { unit_type: "Office", unit_count: 1, avg_sf: 32_000, rent: 36, rent_basis: "per_sf", occupancy_pct: 85, status: "approved" },
];

// Exit cap is a documented CONFLICT: broker opinion 4.75% vs lender term sheet
// 5.25%. It must surface as conflicting and block readiness until resolved.
export const HARBOUR_EXIT_CAP_CONFLICT = {
  key: "exit_cap_rate_pct",
  values: [
    { value: 4.75, source: "Harbour_Centre_Broker_Opinion.pdf" },
    { value: 5.25, source: "Harbour_Centre_Lender_Term_Sheet.pdf" },
  ],
};

export const HARBOUR_SCALARS: ScalarInputRow[] = [
  { key: "loan_amount", value_numeric: 162_500_000, status: "approved" },
  { key: "interest_rate_pct", value_numeric: 6.25, status: "approved" },
  { key: "amort_years", value_numeric: 30, status: "approved" },
  { key: "min_dscr", value_numeric: 1.2, status: "approved" },
  { key: "lender_stabilized_occupancy_pct", value_numeric: 93, status: "approved" },
  { key: "equity_amount", value_numeric: 50_000_000, status: "approved" },
  { key: "rent_growth_pct", value_numeric: 3, status: "approved" },
  {
    key: HARBOUR_EXIT_CAP_CONFLICT.key,
    value_numeric: null,
    status: "conflicting",
    conflict_values: HARBOUR_EXIT_CAP_CONFLICT.values,
  },
  // expense_ratio_pct, hold_years, selling_costs_pct are genuinely absent from
  // the documents: they stay missing until the analyst accepts defaults.
];

export function harbourSeedRows(): ProjectInputRows {
  return {
    scalars: HARBOUR_SCALARS.map((r) => ({ ...r, conflict_values: r.conflict_values?.map((c) => ({ ...c })) })),
    budget: HARBOUR_BUDGET_LINES.map((r) => ({ ...r })),
    revenue: HARBOUR_REVENUE_COMPONENTS.map((r) => ({ ...r })),
  };
}
