export { annualDebtService, interestOnlyDebtService, loanBalanceAfterYears, loanBalanceSchedule } from "./debt";
export { irr } from "./metrics";
export { runEuropeanWaterfall, type TimedCashFlow, type WaterfallResult } from "./waterfall";
export { runUnderwriting, componentGpr } from "./proforma";
export type {
  EngineOutput,
  UnderwritingInput,
  RevenueUnitInput,
  BudgetInput,
  DebtTrancheInput,
  PromoteTierInput,
  WaterfallInput,
} from "./types";
export { STRESS_PRESETS, applyStress, type StressPreset } from "./scenarios";
export {
  ENGINE_READABLE_STATUSES,
  REQUIRED_BUDGET_CATEGORIES,
  REQUIRED_SCALAR_KEYS,
  DEFAULTS,
  computeReadiness,
  assembleEngineInput,
  conservativePick,
  deriveCalculatedTdc,
  UnderwritingBlockedError,
  type EngineInputStatus,
  type ProjectInputRows,
  type ScalarInputRow,
  type BudgetLineRow,
  type RevenueComponentRow,
  type Readiness,
} from "./input-assembly";
export {
  runReconciliationChecks,
  computeRiskScore,
  deriveRiskRegister,
  type ReconciliationFlag,
  type ReconciliationContext,
  type RiskEntry,
} from "./reconciliation";
export {
  collectNumericTokens,
  buildAllowedValues,
  verifyNumericProvenance,
  type ProvenanceReport,
  type AllowedValue,
  type TokenUnit,
} from "./provenance";

// Golden fixture 1: Maple Heights: marginal deal, correct math.
export function mapleHeightsInput() {
  return {
    budget: {
      land: 8_500_000,
      hard: 28_000_000,
      soft: 4_000_000,
      contingency: 0,
      financingInterest: 2_000_000,
    },
    revenueProgram: [
      { unitType: "1BR", unitCount: 60, rent: 2_200, rentBasis: "per_unit" as const },
      { unitType: "2BR", unitCount: 50, rent: 2_600, rentBasis: "per_unit" as const },
      { unitType: "3BR", unitCount: 10, rent: 3_200, rentBasis: "per_unit" as const },
    ],
    constructionMonths: 18,
    leaseUpMonths: 12,
    stabilizedOccupancyPct: 95,
    expenseRatioPct: 35,
    otherIncomeAnnual: 0,
    exitCapRatePct: 5,
    loanAmount: 27_625_000,
    interestRatePct: 6,
    amortYears: 30,
    ioMonths: 12,
    avgOutstandingFactor: 0.55,
    sellingCostsPct: 0,
    holdYears: 1,
    equityAmount: 14_875_000,
    rentGrowthPct: 0,
    expenseGrowthPct: 0,
  };
}
