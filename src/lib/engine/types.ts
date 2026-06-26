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

// 1C. A single refinance event during the hold (rate-and-term and/or cash-out).
// At `month` the senior loan's outstanding balance is paid off and replaced by a
// new loan; the net (new proceeds - old payoff) flows to or from equity.
export type RefinanceInput = {
  // Month from t0 at which the senior loan is refinanced. Must fall after
  // construction. Absent / <= 0 => no refinance.
  month: number;
  // New senior loan size: an explicit amount, or an LTV applied to the value
  // implied by the in-place NOI and exit cap. `newAmount` wins when both set.
  newAmount?: number | null;
  ltvPct?: number | null;
  ratePct: number;
  amortYears: number;
  ioMonths: number;
};

// A sandboxed, analyst-defined custom line item. The expression is evaluated by
// engine/expression.ts against existing node values only; the expression string
// IS the formula_text, so it can never mint a value from nothing.
export type CustomLineInput = {
  // Stable slug used for the node line key and the metric key (custom_<key>).
  key: string;
  label: string;
  expression: string;
  // Optional active window in months from t0. Absent => every operating period.
  fromMonth?: number | null;
  toMonth?: number | null;
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
  // ---- Monthly cash-flow spine (Workstream 1, additive, OFF by default) ----
  // Master switch. Absent/false => the annual engine path runs untouched and the
  // output is byte-identical. True => the annual figures are a roll-up of a
  // monthly spine and the precision features below can take effect.
  monthlyModel?: boolean | null;
  // 1A. Construction draw shape (only meaningful when monthlyModel is on).
  // Absent/"straight_line" => straight-line draws. "s_curve" => smoothstep draws
  // with construction interest computed on the actual monthly outstanding balance.
  constructionDrawCurve?: "straight_line" | "s_curve" | null;
  // 1C. A single refinance event during the hold. Absent => no refinance.
  refinance?: RefinanceInput | null;
  // Sandboxed, analyst-defined custom line items (the expression IS the formula).
  customLines?: CustomLineInput[] | null;
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

// ---- Monthly cash-flow spine (Workstream 1) -------------------------------
// A period-indexed line item. Each node is a pure function of approved inputs
// and other nodes, carries a readable formula_text, and resolves to a
// provenance-admissible value.
export type ScheduleLineKey =
  | "land_draw"
  | "hard_draw"
  | "soft_draw"
  | "contingency_draw"
  | "construction_interest"
  | "equity_contribution"
  | "gpr"
  | "egi"
  | "opex"
  | "noi"
  | "senior_interest"
  | "senior_principal"
  | "senior_debt_service"
  | "mezz_interest"
  | "mezz_principal"
  | "mezz_debt_service"
  | "levered_cf"
  | "distribution"
  | "refi_proceeds"
  | "refi_payoff"
  | "refi_cash_out"
  | "sale"
  | "loan_payoff"
  | "custom";

export type PeriodNode = {
  // 0-based month index from t0 (acquisition / construction start).
  period: number;
  lineKey: ScheduleLineKey;
  // Stable slug. Equals lineKey for built-in lines; custom_<slug> for custom lines.
  key: string;
  label: string;
  amount: number;
  formula_text: string;
};

// A roll-up reconciliation row: the annual backbone figure vs the sum of the
// monthly nodes for the same concept, with the documented tolerance verdict.
export type ScheduleReconciliation = {
  key: string;
  label: string;
  annual: number;
  rolledUp: number;
  diff: number;
  withinTolerance: boolean;
};

export type MonthlySchedule = {
  months: number;
  constructionMonths: number;
  leaseUpMonths: number;
  holdMonths: number;
  nodes: PeriodNode[];
  reconciliation: ScheduleReconciliation[];
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
  // Present ONLY when the deal opts into the monthly spine (monthlyModel). A
  // deal that does not opt in returns no schedule and is byte-identical to today.
  schedule?: MonthlySchedule;
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
    // ---- Monthly spine (WS1): OPTIONAL, set ONLY when monthlyModel is on, so a
    // deal that does not opt in carries none of these keys (byte-identical). ----
    // 1A. Construction interest on the actual monthly outstanding balance.
    scheduleConstructionInterest?: number;
    // The monthly model's levered IRR, reflecting whichever precision features
    // are active (S-curve carry, lease-up absorption, refinance). Equals the
    // annual deal IRR when monthly mode is on but every feature is off.
    scheduleLeveredIrrPct?: number;
    // 1C. Refinance event figures (present only when a refinance is configured).
    refiCashOut?: number;
    refiNewLoanAmount?: number;
    refiNewAnnualDebtService?: number;
    postRefiDscr?: number;
  };
};
