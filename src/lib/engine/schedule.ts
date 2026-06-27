// Monthly cash-flow spine (Workstream 1, the keystone). Additive and OPT-IN.
//
// THE INVERSION: an Excel model earns trust through click-any-cell transparency
// but loses it through arbitrary per-cell formulas. This module keeps Excel's
// time-series structure (a monthly period spine, every line item visible per
// period) while staying a CLOSED, typed, auditable calc graph: every node is a
// pure function of approved inputs and other nodes, and carries a readable
// formula_text. No node can contain an arbitrary user formula except the
// sandboxed custom line (expression.ts), whose expression IS its formula_text.
//
// The annual engine (proforma.ts) is untouched and remains the source of truth
// for a deal that does not opt in. When monthlyModel is on, the annual figures
// become a roll-up of this spine and three precision features unlock, each off
// by default and each computed from the SAME annual locals proforma already
// derived (passed in via ScheduleContext) so the spine can never drift from the
// backbone:
//   1A construction-draw S-curve with interest on the actual outstanding balance
//   1B a real per-period lease-up absorption ramp (not the midpoint triangle)
//   1C a single refinance event (rate-and-term and/or cash-out)

import { annualDebtService, interestOnlyDebtService, loanBalanceAfterMonths } from "./debt";
import { xirr } from "./metrics";
import {
  collectLiterals,
  collectReferences,
  evaluate,
  ExpressionError,
  parseExpression,
} from "./expression";
import { trancheDebtServiceForYear, type DebtStack, type DebtTranche } from "./tranches";
import type {
  CustomLineInput,
  EngineOutput,
  MetricOutput,
  MonthlySchedule,
  PeriodNode,
  RefinanceInput,
  ScheduleReconciliation,
} from "./types";

const money = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(value));

type Flow = { t: number; amount: number };

// Everything the spine needs, taken verbatim from proforma's annual locals so a
// monthly roll-up reconciles to the annual figures by construction.
export type ScheduleContext = {
  constructionMonths: number;
  leaseUpMonths: number;
  exitYear: number; // stabilized hold years (count, 1-indexed)
  developmentYears: number; // (construction + lease-up) / 12
  debtStack: DebtStack;
  budget: { land: number; hard: number; soft: number; contingency: number };
  interestReserve: number;
  egi: number;
  opex: number;
  noi: number;
  gpr: number;
  equity: number;
  rentGrowthPct: number;
  expenseGrowthPct: number;
  equityContributions: Flow[];
  holdLevered: number[]; // stabilized levered CF per hold year (length exitYear)
  finalEquityFlow: number; // sale proceeds + exit-year operating CF (0 on wipeout)
  netSaleBeforeDebt: number;
  loanPayoffAtExit: number;
  irrPct: number;
  exitCapRatePct: number;
  equityWipeout: boolean;
};

// ---- Construction draw curve ----------------------------------------------

// Smoothstep: the classic symmetric S-curve, 0 at t<=0 and 1 at t>=1.
export function smoothstep(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

// Cumulative fraction of construction spend drawn by time fraction `t` of the
// construction period. Straight-line is linear; the S-curve is smoothstep
// (slow start, fast middle, slow finish) -- the standard construction profile.
export function cumulativeDrawFraction(t: number, curve: "straight_line" | "s_curve"): number {
  const clamped = Math.min(1, Math.max(0, t));
  return curve === "s_curve" ? smoothstep(clamped) : clamped;
}

// The fraction outstanding (drawn) at the MIDDLE of construction month m, used
// as the interest-bearing balance for that month.
function drawFractionAtMonthMid(
  m: number,
  constructionMonths: number,
  curve: "straight_line" | "s_curve",
): number {
  if (constructionMonths <= 0) return 1;
  return cumulativeDrawFraction((m + 0.5) / constructionMonths, curve);
}

// Spend drawn DURING month m (the increment of the cumulative curve over the month).
function drawIncrement(
  m: number,
  constructionMonths: number,
  curve: "straight_line" | "s_curve",
): number {
  if (constructionMonths <= 0) return m === 0 ? 1 : 0;
  const end = cumulativeDrawFraction((m + 1) / constructionMonths, curve);
  const start = cumulativeDrawFraction(m / constructionMonths, curve);
  return end - start;
}

// ---- Monthly debt service primitive ---------------------------------------

// Debt service for ONE month, `monthsSinceStart` after the loan begins
// amortizing: interest-only during the IO window, the amortizing payment after.
// Summed over a year this equals trancheDebtServiceForYear exactly.
function monthlyTrancheDebtService(t: DebtTranche, monthsSinceStart: number): number {
  if (t.amount <= 0) return 0;
  const io = interestOnlyDebtService(t.amount, t.ratePct) / 12;
  if (t.amortYears <= 0) return io;
  return monthsSinceStart < Math.round(t.ioMonths)
    ? io
    : annualDebtService(t.amount, t.ratePct, t.amortYears) / 12;
}

// ---- The spine -------------------------------------------------------------

export function applyMonthlySchedule(
  input: {
    constructionDrawCurve?: "straight_line" | "s_curve" | null;
    leaseUpCurve?: boolean | null;
    refinance?: RefinanceInput | null;
    customLines?: CustomLineInput[] | null;
  },
  baseOutput: EngineOutput,
  ctx: ScheduleContext,
): EngineOutput {
  const C = Math.max(0, Math.round(ctx.constructionMonths));
  const L = Math.max(0, Math.round(ctx.leaseUpMonths));
  const H = Math.max(1, Math.round(ctx.exitYear));
  const stabilizationStart = C + L;
  const holdMonths = H * 12;
  const totalMonths = stabilizationStart + holdMonths;
  const curve = input.constructionDrawCurve === "s_curve" ? "s_curve" : "straight_line";
  const sCurveActive = curve === "s_curve";

  const senior = ctx.debtStack.tranches[0];
  const mezz = ctx.debtStack.tranches[1] ?? null;
  const totalDebt = ctx.debtStack.totalDebt;

  const nodes: PeriodNode[] = [];
  const warnings = [...baseOutput.warnings];

  // ---- Construction phase: draws + interest carry --------------------------
  const drawCategories: {
    key: "land_draw" | "hard_draw" | "soft_draw" | "contingency_draw";
    label: string;
    total: number;
  }[] = [
    { key: "land_draw", label: "Land draw", total: ctx.budget.land },
    { key: "hard_draw", label: "Hard cost draw", total: ctx.budget.hard },
    { key: "soft_draw", label: "Soft cost draw", total: ctx.budget.soft },
    { key: "contingency_draw", label: "Contingency draw", total: ctx.budget.contingency },
  ];

  // 1A. Construction interest. With the S-curve on it is computed on the actual
  // monthly outstanding balance (drawn per the curve during construction, full
  // during lease-up). With it off the spine mirrors the annual interest reserve
  // exactly (distributed straight-line) so the roll-up reconciles to the day.
  let scheduleConstructionInterest = 0;
  const carryMonths = C + L;
  if (sCurveActive) {
    for (let m = 0; m < carryMonths; m += 1) {
      const fraction = m < C ? drawFractionAtMonthMid(m, C, curve) : 1;
      const interest = ctx.debtStack.tranches.reduce(
        (sum, t) => sum + t.amount * fraction * (t.ratePct / 100 / 12),
        0,
      );
      scheduleConstructionInterest += interest;
      nodes.push({
        period: m,
        lineKey: "construction_interest",
        key: "construction_interest",
        label: "Construction interest",
        amount: -interest,
        formula_text: `Construction interest month ${m + 1} = outstanding debt ${money(totalDebt * fraction)} x monthly rate = ${money(interest)}`,
      });
    }
  } else {
    const perMonth = carryMonths > 0 ? ctx.interestReserve / carryMonths : ctx.interestReserve;
    for (let m = 0; m < carryMonths; m += 1) {
      scheduleConstructionInterest += perMonth;
      nodes.push({
        period: m,
        lineKey: "construction_interest",
        key: "construction_interest",
        label: "Construction interest",
        amount: -perMonth,
        formula_text: `Construction interest month ${m + 1} = interest reserve ${money(ctx.interestReserve)} spread over ${carryMonths || 1} months = ${money(perMonth)}`,
      });
    }
    if (carryMonths === 0) {
      scheduleConstructionInterest = ctx.interestReserve;
      if (ctx.interestReserve !== 0) {
        nodes.push({
          period: 0,
          lineKey: "construction_interest",
          key: "construction_interest",
          label: "Construction interest",
          amount: -ctx.interestReserve,
          formula_text: `Construction interest (turnkey) = interest reserve ${money(ctx.interestReserve)}`,
        });
      }
    }
  }

  // A turnkey deal (no construction period) draws every cost at t0.
  const drawMonths = C > 0 ? C : 1;
  for (let m = 0; m < drawMonths; m += 1) {
    for (const cat of drawCategories) {
      if (cat.total === 0) continue;
      const spend = C > 0 ? cat.total * drawIncrement(m, C, curve) : cat.total;
      nodes.push({
        period: m,
        lineKey: cat.key,
        key: cat.key,
        label: cat.label,
        amount: -spend,
        formula_text:
          C > 0
            ? `${cat.label} month ${m + 1} = ${money(cat.total)} x draw increment (${curve}) = ${money(spend)}`
            : `${cat.label} at t0 = ${money(cat.total)}`,
      });
    }
  }

  // ---- Equity contributions (timed) ----------------------------------------
  for (const contribution of ctx.equityContributions) {
    nodes.push({
      period: Math.max(0, Math.round(contribution.t * 12)),
      lineKey: "equity_contribution",
      key: "equity_contribution",
      label: "Equity contribution",
      amount: contribution.amount,
      formula_text: `Equity contribution at month ${Math.round(contribution.t * 12) + 1} = ${money(contribution.amount)}`,
    });
  }

  // ---- Refinance (1C) ------------------------------------------------------
  const refi = input.refinance && input.refinance.month > 0 ? input.refinance : null;
  const refiMonth = refi ? Math.round(refi.month) : 0;
  const monthsSeniorStartAtRefi = Math.max(0, refiMonth - stabilizationStart);
  const seniorBalanceAtRefi = refi
    ? loanBalanceAfterMonths(
        senior.amount,
        senior.ratePct,
        senior.amortYears,
        senior.ioMonths,
        monthsSeniorStartAtRefi,
      )
    : 0;
  const refiValue = ctx.exitCapRatePct > 0 ? ctx.noi / (ctx.exitCapRatePct / 100) : 0;
  const refiNewLoanAmount = refi
    ? refi.newAmount != null && refi.newAmount > 0
      ? refi.newAmount
      : refi.ltvPct != null && refi.ltvPct > 0
        ? (refi.ltvPct / 100) * refiValue
        : seniorBalanceAtRefi // pure rate-and-term: same balance, new terms
    : 0;
  const refiCashOut = refi ? refiNewLoanAmount - seniorBalanceAtRefi : 0;
  const newSenior: DebtTranche | null = refi
    ? {
        key: "senior_refi",
        label: "Refinanced senior",
        amount: refiNewLoanAmount,
        ratePct: refi.ratePct,
        amortYears: refi.amortYears,
        ioMonths: refi.ioMonths,
      }
    : null;
  const refiNewAnnualDebtService =
    refi && newSenior
      ? (newSenior.amortYears > 0
          ? annualDebtService(newSenior.amount, newSenior.ratePct, newSenior.amortYears)
          : interestOnlyDebtService(newSenior.amount, newSenior.ratePct)) +
        (mezz
          ? mezz.amortYears > 0
            ? annualDebtService(mezz.amount, mezz.ratePct, mezz.amortYears)
            : interestOnlyDebtService(mezz.amount, mezz.ratePct)
          : 0)
      : 0;
  const postRefiDscr =
    refi && refiNewAnnualDebtService > 0 ? ctx.noi / refiNewAnnualDebtService : 0;

  if (refi && newSenior) {
    if (refiMonth <= C) {
      warnings.push({
        key: "refinance_during_construction",
        message:
          "Refinance month falls during construction; modeled at the senior balance then outstanding.",
      });
    }
    nodes.push({
      period: refiMonth,
      lineKey: "refi_proceeds",
      key: "refi_proceeds",
      label: "Refinance proceeds",
      amount: refiNewLoanAmount,
      formula_text: `Refinance proceeds at month ${refiMonth + 1} = new senior loan ${money(refiNewLoanAmount)}`,
    });
    nodes.push({
      period: refiMonth,
      lineKey: "refi_payoff",
      key: "refi_payoff",
      label: "Senior balance retired",
      amount: -seniorBalanceAtRefi,
      formula_text: `Senior balance retired at month ${refiMonth + 1} = ${money(seniorBalanceAtRefi)}`,
    });
    nodes.push({
      period: refiMonth,
      lineKey: "refi_cash_out",
      key: "refi_cash_out",
      label: "Refinance cash-out to equity",
      amount: refiCashOut,
      formula_text: `Refinance cash-out = new loan ${money(refiNewLoanAmount)} - senior balance retired ${money(seniorBalanceAtRefi)} = ${money(refiCashOut)}`,
    });
  }

  // Senior debt service for a global stabilized month, swapping to the new loan
  // from the refinance month onward. Mezzanine is unaffected by the refinance.
  const seniorMonthlyDs = (globalMonth: number, monthsSeniorStart: number): number => {
    if (refi && newSenior && globalMonth >= refiMonth) {
      return monthlyTrancheDebtService(newSenior, globalMonth - refiMonth);
    }
    return monthlyTrancheDebtService(senior, monthsSeniorStart);
  };

  // ---- Operating phase: lease-up absorption (1B) + stabilized --------------
  const leaseUpActive = Boolean(input.leaseUpCurve) && L > 0 && !ctx.equityWipeout;
  const stabilizedLeveredCf = ctx.holdLevered[0] ?? 0;
  const stabilizedMonthlyLeveredCf = stabilizedLeveredCf / 12;

  // 1B. Lease-up months: a linear 0 -> stabilized absorption ramp. Off => no
  // operating income during lease-up (today's conservative full-delay model).
  for (let k = 0; k < L; k += 1) {
    const globalMonth = C + k;
    const fraction = leaseUpActive ? (k + 0.5) / L : 0;
    const monthlyNoi = (ctx.noi / 12) * fraction;
    const monthlyEgi = (ctx.egi / 12) * fraction;
    const monthlyOpex = (ctx.opex / 12) * fraction;
    nodes.push({
      period: globalMonth,
      lineKey: "egi",
      key: "egi",
      label: "Effective gross income",
      amount: monthlyEgi,
      formula_text: `Lease-up EGI month ${k + 1} = stabilized monthly EGI ${money(ctx.egi / 12)} x absorption ${(fraction * 100).toFixed(1)}% = ${money(monthlyEgi)}`,
    });
    nodes.push({
      period: globalMonth,
      lineKey: "opex",
      key: "opex",
      label: "Operating expense",
      amount: -monthlyOpex,
      formula_text: `Lease-up OpEx month ${k + 1} = stabilized monthly OpEx ${money(ctx.opex / 12)} x absorption ${(fraction * 100).toFixed(1)}% = ${money(monthlyOpex)}`,
    });
    nodes.push({
      period: globalMonth,
      lineKey: "noi",
      key: "noi",
      label: "Net operating income",
      amount: monthlyNoi,
      formula_text: `Lease-up NOI month ${k + 1} = stabilized monthly NOI ${money(ctx.noi / 12)} x absorption ${(fraction * 100).toFixed(1)}% = ${money(monthlyNoi)}`,
    });
    const leveredCf = leaseUpActive ? stabilizedMonthlyLeveredCf * fraction : 0;
    nodes.push({
      period: globalMonth,
      lineKey: "levered_cf",
      key: "levered_cf",
      label: "Levered cash flow",
      amount: leveredCf,
      formula_text: `Lease-up levered CF month ${k + 1} = stabilized monthly levered CF ${money(stabilizedMonthlyLeveredCf)} x absorption ${(fraction * 100).toFixed(1)}% = ${money(leveredCf)}`,
    });
  }

  // Stabilized operating months. NOI grows annually exactly as the annual model
  // does; debt service is the per-tranche monthly payment (refi-aware).
  const holdLeveredRefi: number[] = [];
  for (let y = 1; y <= H; y += 1) {
    const revGrowth = Math.pow(1 + ctx.rentGrowthPct / 100, y - 1);
    const expGrowth = Math.pow(1 + ctx.expenseGrowthPct / 100, y - 1);
    const yearEgi = ctx.egi * revGrowth;
    const yearOpex = ctx.opex * expGrowth;
    const yearNoi = yearEgi - yearOpex;
    let yearSeniorDs = 0;
    let yearMezzDs = 0;
    for (let j = 0; j < 12; j += 1) {
      const globalMonth = stabilizationStart + (y - 1) * 12 + j;
      const monthsSeniorStart = (y - 1) * 12 + j;
      const seniorDs = seniorMonthlyDs(globalMonth, monthsSeniorStart);
      const mezzDs = mezz ? monthlyTrancheDebtService(mezz, monthsSeniorStart) : 0;
      yearSeniorDs += seniorDs;
      yearMezzDs += mezzDs;
      const monthlyNoi = yearNoi / 12;
      const leveredCf = monthlyNoi - seniorDs - mezzDs;
      nodes.push({
        period: globalMonth,
        lineKey: "egi",
        key: "egi",
        label: "Effective gross income",
        amount: yearEgi / 12,
        formula_text: `EGI year ${y} month ${j + 1} = ${money(yearEgi)} / 12 = ${money(yearEgi / 12)}`,
      });
      nodes.push({
        period: globalMonth,
        lineKey: "opex",
        key: "opex",
        label: "Operating expense",
        amount: -yearOpex / 12,
        formula_text: `OpEx year ${y} month ${j + 1} = ${money(yearOpex)} / 12 = ${money(yearOpex / 12)}`,
      });
      nodes.push({
        period: globalMonth,
        lineKey: "noi",
        key: "noi",
        label: "Net operating income",
        amount: monthlyNoi,
        formula_text: `NOI year ${y} month ${j + 1} = ${money(yearNoi)} / 12 = ${money(monthlyNoi)}`,
      });
      nodes.push({
        period: globalMonth,
        lineKey: "senior_debt_service",
        key: "senior_debt_service",
        label: "Senior debt service",
        amount: -seniorDs,
        formula_text: `Senior debt service year ${y} month ${j + 1} = ${money(seniorDs)}`,
      });
      if (mezz)
        nodes.push({
          period: globalMonth,
          lineKey: "mezz_debt_service",
          key: "mezz_debt_service",
          label: "Mezzanine debt service",
          amount: -mezzDs,
          formula_text: `Mezzanine debt service year ${y} month ${j + 1} = ${money(mezzDs)}`,
        });
      nodes.push({
        period: globalMonth,
        lineKey: "levered_cf",
        key: "levered_cf",
        label: "Levered cash flow",
        amount: leveredCf,
        formula_text: `Levered CF year ${y} month ${j + 1} = NOI ${money(monthlyNoi)} - debt service ${money(seniorDs + mezzDs)} = ${money(leveredCf)}`,
      });
    }
    holdLeveredRefi.push(yearNoi - yearSeniorDs - yearMezzDs);
  }

  // ---- Exit: sale + loan payoff (refi-aware) -------------------------------
  const exitMonth = totalMonths - 1;
  const seniorPayoffAtExit =
    refi && newSenior
      ? loanBalanceAfterMonths(
          newSenior.amount,
          newSenior.ratePct,
          newSenior.amortYears,
          newSenior.ioMonths,
          holdMonths - monthsSeniorStartAtRefi,
        )
      : loanBalanceAfterMonths(
          senior.amount,
          senior.ratePct,
          senior.amortYears,
          senior.ioMonths,
          holdMonths,
        );
  const mezzPayoffAtExit = mezz
    ? loanBalanceAfterMonths(mezz.amount, mezz.ratePct, mezz.amortYears, mezz.ioMonths, holdMonths)
    : 0;
  const payoffAtExit = refi ? seniorPayoffAtExit + mezzPayoffAtExit : ctx.loanPayoffAtExit;
  if (!ctx.equityWipeout) {
    nodes.push({
      period: exitMonth,
      lineKey: "sale",
      key: "sale",
      label: "Net sale proceeds",
      amount: ctx.netSaleBeforeDebt,
      formula_text: `Net sale proceeds at month ${exitMonth + 1} = ${money(ctx.netSaleBeforeDebt)}`,
    });
    nodes.push({
      period: exitMonth,
      lineKey: "loan_payoff",
      key: "loan_payoff",
      label: "Loan payoff at exit",
      amount: -payoffAtExit,
      formula_text: `Loan payoff at exit = ${money(payoffAtExit)}`,
    });
  }

  // ---- Custom line items (sandboxed) ---------------------------------------
  // Context exposed to a custom expression for each operating month. References
  // outside this set fail closed (expression.ts).
  const customMetrics: MetricOutput[] = [];
  const customNodeKeys = [
    "noi",
    "egi",
    "opex",
    "gpr",
    "senior_debt_service",
    "mezz_debt_service",
    "debt_service",
    "levered_cf",
    "annual_noi",
    "annual_egi",
    "stabilized_noi",
  ];
  for (const line of input.customLines ?? []) {
    let ast;
    try {
      ast = parseExpression(line.expression);
      for (const ref of collectReferences(ast)) {
        if (!customNodeKeys.includes(ref))
          throw new ExpressionError(`Reference '${ref}' is not an allowed node.`);
      }
    } catch (err) {
      // Fail closed: an invalid or unsafe expression yields NO value and a
      // warning, never a fabricated number.
      warnings.push({
        key: `custom_invalid_${line.key}`,
        message: `Custom line "${line.label}" was not applied: ${err instanceof Error ? err.message : "invalid expression"}.`,
      });
      continue;
    }
    const from =
      line.fromMonth != null ? Math.max(0, Math.round(line.fromMonth)) : stabilizationStart;
    const to =
      line.toMonth != null ? Math.min(totalMonths - 1, Math.round(line.toMonth)) : totalMonths - 1;
    let total = 0;
    let applied = false;
    for (let m = from; m <= to; m += 1) {
      const monthData = monthFinancials(nodes, m);
      if (monthData == null) continue;
      const refContext = new Map<string, number>([
        ["noi", monthData.noi],
        ["egi", monthData.egi],
        ["opex", monthData.opex],
        ["gpr", ctx.gpr / 12],
        ["senior_debt_service", monthData.seniorDs],
        ["mezz_debt_service", monthData.mezzDs],
        ["debt_service", monthData.seniorDs + monthData.mezzDs],
        ["levered_cf", monthData.leveredCf],
        ["annual_noi", ctx.noi],
        ["annual_egi", ctx.egi],
        ["stabilized_noi", ctx.noi],
      ]);
      let value: number;
      try {
        value = evaluate(ast, refContext);
      } catch (err) {
        warnings.push({
          key: `custom_eval_${line.key}_${m}`,
          message: `Custom line "${line.label}" failed at month ${m + 1}: ${err instanceof Error ? err.message : "evaluation error"}.`,
        });
        continue;
      }
      total += value;
      applied = true;
      nodes.push({
        period: m,
        lineKey: "custom",
        key: `custom_${line.key}`,
        label: line.label,
        amount: value,
        formula_text: `${line.label} month ${m + 1} = ${line.expression} = ${money(value)}`,
      });
    }
    if (applied) {
      customMetrics.push({
        key: `custom_${line.key}`,
        label: line.label,
        value: total,
        unit: "$",
        formula: `${line.label} = ${line.expression}, summed across its active periods = ${money(total)}`,
      });
    }
  }

  // ---- Monthly-model levered IRR -------------------------------------------
  // Equity contributions (timed) + lease-up absorption per period (1B) +
  // stabilized annual levered CF (refi-aware) + refinance cash-out (1C) + exit.
  // With every feature off this vector is identical to the annual IRR vector, so
  // the monthly IRR equals the annual deal IRR exactly.
  const irrFlows: Flow[] = [...ctx.equityContributions];
  if (leaseUpActive) {
    for (let k = 0; k < L; k += 1) {
      const fraction = (k + 0.5) / L;
      irrFlows.push({ t: (C + k + 0.5) / 12, amount: stabilizedMonthlyLeveredCf * fraction });
    }
  }
  const holdForIrr = refi ? holdLeveredRefi : ctx.holdLevered;
  for (let y = 1; y < H; y += 1) {
    irrFlows.push({ t: ctx.developmentYears + y, amount: holdForIrr[y - 1] ?? 0 });
  }
  const exitOperating = holdForIrr[H - 1] ?? 0;
  const finalFlow = ctx.equityWipeout ? 0 : ctx.netSaleBeforeDebt - payoffAtExit + exitOperating;
  irrFlows.push({ t: ctx.developmentYears + H, amount: finalFlow });
  if (refi) irrFlows.push({ t: refiMonth / 12, amount: refiCashOut });

  const hasNeg = irrFlows.some((f) => f.amount < 0);
  const hasPos = irrFlows.some((f) => f.amount > 0);
  const scheduleLeveredIrrPct =
    ctx.equityWipeout || !hasNeg || !hasPos ? Number.NaN : xirr(irrFlows);

  // ---- Roll-up reconciliation ----------------------------------------------
  const sumNodes = (predicate: (n: PeriodNode) => boolean) =>
    nodes.filter(predicate).reduce((s, n) => s + n.amount, 0);
  const tol = (annual: number) => Math.max(1, Math.abs(annual) * 1e-6);
  const recon = (
    key: string,
    label: string,
    annual: number,
    rolledUp: number,
  ): ScheduleReconciliation => {
    const diff = rolledUp - annual;
    return { key, label, annual, rolledUp, diff, withinTolerance: Math.abs(diff) <= tol(annual) };
  };
  const year1SeniorDs =
    trancheDebtServiceForYear(senior, 1) + (mezz ? trancheDebtServiceForYear(mezz, 1) : 0);
  const reconciliation: ScheduleReconciliation[] = [
    recon(
      "construction_draws",
      "Construction draws",
      -(ctx.budget.land + ctx.budget.hard + ctx.budget.soft + ctx.budget.contingency),
      sumNodes(
        (n) =>
          n.lineKey === "land_draw" ||
          n.lineKey === "hard_draw" ||
          n.lineKey === "soft_draw" ||
          n.lineKey === "contingency_draw",
      ),
    ),
    recon(
      "construction_interest",
      "Construction interest",
      -scheduleConstructionInterest,
      sumNodes((n) => n.lineKey === "construction_interest"),
    ),
    recon(
      "equity",
      "Equity contributions",
      -ctx.equity,
      sumNodes((n) => n.lineKey === "equity_contribution"),
    ),
    recon(
      "noi_year1",
      "Stabilized NOI (year 1)",
      ctx.noi,
      sumNodes(
        (n) =>
          n.lineKey === "noi" &&
          n.period >= stabilizationStart &&
          n.period < stabilizationStart + 12,
      ),
    ),
    recon(
      "debt_service_year1",
      "Debt service (year 1)",
      -year1SeniorDs,
      sumNodes(
        (n) =>
          (n.lineKey === "senior_debt_service" || n.lineKey === "mezz_debt_service") &&
          n.period >= stabilizationStart &&
          n.period < stabilizationStart + 12,
      ),
    ),
  ];

  const schedule: MonthlySchedule = {
    months: totalMonths,
    constructionMonths: C,
    leaseUpMonths: L,
    holdMonths,
    nodes,
    reconciliation,
  };

  // ---- New precision metrics (each carries a provenance-clean formula) ------
  const newMetrics: MetricOutput[] = [];
  newMetrics.push({
    key: "schedule_levered_irr",
    label: "Levered IRR (monthly model)",
    value: scheduleLeveredIrrPct,
    unit: "%",
    formula: Number.isFinite(scheduleLeveredIrrPct)
      ? `Levered IRR from the monthly cash-flow spine = ${scheduleLeveredIrrPct.toFixed(2)}% (annual-model deal IRR ${ctx.irrPct.toFixed(2)}%)`
      : `Monthly-model IRR not meaningful (no sign change in the equity cash flows).`,
  });
  if (sCurveActive) {
    newMetrics.push({
      key: "schedule_construction_interest",
      label: "Construction Interest (monthly balance)",
      value: scheduleConstructionInterest,
      unit: "$",
      formula: `Construction interest on the actual monthly outstanding balance (S-curve draws) = ${money(scheduleConstructionInterest)}`,
    });
  }
  if (refi && newSenior) {
    newMetrics.push({
      key: "refi_new_loan",
      label: "Refinance New Senior Loan",
      value: refiNewLoanAmount,
      unit: "$",
      formula: `New senior loan at refinance = ${money(refiNewLoanAmount)}`,
    });
    newMetrics.push({
      key: "refi_cash_out",
      label: "Refinance Cash-out",
      value: refiCashOut,
      unit: "$",
      formula: `Refinance cash-out to equity = ${money(refiCashOut)}`,
    });
    newMetrics.push({
      key: "refi_new_debt_service",
      label: "Post-refinance Annual Debt Service",
      value: refiNewAnnualDebtService,
      unit: "$",
      formula: `Post-refinance annual debt service = ${money(refiNewAnnualDebtService)}`,
    });
    newMetrics.push({
      key: "post_refi_dscr",
      label: "Post-refinance DSCR",
      value: postRefiDscr,
      unit: "x",
      formula: `Post-refinance DSCR = NOI ${money(ctx.noi)} / post-refinance debt service ${money(refiNewAnnualDebtService)} = ${postRefiDscr.toFixed(2)}x`,
    });
  }

  // Augment the output. The base values literal is preserved; new keys are added
  // only here (the on-path), so the off-path output stays byte-identical.
  return {
    ...baseOutput,
    warnings,
    schedule,
    metrics: [...baseOutput.metrics, ...newMetrics, ...customMetrics],
    values: {
      ...baseOutput.values,
      scheduleConstructionInterest,
      scheduleLeveredIrrPct,
      ...(refi ? { refiCashOut, refiNewLoanAmount, refiNewAnnualDebtService, postRefiDscr } : {}),
    },
  };
}

// The operating financials at a given month, read back from the nodes already
// built (so a custom line references the same figures the spine displays).
function monthFinancials(
  nodes: PeriodNode[],
  month: number,
): {
  noi: number;
  egi: number;
  opex: number;
  seniorDs: number;
  mezzDs: number;
  leveredCf: number;
} | null {
  let noi = 0;
  let egi = 0;
  let opex = 0;
  let seniorDs = 0;
  let mezzDs = 0;
  let leveredCf = 0;
  let found = false;
  for (const n of nodes) {
    if (n.period !== month) continue;
    if (n.lineKey === "noi") {
      noi += n.amount;
      found = true;
    } else if (n.lineKey === "egi") egi += n.amount;
    else if (n.lineKey === "opex") opex += n.amount;
    else if (n.lineKey === "senior_debt_service") seniorDs += -n.amount;
    else if (n.lineKey === "mezz_debt_service") mezzDs += -n.amount;
    else if (n.lineKey === "levered_cf") {
      leveredCf += n.amount;
      found = true;
    }
  }
  return found ? { noi, egi, opex, seniorDs, mezzDs, leveredCf } : null;
}
