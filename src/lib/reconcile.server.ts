export type ReconciliationFlag = {
  check_key: string;
  severity: "info" | "warning" | "error";
  message: string;
  expected?: number;
  actual?: number;
};

// Gross potential rent from rent-roll rows, matching the engine's componentGpr
// convention EXACTLY (engine/proforma.ts, engine/input-assembly.ts:46): a per_sf
// row stores ANNUAL $/SF, so GPR = count x SF x rent with NO x12; only a per_unit
// row's rent is $/unit/MONTH and is annualized (count x rent x 12). Kept here as
// the single source of truth so the gpr_vs_revenue reconciliation check can never
// drift from how the underwriting engine computes the same figure.
export function computeRevenueGpr(
  rows: {
    rent_basis?: string | null;
    avg_sf?: number | null;
    market_rent_monthly?: number | null;
    unit_count?: number | null;
  }[],
): number {
  return rows.reduce((sum, row) => {
    const sf = Number(row.avg_sf ?? 0);
    const rent = Number(row.market_rent_monthly ?? 0);
    const count = Number(row.unit_count ?? 0);
    return sum + (row.rent_basis === "per_sf" ? count * sf * rent : count * rent * 12);
  }, 0);
}

function severityFor(deltaPct: number): ReconciliationFlag["severity"] {
  if (deltaPct > 10) return "error";
  if (deltaPct > 5) return "warning";
  return "info";
}

export function reconcileDevelopmentInputs(input: {
  budgetTotal: number;
  statedTdc?: number | null;
  equity?: number | null;
  loan?: number | null;
  statedRevenue?: number | null;
  computedGpr?: number | null;
}) {
  const flags: ReconciliationFlag[] = [];
  const compare = (check_key: string, label: string, expected?: number | null, actual?: number | null) => {
    if (!expected || !actual) return;
    const deltaPct = Math.abs(actual - expected) / Math.abs(expected) * 100;
    if (deltaPct <= 5) return;
    flags.push({
      check_key,
      severity: severityFor(deltaPct),
      message: `${label} differs by ${deltaPct.toFixed(1)}%.`,
      expected,
      actual,
    });
  };
  compare("budget_vs_tdc", "Budget total and stated TDC", input.statedTdc, input.budgetTotal);
  compare("sources_vs_uses", "Equity plus loan and stated TDC", input.statedTdc, (input.equity ?? 0) + (input.loan ?? 0));
  compare("gpr_vs_revenue", "Rent program GPR and stated revenue", input.statedRevenue, input.computedGpr);
  return flags;
}

