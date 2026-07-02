import { TOLERANCE_POLICY } from "./tolerance-policy";

export type ReconciliationCheckDefinition = {
  key: string;
  severity: "info" | "warning" | "error" | "mixed";
  tolerance: string;
  description: string;
  keyPrefix?: string;
};

// `satisfies` (not a type annotation) so the trailing `as const` keeps the
// literal key union for ReconciliationCheckKey instead of widening to string.
export const RECONCILIATION_CHECKS = [
  {
    key: "sources_vs_uses",
    severity: "mixed",
    tolerance: `$${TOLERANCE_POLICY.moneyAbsoluteDollars}`,
    description: "Equity plus senior debt must fund total development cost.",
  },
  {
    key: "ltc_consistency",
    severity: "error",
    tolerance: `${TOLERANCE_POLICY.ltcPctPoints} percentage point`,
    description: "Stated LTC must reconcile to senior loan divided by TDC.",
  },
  {
    key: "covenant_feasibility",
    severity: "error",
    tolerance: "$0 NOI shortfall",
    description: "Senior DSCR covenant must be supportable by engine NOI.",
  },
  {
    key: "all_in_dscr_covenant",
    severity: "error",
    tolerance: "0.00x shortfall",
    description: "Optional whole-stack DSCR covenant must clear total debt service.",
  },
  {
    key: "debt_yield_covenant",
    severity: "error",
    tolerance: "0.00 percentage point shortfall",
    description: "Debt yield covenant must clear lender minimum debt yield.",
  },
  {
    key: "occupancy_vs_lender",
    keyPrefix: "occupancy_vs_lender:",
    severity: "warning",
    tolerance: "0.00 percentage point shortfall",
    description: "Component occupancy should meet the lender stabilization requirement.",
  },
  {
    key: "budget_vs_stated_total",
    severity: "mixed",
    tolerance: `${(TOLERANCE_POLICY.budgetStatedTotalRelative * 100).toFixed(1)}% relative`,
    description: "Budget line sum must reconcile to any stated total project cost.",
  },
  {
    key: "unit_count_consistency",
    severity: "error",
    tolerance: "0 units",
    description: "Unit counts from documents must agree exactly.",
  },
] as const satisfies readonly ReconciliationCheckDefinition[];

export type ReconciliationCheckKey = (typeof RECONCILIATION_CHECKS)[number]["key"];

export function reconciliationDefinitionFor(checkKey: string) {
  // Widen to the interface so the optional keyPrefix is accessible on every
  // member of the literal union.
  const defs: readonly ReconciliationCheckDefinition[] = RECONCILIATION_CHECKS;
  return defs.find(
    (def) => def.key === checkKey || (def.keyPrefix && checkKey.startsWith(def.keyPrefix)),
  );
}

export function isRegisteredReconciliationCheck(checkKey: string): boolean {
  return reconciliationDefinitionFor(checkKey) != null;
}
