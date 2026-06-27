// Quick-start estimator for dashboard cards only. It derives indicative
// metrics from the analyst-entered project columns (acquisition cost, debt,
// equity, ...) via the deterministic engine. It is NOT the underwriting of
// record: the underwriting tab is fed exclusively by loadEngineInput over
// approved/default_accepted rows and is fail-closed.

import { DEFAULTS, runUnderwriting, type UnderwritingInput } from "./engine";

export type ProjectInput = {
  acquisition_cost?: number | string | null;
  construction_cost?: number | string | null;
  revenue_forecast?: number | string | null;
  debt_amount?: number | string | null;
  equity_amount?: number | string | null;
  interest_rate?: number | string | null;
};

export type ProjectScenario = {
  revenue_change?: number;
  cost_change?: number;
  interest_rate_change?: number;
  exit_cap_rate_pct?: number;
  rent_growth_pct?: number;
  occupancy_pct?: number;
};

const num = (v: number | string | null | undefined) => Number(v ?? 0) || 0;

// Defaults shared with the canonical DEFAULTS table where keys overlap;
// estimator-only knobs (soft/contingency % of hard) live here.
export const QUICK_START_DEFAULTS = {
  stabilizedOccupancyPct: 95,
  expenseRatioPct: DEFAULTS.expense_ratio_pct.value,
  softCostPctOfHard: 15,
  contingencyPctOfHard: 5,
  constructionMonths: 18,
  leaseUpMonths: DEFAULTS.lease_up_months.value,
  exitCapRatePct: 5,
  avgOutstandingFactor: 0.55,
  sellingCostsPct: 0,
  holdYears: 1,
  amortYears: 30,
  ioMonths: 12,
};

export function quickStartUnderwritingInput(
  project: ProjectInput,
  scenario: ProjectScenario = {},
): UnderwritingInput {
  const land = num(project.acquisition_cost) * (1 + (scenario.cost_change ?? 0) / 100);
  const hard = num(project.construction_cost) * (1 + (scenario.cost_change ?? 0) / 100);
  const annualRevenue = num(project.revenue_forecast) * (1 + (scenario.revenue_change ?? 0) / 100);
  const occupancy = scenario.occupancy_pct ?? QUICK_START_DEFAULTS.stabilizedOccupancyPct;
  const gprProxy = occupancy > 0 ? annualRevenue / (occupancy / 100) : annualRevenue;

  return {
    budget: {
      land,
      hard,
      soft: hard * (QUICK_START_DEFAULTS.softCostPctOfHard / 100),
      contingency: hard * (QUICK_START_DEFAULTS.contingencyPctOfHard / 100),
    },
    revenueProgram: [
      {
        unitType: "Quick Start GPR proxy",
        unitCount: 1,
        rent: gprProxy / 12,
        rentBasis: "per_unit",
      },
    ],
    constructionMonths: QUICK_START_DEFAULTS.constructionMonths,
    leaseUpMonths: QUICK_START_DEFAULTS.leaseUpMonths,
    stabilizedOccupancyPct: occupancy,
    expenseRatioPct: QUICK_START_DEFAULTS.expenseRatioPct,
    otherIncomeAnnual: 0,
    exitCapRatePct: scenario.exit_cap_rate_pct ?? QUICK_START_DEFAULTS.exitCapRatePct,
    loanAmount: num(project.debt_amount),
    interestRatePct: num(project.interest_rate) + (scenario.interest_rate_change ?? 0),
    amortYears: QUICK_START_DEFAULTS.amortYears,
    ioMonths: QUICK_START_DEFAULTS.ioMonths,
    avgOutstandingFactor: QUICK_START_DEFAULTS.avgOutstandingFactor,
    sellingCostsPct: QUICK_START_DEFAULTS.sellingCostsPct,
    holdYears: QUICK_START_DEFAULTS.holdYears,
    equityAmount: num(project.equity_amount) || null,
    rentGrowthPct: scenario.rent_growth_pct ?? 0,
    expenseGrowthPct: 0,
  };
}

export function deriveQuickStartMetrics(project: ProjectInput, scenario?: ProjectScenario) {
  const output = runUnderwriting(quickStartUnderwritingInput(project, scenario));
  return {
    totalCost: output.values.tdc,
    projectedRevenue: output.values.egi,
    projectedProfit: output.values.developmentProfit,
    profitMargin: output.values.profitOnCostPct,
    equityRequirement: output.values.equity,
    ltc: output.values.ltcPct,
    dscr: output.values.dscr,
    irr: output.values.irrPct,
    coc: output.values.cashOnCashPct,
    yieldOnCost: output.values.yieldOnCostPct,
    developmentSpread: output.values.developmentSpreadBps,
    exitValue: output.values.exitValue,
    stabilizedNoi: output.values.noi,
  };
}

export const fmtCurrency = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n || 0);
export const fmtPct = (n: number) => `${Number(n || 0).toFixed(2)}%`;
export const fmtCompact = (n: number) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
    style: "currency",
    currency: "USD",
  }).format(n || 0);
