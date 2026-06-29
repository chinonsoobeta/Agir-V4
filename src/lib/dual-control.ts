// Material fields that require a two-person rule when an analyst overrides the
// extracted value. These are the assumptions that most directly move the
// verdict -- debt sizing/pricing, equity, cap rate, and the lender coverage
// gates -- so a single analyst cannot unilaterally push an override into the
// engine. A second, different approver must confirm.
//
// Keys mirror the canonical taxonomy in assumption-taxonomy.ts.
export const MATERIAL_OVERRIDE_KEYS: ReadonlySet<string> = new Set([
  // Debt
  "debt_amount",
  "interest_rate",
  "ltc",
  "amortization_years",
  "mezz_debt_amount",
  "mezz_interest_rate",
  "refinance_amount",
  "refinance_rate",
  "refinance_ltv_pct",
  "min_dscr",
  "min_all_in_dscr",
  "min_debt_yield",
  // Equity / waterfall
  "equity_amount",
  "lp_equity_pct",
  "gp_equity_pct",
  "preferred_return_pct",
  "gp_catch_up_pct",
  // Valuation / exit
  "exit_cap_rate",
  "total_project_cost",
]);

export function isMaterialOverrideField(fieldKey: string | null | undefined): boolean {
  return !!fieldKey && MATERIAL_OVERRIDE_KEYS.has(fieldKey);
}
