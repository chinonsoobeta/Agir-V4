import type { WaterfallConfig } from "./waterfall";

export type SourceKind = "extracted" | "analyst" | "default";

export type BudgetInput = {
  land: number;
  hard: number;
  soft: number;
  contingency: number;
  financingInterest?: number;
  other?: number;
};

export type RevenueUnitInput = {
  unitType: string;
  unitCount: number;
  avgSf?: number | null;
  // per_unit: rent is $/unit/month. per_sf: rent is ANNUAL $/SF applied to avgSf.
  rent: number;
  rentBasis: "per_unit" | "per_sf";
  // Component-level stabilized occupancy. Falls back to the project-level
  // stabilizedOccupancyPct only when null.
  occupancyPct?: number | null;
};

// A subordinate debt tranche (e.g. mezzanine). Senior debt stays the top-level
// loanAmount/interestRatePct/amortYears/ioMonths fields; this is anything below
// it in the capital stack.
export type MezzanineInput = {
  amount: number;
  ratePct: number;
  amortYears: number;
  ioMonths: number;
};

export type UnderwritingInput = {
  budget: BudgetInput;
  revenueProgram: RevenueUnitInput[];
  constructionMonths: number;
  leaseUpMonths: number;
  stabilizedOccupancyPct: number;
  expenseRatioPct: number;
  otherIncomeAnnual: number;
  exitCapRatePct: number;
  loanAmount: number;
  interestRatePct: number;
  amortYears: number;
  ioMonths: number;
  avgOutstandingFactor: number;
  sellingCostsPct: number;
  holdYears: number;
  equityAmount?: number | null;
  rentGrowthPct: number;
  expenseGrowthPct: number;
  // ---- IC-grade extensions (all optional; absent => today's behavior) ----
  // 1A. Months over which equity is drawn straight-line. Absent/0 => a single
  // lump sum at t=0 (the conservative default).
  equityDrawMonths?: number | null;
  // 1B. A mezzanine (or other subordinate) tranche. Absent => senior-only.
  mezzanine?: MezzanineInput | null;
  // 1C. LP/GP distribution waterfall. Absent => LP holds the whole deal.
  waterfall?: WaterfallConfig | null;
  // 1D. Credit partial operating income earned during lease-up (a linear
  // absorption ramp). Absent/false => the conservative full-delay model.
  leaseUpCurve?: boolean | null;
};

export type MetricOutput = {
  key: string;
  label: string;
  value: number;
  unit: "$" | "%" | "x" | "bps" | "count";
  formula: string;
};

export type CashFlowLineKey =
  | "equity"
  | "construction"
  | "interest"
  | "gross_revenue"
  | "egi"
  | "opex"
  | "noi"
  | "debt_service"
  | "levered_cf"
  | "sale_proceeds"
  | "loan_payoff";

export type CashFlowRow = {
  periodYear: number;
  lineKey: CashFlowLineKey;
  amount: number;
};

export type EngineWarning = {
  key: string;
  message: string;
  expected?: number;
  actual?: number;
};

export type EngineOutput = {
  metrics: MetricOutput[];
  cashFlows: CashFlowRow[];
  warnings: EngineWarning[];
  irrStatus: "computed" | "not_meaningful";
  equityWipeout: boolean;
  values: {
    tdcPreFinancing: number;
    interestReserve: number;
    tdc: number;
    gpr: number;
    egi: number;
    opex: number;
    noi: number;
    effectiveOccupancyPct: number;
    yieldOnCostPct: number;
    developmentSpreadBps: number;
    exitValue: number;
    netSaleBeforeDebt: number;
    loanPayoffAtExit: number;
    saleProceedsToEquity: number;
    developmentProfit: number;
    profitOnCostPct: number;
    costPerUnit: number;
    equity: number;
    requiredEquity: number;
    ltcPct: number;
    annualDebtService: number;
    dscr: number;
    interestOnlyDscr: number;
    cashOnCashPct: number;
    cumulativeCashShortfall: number;
    equityMultiple: number;
    irrPct: number;
    debtYieldPct: number;
    breakEvenOccupancyPct: number;
    // ---- Multi-tranche debt (1B): equal today's senior figures when no mezz ----
    totalDebt: number;
    seniorDebtService: number;
    mezzDebtService: number;
    totalDebtService: number;
    seniorDscr: number;
    allInDscr: number;
    // ---- LP/GP waterfall (1C): equal the deal-level figures when no promote ----
    lpIrrPct: number;
    lpEquityMultiple: number;
    lpPreferredReturn: number;
    gpIrrPct: number;
    gpEquityMultiple: number;
    gpPromote: number;
    // ---- Lease-up absorption (1D): equals the deal IRR when off / no lease-up ----
    leaseUpAdjustedIrrPct: number;
  };
};
