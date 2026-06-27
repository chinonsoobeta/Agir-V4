// Reconciliation gates: the deterministic cross-checks that catch a deal whose
// inputs do not hang together. Error-severity flags surface in the memo and IC
// views and cannot be silently dropped.

import type { EngineOutput } from "./types";

export type ReconciliationFlag = {
  check_key: string;
  severity: "info" | "warning" | "error";
  message: string;
  expected?: number;
  actual?: number;
};

export type ReconciliationContext = {
  tdc: number;
  equity: number;
  loan: number;
  noi: number;
  amortizingAnnualDebtService: number;
  // Debt service actually in force during the hold. When the loan is
  // interest-only for the entire hold, covenant feasibility is tested against
  // the interest-only payment (what is actually due), not the amortizing
  // constant: otherwise a fully-IO deal that comfortably covers its real debt
  // service is false-failed.
  interestOnlyAnnualDebtService?: number | null;
  ioCoversHold?: boolean | null;
  statedLtcPct?: number | null;
  minDscr?: number | null;
  // Debt-yield covenant (NOI / loan) and the engine's computed debt yield.
  minDebtYield?: number | null;
  debtYieldPct?: number | null;
  lenderStabilizedOccupancyPct?: number | null;
  componentOccupancies?: { unitType: string; occupancyPct: number | null }[];
  statedTotalProjectCost?: number | null;
  statedTotalSource?: string | null; // where the stated total was extracted from
  budgetSum?: number | null;
  unitCounts?: number[]; // unit counts seen across documents; must agree
};

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n));

export function runReconciliationChecks(ctx: ReconciliationContext): ReconciliationFlag[] {
  const flags: ReconciliationFlag[] = [];

  // 1. Sources vs uses: equity + debt must fund TDC.
  const sources = ctx.equity + ctx.loan;
  const gap = ctx.tdc - sources;
  if (Math.abs(gap) > 1) {
    flags.push({
      check_key: "sources_vs_uses",
      severity: gap > 0 ? "error" : "warning",
      message:
        gap > 0
          ? `Funding gap: equity ${fmt(ctx.equity)} + debt ${fmt(ctx.loan)} = ${fmt(sources)} vs TDC ${fmt(ctx.tdc)} → $${fmt(gap)} short.`
          : `Sources exceed uses by $${fmt(-gap)} (equity ${fmt(ctx.equity)} + debt ${fmt(ctx.loan)} vs TDC ${fmt(ctx.tdc)}).`,
      expected: ctx.tdc,
      actual: sources,
    });
  }

  // 2. LTC consistency: stated LTC vs loan / TDC, +/- 1%.
  if (ctx.statedLtcPct != null && ctx.tdc > 0) {
    const computedLtc = (ctx.loan / ctx.tdc) * 100;
    if (Math.abs(computedLtc - ctx.statedLtcPct) > 1) {
      flags.push({
        check_key: "ltc_consistency",
        severity: "error",
        message: `Stated LTC ${ctx.statedLtcPct.toFixed(1)}% differs from loan/TDC ${computedLtc.toFixed(1)}% by more than 1%.`,
        expected: ctx.statedLtcPct,
        actual: computedLtc,
      });
    }
  }

  // 3. Covenant feasibility: required NOI = min DSCR x the debt service in force
  // during the hold. A loan that is interest-only for the entire hold is tested
  // against the interest-only payment (the payment actually due); only when the
  // loan amortizes within the hold is it tested against the amortizing constant.
  const ioCoversHold =
    ctx.ioCoversHold === true &&
    ctx.interestOnlyAnnualDebtService != null &&
    ctx.interestOnlyAnnualDebtService > 0;
  const covenantDebtService = ioCoversHold
    ? ctx.interestOnlyAnnualDebtService!
    : ctx.amortizingAnnualDebtService;
  const covenantBasis = ioCoversHold ? "interest-only payment" : "amortizing ADS";
  if (ctx.minDscr != null && ctx.minDscr > 0 && covenantDebtService > 0) {
    const requiredNoi = ctx.minDscr * covenantDebtService;
    if (ctx.noi < requiredNoi) {
      const shortfallRatio = ctx.noi > 0 ? requiredNoi / ctx.noi : Number.POSITIVE_INFINITY;
      flags.push({
        check_key: "covenant_feasibility",
        severity: "error",
        message: `Debt unsupportable: covenant requires NOI ${fmt(requiredNoi)} (${ctx.minDscr.toFixed(2)}x × ${covenantBasis} ${fmt(covenantDebtService)}) vs engine NOI ${fmt(ctx.noi)}: fails covenant by ${Number.isFinite(shortfallRatio) ? shortfallRatio.toFixed(1) : "∞"}×.`,
        expected: requiredNoi,
        actual: ctx.noi,
      });
    }
  }

  // 3b. Debt-yield covenant: NOI / loan must clear the lender's minimum debt
  // yield. Like the DSCR covenant, a breach is a hard (error) feasibility flag.
  if (
    ctx.minDebtYield != null &&
    ctx.minDebtYield > 0 &&
    ctx.debtYieldPct != null &&
    ctx.debtYieldPct > 0 &&
    ctx.debtYieldPct < ctx.minDebtYield
  ) {
    flags.push({
      check_key: "debt_yield_covenant",
      severity: "error",
      message: `Debt yield ${ctx.debtYieldPct.toFixed(2)}% (NOI / loan) is below the ${ctx.minDebtYield.toFixed(2)}% lender covenant.`,
      expected: ctx.minDebtYield,
      actual: ctx.debtYieldPct,
    });
  }

  // 4. Component occupancy vs lender stabilization requirement.
  if (ctx.lenderStabilizedOccupancyPct != null && ctx.componentOccupancies?.length) {
    for (const component of ctx.componentOccupancies) {
      if (
        component.occupancyPct != null &&
        component.occupancyPct < ctx.lenderStabilizedOccupancyPct
      ) {
        flags.push({
          check_key: `occupancy_vs_lender:${component.unitType}`,
          severity: "warning",
          message: `${component.unitType} stabilized occupancy ${component.occupancyPct.toFixed(1)}% is below the lender stabilization requirement of ${ctx.lenderStabilizedOccupancyPct.toFixed(1)}%.`,
          expected: ctx.lenderStabilizedOccupancyPct,
          actual: component.occupancyPct,
        });
      }
    }
  }

  // 5. Budget-line sums vs any stated total.
  if (
    ctx.statedTotalProjectCost != null &&
    ctx.budgetSum != null &&
    ctx.statedTotalProjectCost > 0
  ) {
    const source = ctx.statedTotalSource
      ? ` Stated total sourced from: ${ctx.statedTotalSource}.`
      : "";
    if (ctx.statedTotalProjectCost < 0.5 * ctx.budgetSum) {
      // Suspect extraction: a stated total below half the budget sum is almost
      // always a mis-mapped line (e.g. a loan amount read as the total). Surface
      // it for review as a WARNING: never a hard reconciliation error.
      flags.push({
        check_key: "budget_vs_stated_total",
        severity: "warning",
        message: `Suspect stated total project cost ${fmt(ctx.statedTotalProjectCost)} is below half the budget sum ${fmt(ctx.budgetSum)}: likely a mis-extracted value. Pending review; not treated as a hard reconciliation error.${source}`,
        expected: ctx.statedTotalProjectCost,
        actual: ctx.budgetSum,
      });
    } else if (
      Math.abs(ctx.budgetSum - ctx.statedTotalProjectCost) / ctx.statedTotalProjectCost >
      0.005
    ) {
      flags.push({
        check_key: "budget_vs_stated_total",
        severity: "error",
        message: `Budget lines sum to ${fmt(ctx.budgetSum)} but documents state total project cost ${fmt(ctx.statedTotalProjectCost)}.${source}`,
        expected: ctx.statedTotalProjectCost,
        actual: ctx.budgetSum,
      });
    }
  }

  // 6. Unit-count consistency across documents (220 must stay 220).
  if (ctx.unitCounts && ctx.unitCounts.length > 1) {
    const distinct = Array.from(new Set(ctx.unitCounts));
    if (distinct.length > 1) {
      flags.push({
        check_key: "unit_count_consistency",
        severity: "error",
        message: `Documents disagree on unit count: ${distinct.join(" vs ")}.`,
        expected: distinct[0],
        actual: distinct[1],
      });
    }
  }

  return flags;
}

// Risk score is a pure function of engine outputs + reconciliation flags via
// fixed thresholds. No LLM.
export function computeRiskScore(output: EngineOutput, flags: ReconciliationFlag[]): number {
  let score = 0;
  const v = output.values;
  if (v.dscr > 0 && v.dscr < 1.0) score += 30;
  else if (v.dscr > 0 && v.dscr < 1.2) score += 15;
  if (output.equityWipeout) score += 25;
  if (v.developmentSpreadBps < 50) score += 15;
  else if (v.developmentSpreadBps < 100) score += 10;
  if (v.profitOnCostPct < 15) score += 10;
  if (v.debtYieldPct > 0 && v.debtYieldPct < 8) score += 10;
  else if (v.debtYieldPct > 0 && v.debtYieldPct < 9) score += 5;
  if (v.breakEvenOccupancyPct >= 90) score += 10;
  else if (v.breakEvenOccupancyPct >= 85) score += 5;
  for (const flag of flags) {
    if (flag.severity === "error") score += 15;
    else if (flag.severity === "warning") score += 5;
  }
  return Math.min(100, score);
}

export type RiskEntry = {
  severity: "info" | "yellow" | "red" | "critical";
  risk_type: string;
  title: string;
  description: string;
};

export function deriveRiskRegister(output: EngineOutput, flags: ReconciliationFlag[]): RiskEntry[] {
  const risks: RiskEntry[] = [];
  const v = output.values;
  const fmtX = (n: number) => n.toFixed(2);

  if (output.equityWipeout) {
    risks.push({
      severity: "critical",
      risk_type: "returns",
      title: "Equity Wipeout at Exit",
      description: `Net sale proceeds ${fmt(v.netSaleBeforeDebt)} are below the loan payoff ${fmt(v.loanPayoffAtExit)}; equity is wiped out (EM ≈ 0.0x, IRR not meaningful).`,
    });
  }
  if (v.cumulativeCashShortfall > 0) {
    risks.push({
      severity: "red",
      risk_type: "cash_flow",
      title: "Negative Carry During Hold",
      description: `Annual levered cash flow is negative; cumulative cash shortfall during the hold is ${fmt(v.cumulativeCashShortfall)} before exit proceeds.`,
    });
  }
  if (v.dscr > 0 && v.dscr < 1.2) {
    risks.push({
      severity: "red",
      risk_type: "credit",
      title: "Weak Stabilized DSCR",
      description: `Amortizing DSCR is ${fmtX(v.dscr)}x, below the typical 1.20x covenant.`,
    });
  }
  if (v.developmentSpreadBps < 100) {
    risks.push({
      severity: v.developmentSpreadBps < 50 ? "red" : "yellow",
      risk_type: "exit",
      title: "Thin Development Spread",
      description: `Development spread is ${v.developmentSpreadBps.toFixed(0)} bps (target >= 100 bps).`,
    });
  }
  if (v.profitOnCostPct < 15) {
    risks.push({
      severity: "yellow",
      risk_type: "returns",
      title: "Low Profit on Cost",
      description: `Profit on cost is ${v.profitOnCostPct.toFixed(2)}% (target >= 15%).`,
    });
  }
  if (v.equityMultiple < 1.5) {
    risks.push({
      severity: "yellow",
      risk_type: "returns",
      title: "Low Equity Multiple",
      description: `Equity multiple is ${fmtX(v.equityMultiple)}x (target >= 1.50x).`,
    });
  }
  if (v.debtYieldPct > 0 && v.debtYieldPct < 9) {
    risks.push({
      severity: v.debtYieldPct < 8 ? "red" : "yellow",
      risk_type: "credit",
      title: "Thin Debt Yield",
      description: `Debt yield is ${v.debtYieldPct.toFixed(2)}% (NOI / loan), thin relative to the sizing floor a lender typically requires for this profile.`,
    });
  }
  if (v.breakEvenOccupancyPct >= 85) {
    risks.push({
      severity: v.breakEvenOccupancyPct >= 90 ? "red" : "yellow",
      risk_type: "operations",
      title: "High Break-even Occupancy",
      description: `Break-even occupancy is ${v.breakEvenOccupancyPct.toFixed(1)}%: limited cushion before stabilized levered cash flow turns negative.`,
    });
  }
  for (const flag of flags) {
    if (flag.severity === "error") {
      risks.push({
        severity: "red",
        risk_type: "reconciliation",
        title: `Reconciliation: ${flag.check_key}`,
        description: flag.message,
      });
    }
  }
  return risks;
}
