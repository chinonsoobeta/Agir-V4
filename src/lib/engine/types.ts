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

export type DebtTrancheInput = {
  name: "senior" | "mezzanine";
  amount: number;
  interestRatePct: number;
  amortYears: number;
  ioMonths: number;
};

export type PromoteTierInput = {
  hurdleRatePct: number;
  gpSplitPct: number;
};

export type WaterfallInput = {
  lpEquityPct: number;
  preferredReturnPct: number;
  gpCatchUp: boolean;
  promoteTiers: PromoteTierInput[];
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
  phaseEquityDraws?: boolean;
  mezzanine?: Omit<DebtTrancheInput, "name"> | null;
  waterfall?: WaterfallInput | null;
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
    totalDebt: number;
    seniorAnnualDebtService: number;
    allInAnnualDebtService: number;
    seniorDscr: number;
    allInDscr: number;
    lpIrrPct: number;
    lpEquityMultiple: number;
    gpIrrPct: number;
    gpEquityMultiple: number;
    gpPromote: number;
  };
};
