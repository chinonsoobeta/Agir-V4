import { interestOnlyDebtService } from "./debt";
import { pct, xirr } from "./metrics";
import {
  buildDebtStack,
  stackDebtServiceForYear,
  stackInterestCarry,
  stackPayoffAfterYears,
  type DebtTranche,
} from "./tranches";
import { buildEquityContributions, equityDrawConventionText } from "./equity-timing";
import { leaseUpAdjustedIrr } from "./lease-up";
import { applyMonthlySchedule, type ScheduleContext } from "./schedule";
import { equityMultiple as moneyMultiple, runWaterfall, type WaterfallConfig } from "./waterfall";
import type {
  CashFlowRow,
  EngineOutput,
  EngineWarning,
  MetricOutput,
  RevenueUnitInput,
  UnderwritingInput,
} from "./types";

const money = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(value));

const num = (value: number) => (Number.isFinite(value) ? value : 0);

// per_unit: count x $/unit/mo x 12. per_sf: count x SF x annual $/SF.
export function componentGpr(row: RevenueUnitInput) {
  if (row.rentBasis === "per_sf") {
    return row.unitCount * num(row.avgSf ?? 0) * row.rent;
  }
  return row.unitCount * row.rent * 12;
}

export function runUnderwriting(input: UnderwritingInput): EngineOutput {
  const tdcPreFinancing =
    input.budget.land +
    input.budget.hard +
    input.budget.soft +
    input.budget.contingency +
    num(input.budget.other ?? 0);

  // Capital stack: a senior loan plus any subordinate (mezzanine) tranche. A
  // senior-only stack reproduces today's single-loan math exactly.
  const seniorTranche: DebtTranche = {
    key: "senior",
    label: "Senior",
    amount: input.loanAmount,
    ratePct: input.interestRatePct,
    amortYears: input.amortYears,
    ioMonths: input.ioMonths,
  };
  const mezz = input.mezzanine && input.mezzanine.amount > 0 ? input.mezzanine : null;
  const mezzTranche: DebtTranche | null = mezz
    ? {
        key: "mezzanine",
        label: "Mezzanine",
        amount: mezz.amount,
        ratePct: mezz.ratePct,
        amortYears: mezz.amortYears,
        ioMonths: mezz.ioMonths,
      }
    : null;
  const debtStack = buildDebtStack(seniorTranche, mezzTranche ? [mezzTranche] : []);
  const totalDebt = debtStack.totalDebt;

  // Interest carried during construction + lease-up, summed across tranches.
  // Identical to the single-loan reserve when there is no mezzanine.
  const computedInterestReserve = stackInterestCarry(
    debtStack,
    input.constructionMonths + input.leaseUpMonths,
    input.avgOutstandingFactor,
  );
  const interestReserve = input.budget.financingInterest ?? computedInterestReserve;
  const tdc = tdcPreFinancing + interestReserve;

  // Component-level revenue: EGI = sum(component GPR x component occupancy) + other income.
  // A flat blended occupancy is never applied when component occupancies exist.
  const gpr = input.revenueProgram.reduce((sum, row) => sum + componentGpr(row), 0);
  const rentEgi = input.revenueProgram.reduce((sum, row) => {
    const occ = row.occupancyPct ?? input.stabilizedOccupancyPct;
    return sum + componentGpr(row) * (occ / 100);
  }, 0);
  const egi = rentEgi + input.otherIncomeAnnual;
  const effectiveOccupancyPct = gpr > 0 ? (rentEgi / gpr) * 100 : 0;
  const opex = egi * (input.expenseRatioPct / 100);
  const noi = egi - opex;

  const yieldOnCostPct = pct(noi, tdc);
  const developmentSpreadBps = (yieldOnCostPct - input.exitCapRatePct) * 100;
  const exitValue = input.exitCapRatePct > 0 ? noi / (input.exitCapRatePct / 100) : 0;
  const netSaleBeforeDebt = exitValue * (1 - input.sellingCostsPct / 100);
  // Payoff sums every tranche's outstanding balance (each honoring its own IO
  // and amortization). Equal to the single senior balance when there is no mezz.
  const loanPayoffAtExit = stackPayoffAfterYears(debtStack, input.holdYears);
  const saleProceedsToEquity = netSaleBeforeDebt - loanPayoffAtExit;
  const equityWipeout = totalDebt > 0 && netSaleBeforeDebt < loanPayoffAtExit;
  const developmentProfit = exitValue - tdc;
  const profitOnCostPct = pct(developmentProfit, tdc);
  // Cost/unit counts dwelling units only; per_sf components (retail/office)
  // are not "units" and must never inflate the count (220 stays 220).
  const unitCount = input.revenueProgram.reduce(
    (sum, row) => sum + (row.rentBasis === "per_unit" ? row.unitCount : 0),
    0,
  );
  const costPerUnit = unitCount ? tdc / unitCount : 0;
  // Equity requirement is funded by TOTAL debt (senior + mezz). Equal to
  // TDC - senior loan when there is no mezzanine.
  const impliedEquity = tdc - totalDebt;
  const equity = input.equityAmount && input.equityAmount > 0 ? input.equityAmount : impliedEquity;
  const ltcPct = pct(totalDebt, tdc);

  // Debt service follows extracted terms: amortizing payment is the headline
  // whenever an amortization term exists; interest-only is secondary, labeled.
  // The senior figures are the headline (unchanged); all-in figures add mezz.
  // The headline DSCR stays on the (conservative) amortizing senior basis, but
  // the cash-flow waterfall, returns and break-even use the payment actually
  // made (see stackDebtServiceForYear, which honors each tranche's IO period).
  const ioDebtService = interestOnlyDebtService(input.loanAmount, input.interestRatePct);
  const annualDs = debtStack.seniorAnnualDebtService;
  const totalDebtService = debtStack.annualDebtService;
  const mezzDebtService = totalDebtService - annualDs;
  const dscr = annualDs > 0 ? noi / annualDs : 0;
  const seniorDscr = dscr;
  const allInDscr = totalDebtService > 0 ? noi / totalDebtService : 0;
  const interestOnlyDscr = ioDebtService > 0 ? noi / ioDebtService : 0;

  // Debt service actually due across ALL tranches in hold-year `year` (1-indexed).
  // For a senior-only deal this is byte-identical to the prior single-loan logic.
  const debtServiceForYear = (year: number) => stackDebtServiceForYear(debtStack, year);
  const year1DebtService = debtServiceForYear(1);
  const stabilizedLeveredCf = noi - year1DebtService;
  const cashOnCashPct = equity > 0 ? pct(stabilizedLeveredCf, equity) : 0;

  // Debt yield = NOI / loan: the lender's primary sizing metric, independent of
  // rate and amortization (which DSCR and the loan constant conflate).
  const debtYieldPct = input.loanAmount > 0 ? pct(noi, input.loanAmount) : 0;

  // Break-even occupancy: the blended physical occupancy at which NOI just
  // covers the debt service actually due (levered CF = 0), holding the expense
  // ratio and other income fixed. Uses the in-force (year-1) debt service so it
  // matches the cash-flow waterfall and the covenant test.
  const breakEvenOccupancyPct =
    gpr > 0 && input.expenseRatioPct < 100
      ? ((year1DebtService / (1 - input.expenseRatioPct / 100) - input.otherIncomeAnnual) / gpr) *
        100
      : 0;

  const exitYear = Math.max(1, Math.round(input.holdYears));
  const holdLevered = Array.from({ length: exitYear }, (_, i) => {
    const revenueGrowth = Math.pow(1 + input.rentGrowthPct / 100, i);
    const expenseGrowth = Math.pow(1 + input.expenseGrowthPct / 100, i);
    const yearEgi = egi * revenueGrowth;
    const yearOpex = opex * expenseGrowth;
    return yearEgi - yearOpex - debtServiceForYear(i + 1);
  });
  const interimLevered = holdLevered.slice(0, Math.max(0, exitYear - 1));
  const interimSum = interimLevered.reduce((a, b) => a + b, 0);
  // The operating cash flow in the sale year itself is distributed to equity in
  // ADDITION to net sale proceeds; it must not be dropped from the return.
  const exitYearOperatingCf = holdLevered[exitYear - 1] ?? 0;
  const cumulativeCashShortfall = holdLevered.reduce((sum, cf) => sum + (cf < 0 ? -cf : 0), 0);

  // Equity is non-recourse at exit: the sale recovery floors at zero on a
  // wipeout (equity multiple ~0.0x, IRR not meaningful -- never a positive IRR,
  // never 0% as a placeholder). The sale-year operating cash flow is added to
  // the final flow whenever the sale itself does not wipe equity out.
  const finalEquityFlow = equityWipeout ? 0 : saleProceedsToEquity + exitYearOperatingCf;
  const totalDistributions = finalEquityFlow + interimSum;
  const equityMultiple = equity > 0 ? Math.max(0, totalDistributions / equity) : 0;
  const irrFlows = [-equity, ...interimLevered, finalEquityFlow];
  // Returns are phased on the real development timeline: equity is committed at
  // t=0, but the stabilized operating cash flows and the sale do not begin until
  // construction + lease-up is complete. Discounting each flow at its true time
  // (a fractional-year delay) instead of assuming year-1 stabilization is the
  // difference between a turnkey acquisition and a multi-year ground-up build --
  // without it, levered IRR is systematically overstated on development deals.
  // (The equity multiple is a money multiple and stays intentionally timing-free.)
  const developmentYears = (input.constructionMonths + input.leaseUpMonths) / 12;
  // 1A. Equity draw timing: the single t=0 outflow becomes a timed contribution
  // vector. With no draw schedule this is exactly [{ t: 0, -equity }], so the
  // IRR vector is unchanged. A straight-line draw defers part of the outflow.
  const equityContributions = buildEquityContributions(equity, input.equityDrawMonths ?? 0);
  const distributionFlows = [
    ...interimLevered.map((cf, i) => ({ t: developmentYears + i + 1, amount: cf })),
    { t: developmentYears + exitYear, amount: finalEquityFlow },
  ];
  const irrTimedFlows = [...equityContributions, ...distributionFlows];
  // IRR and the equity multiple agree on a total loss: when equity recovers
  // nothing (distributions <= 0) or the sale wipes out, IRR is not meaningful
  // and the equity multiple floors at ~0.0x.
  const irrPct =
    equityWipeout || (equity > 0 && totalDistributions <= 0) ? Number.NaN : xirr(irrTimedFlows);
  const irrStatus: EngineOutput["irrStatus"] = Number.isFinite(irrPct)
    ? "computed"
    : "not_meaningful";

  // 1C. LP/GP distribution waterfall over the same levered equity vector. With
  // no promote configured the waterfall is inactive and LP returns equal the
  // deal returns (GP promote = 0), preserving backward compatibility.
  const waterfallConfig: WaterfallConfig = input.waterfall ?? {
    lpEquityPct: 100,
    gpEquityPct: 0,
    preferredReturnPct: 0,
    gpCatchUpPct: 0,
    tiers: [],
  };
  const wf = runWaterfall(irrTimedFlows, waterfallConfig);
  const lpHasReturn = wf.lp.contributed > 0 && wf.lp.distributed > 0;
  const gpHasReturn = wf.gp.contributed > 0 && wf.gp.distributed > 0;
  const lpIrrPct = wf.active ? (lpHasReturn ? xirr(wf.lp.flows) : Number.NaN) : irrPct;
  const lpEquityMultiple = wf.active
    ? moneyMultiple(wf.lp.contributed, wf.lp.distributed)
    : equityMultiple;
  const lpPreferredReturn = wf.lpPreferredPaid;
  const gpIrrPct = wf.active && gpHasReturn ? xirr(wf.gp.flows) : Number.NaN;
  const gpEquityMultiple = wf.active ? moneyMultiple(wf.gp.contributed, wf.gp.distributed) : 0;
  const gpPromote = wf.gpPromote;

  // 1D. Lease-up absorption: an opt-in figure that credits partial operating
  // income earned during the lease-up window. Off (or no lease-up, or a loss)
  // it equals the deal IRR exactly, so existing deals are unchanged.
  const leaseUpActive =
    Boolean(input.leaseUpCurve) &&
    input.leaseUpMonths > 0 &&
    !equityWipeout &&
    Number.isFinite(irrPct);
  const leaseUpAdjustedIrrPct = leaseUpActive
    ? leaseUpAdjustedIrr({
        equityContributions,
        distributionFlows,
        stabilizedLeveredCf,
        constructionMonths: input.constructionMonths,
        leaseUpMonths: input.leaseUpMonths,
      })
    : irrPct;

  const cashFlows: CashFlowRow[] = [
    { periodYear: 0, lineKey: "equity", amount: -equity },
    { periodYear: 0, lineKey: "construction", amount: -tdcPreFinancing },
    { periodYear: 0, lineKey: "interest", amount: -interestReserve },
    { periodYear: 1, lineKey: "gross_revenue", amount: gpr },
    { periodYear: 1, lineKey: "egi", amount: egi },
    { periodYear: 1, lineKey: "opex", amount: -opex },
    { periodYear: 1, lineKey: "noi", amount: noi },
    { periodYear: 1, lineKey: "debt_service", amount: -year1DebtService },
    { periodYear: 1, lineKey: "levered_cf", amount: stabilizedLeveredCf },
    // Sale-year operating cash flow (distinct from year 1) so the ledger shows
    // the full distribution that equity receives in the exit year.
    ...(exitYear > 1
      ? [{ periodYear: exitYear, lineKey: "levered_cf" as const, amount: exitYearOperatingCf }]
      : []),
    { periodYear: exitYear, lineKey: "sale_proceeds", amount: netSaleBeforeDebt },
    { periodYear: exitYear, lineKey: "loan_payoff", amount: -loanPayoffAtExit },
  ];

  const warnings: EngineWarning[] = [];
  if (input.equityAmount && Math.abs(input.equityAmount - impliedEquity) > 1) {
    warnings.push({
      key: "equity_mismatch",
      message: "Analyst equity differs from TDC minus loan amount.",
      expected: impliedEquity,
      actual: input.equityAmount,
    });
  }

  const drawNote =
    (input.equityDrawMonths ?? 0) > 1
      ? ` Equity draw: ${equityDrawConventionText(input.equityDrawMonths ?? 0)}.`
      : "";
  const irrFormula = equityWipeout
    ? `Equity loss: IRR not meaningful: sale proceeds ${money(netSaleBeforeDebt)} < loan payoff ${money(loanPayoffAtExit)}; EM ≈ 0.0x`
    : Number.isFinite(irrPct)
      ? `IRR from equity cash flows [${irrFlows.map((v) => money(v)).join(", ")}], with operating cash flow and sale phased ${input.constructionMonths} months construction + ${input.leaseUpMonths} months lease-up after equity is committed = ${irrPct.toFixed(2)}%.${drawNote}`
      : "IRR not meaningful: equity cash flows do not include both negative and positive values.";

  const metrics: MetricOutput[] = [
    {
      key: "total_project_cost",
      label: "Total Project Cost",
      value: tdc,
      unit: "$",
      formula: `TDC = land ${money(input.budget.land)} + hard ${money(input.budget.hard)} + soft ${money(input.budget.soft)} + contingency ${money(input.budget.contingency)}${input.budget.other ? ` + reserves ${money(num(input.budget.other))}` : ""} + financing ${money(interestReserve)} = ${money(tdc)}`,
    },
    {
      key: "gpr",
      label: "Gross Potential Rent",
      value: gpr,
      unit: "$",
      formula: `GPR = ${input.revenueProgram.map((r) => `${r.unitType} ${money(componentGpr(r))}`).join(" + ")} = ${money(gpr)}`,
    },
    {
      key: "projected_revenue",
      label: "Effective Gross Income",
      value: egi,
      unit: "$",
      formula: `EGI = ${input.revenueProgram.map((r) => `${r.unitType} ${money(componentGpr(r))} x ${(r.occupancyPct ?? input.stabilizedOccupancyPct).toFixed(0)}%`).join(" + ")} + other income ${money(input.otherIncomeAnnual)} = ${money(egi)}`,
    },
    {
      key: "stabilized_noi",
      label: "Stabilized NOI",
      value: noi,
      unit: "$",
      formula: `NOI = EGI ${money(egi)} - OpEx ${money(opex)} (${input.expenseRatioPct}%) = ${money(noi)}`,
    },
    {
      key: "projected_profit",
      label: "Development Profit",
      value: developmentProfit,
      unit: "$",
      formula: `Development profit = exit value ${money(exitValue)} - TDC ${money(tdc)} = ${money(developmentProfit)}`,
    },
    {
      key: "profit_margin",
      label: "Profit on Cost",
      value: profitOnCostPct,
      unit: "%",
      formula: `Profit on cost = ${money(developmentProfit)} / ${money(tdc)} = ${profitOnCostPct.toFixed(2)}%`,
    },
    {
      key: "equity_requirement",
      label: "Equity Requirement",
      value: impliedEquity,
      unit: "$",
      formula: `Required equity = TDC ${money(tdc)} - loan ${money(input.loanAmount)} = ${money(impliedEquity)}`,
    },
    {
      key: "loan_to_cost",
      label: "Loan-to-Cost",
      value: ltcPct,
      unit: "%",
      formula: `LTC = loan ${money(input.loanAmount)} / TDC ${money(tdc)} = ${ltcPct.toFixed(2)}%`,
    },
    {
      key: "annual_debt_service",
      label: "Annual Debt Service (amortizing)",
      value: annualDs,
      unit: "$",
      formula: `ADS = standard mortgage payment on ${money(input.loanAmount)} @ ${input.interestRatePct}% / ${input.amortYears}yr = ${money(annualDs)}`,
    },
    {
      key: "dscr",
      label: "DSCR (amortizing)",
      value: dscr,
      unit: "x",
      formula: `DSCR = NOI ${money(noi)} / amortizing debt service ${money(annualDs)} = ${dscr.toFixed(2)}x`,
    },
    {
      key: "interest_only_dscr",
      label: "DSCR (interest-only, secondary)",
      value: interestOnlyDscr,
      unit: "x",
      formula: `Interest-only DSCR (secondary) = NOI ${money(noi)} / interest ${money(ioDebtService)} = ${interestOnlyDscr.toFixed(2)}x`,
    },
    { key: "irr_estimate", label: "Levered IRR", value: irrPct, unit: "%", formula: irrFormula },
    {
      key: "cash_on_cash",
      label: "Cash-on-Cash",
      value: cashOnCashPct,
      unit: "%",
      formula: `Cash-on-cash = stabilized levered CF ${money(stabilizedLeveredCf)} / committed equity ${money(equity)} = ${cashOnCashPct.toFixed(2)}%`,
    },
    {
      key: "debt_yield",
      label: "Debt Yield",
      value: debtYieldPct,
      unit: "%",
      formula: `Debt yield = NOI ${money(noi)} / loan ${money(input.loanAmount)} = ${debtYieldPct.toFixed(2)}%`,
    },
    {
      key: "break_even_occupancy",
      label: "Break-even Occupancy",
      value: breakEvenOccupancyPct,
      unit: "%",
      formula: `Break-even occupancy = (in-force debt service ${money(year1DebtService)} / (1 - opex ${input.expenseRatioPct}%) - other income ${money(input.otherIncomeAnnual)}) / GPR ${money(gpr)} = ${breakEvenOccupancyPct.toFixed(1)}%`,
    },
    {
      key: "cumulative_cash_shortfall",
      label: "Cumulative Cash Shortfall",
      value: cumulativeCashShortfall,
      unit: "$",
      formula: `Cumulative cash shortfall during hold = sum of negative annual levered cash flow over ${exitYear} years = ${money(cumulativeCashShortfall)}`,
    },
    {
      key: "yield_on_cost",
      label: "Going-in Yield on Cost",
      value: yieldOnCostPct,
      unit: "%",
      formula: `Yield on cost = NOI ${money(noi)} / TDC ${money(tdc)} = ${yieldOnCostPct.toFixed(2)}%`,
    },
    {
      key: "development_spread",
      label: "Development Spread",
      value: developmentSpreadBps,
      unit: "bps",
      formula: `Development spread = yield ${yieldOnCostPct.toFixed(2)}% - exit cap ${input.exitCapRatePct.toFixed(2)}% = ${developmentSpreadBps.toFixed(0)} bps`,
    },
    {
      key: "exit_value",
      label: "Exit Value",
      value: exitValue,
      unit: "$",
      formula: `Exit value = NOI ${money(noi)} / exit cap ${input.exitCapRatePct.toFixed(2)}% = ${money(exitValue)}`,
    },
    {
      key: "net_sale_proceeds",
      label: "Net Sale Proceeds",
      value: netSaleBeforeDebt,
      unit: "$",
      formula: `Net sale = exit value ${money(exitValue)} x (1 - selling costs ${input.sellingCostsPct}%) = ${money(netSaleBeforeDebt)}`,
    },
    {
      key: "loan_payoff_at_exit",
      label: "Loan Payoff at Exit",
      value: loanPayoffAtExit,
      unit: "$",
      formula: `Loan balance after ${input.holdYears}yr (${input.ioMonths}mo IO, ${input.amortYears}yr amort) = ${money(loanPayoffAtExit)}`,
    },
    {
      key: "equity_multiple",
      label: "Equity Multiple",
      value: equityMultiple,
      unit: "x",
      formula: equityWipeout
        ? `Equity wipeout: sale proceeds ${money(netSaleBeforeDebt)} < loan payoff ${money(loanPayoffAtExit)} → EM ≈ 0.0x`
        : `Equity multiple = distributions ${money(finalEquityFlow + interimSum)} / equity ${money(equity)} = ${equityMultiple.toFixed(2)}x`,
    },
    {
      key: "cost_per_unit",
      label: "Cost / Unit",
      value: costPerUnit,
      unit: "$",
      formula: `Cost per unit = TDC ${money(tdc)} / ${unitCount} units = ${money(costPerUnit)}`,
    },
    // ---- Multi-tranche debt (1B). Equal the senior figures when no mezzanine. ----
    {
      key: "total_debt",
      label: "Total Debt",
      value: totalDebt,
      unit: "$",
      formula: mezz
        ? `Total debt = senior ${money(input.loanAmount)} + mezzanine ${money(mezz.amount)} = ${money(totalDebt)}`
        : `Total debt = senior loan ${money(input.loanAmount)} (no subordinate debt) = ${money(totalDebt)}`,
    },
    {
      key: "total_debt_service",
      label: "All-in Annual Debt Service",
      value: totalDebtService,
      unit: "$",
      formula: mezz
        ? `All-in annual debt service = senior ${money(annualDs)} + mezzanine ${money(mezzDebtService)} = ${money(totalDebtService)}`
        : `All-in annual debt service = senior ${money(totalDebtService)} (no subordinate debt)`,
    },
    {
      key: "senior_dscr",
      label: "Senior DSCR",
      value: seniorDscr,
      unit: "x",
      formula: `Senior DSCR = NOI ${money(noi)} / senior debt service ${money(annualDs)} = ${seniorDscr.toFixed(2)}x`,
    },
    {
      key: "all_in_dscr",
      label: "All-in DSCR",
      value: allInDscr,
      unit: "x",
      formula: mezz
        ? `All-in DSCR = NOI ${money(noi)} / all-in debt service ${money(totalDebtService)} = ${allInDscr.toFixed(2)}x`
        : `All-in DSCR = senior DSCR ${allInDscr.toFixed(2)}x (no subordinate debt)`,
    },
    // ---- LP/GP waterfall (1C). Equal the deal figures when no promote. ----
    {
      key: "lp_irr",
      label: "LP Levered IRR",
      value: lpIrrPct,
      unit: "%",
      formula: Number.isFinite(lpIrrPct)
        ? `LP IRR = ${lpIrrPct.toFixed(2)}% from LP equity cash flows after the distribution waterfall. ${wf.formulaText}`
        : `LP IRR not meaningful (no positive LP distribution). ${wf.formulaText}`,
    },
    {
      key: "lp_equity_multiple",
      label: "LP Equity Multiple",
      value: lpEquityMultiple,
      unit: "x",
      formula: wf.active
        ? `LP equity multiple = LP distributions ${money(wf.lp.distributed)} / LP capital ${money(wf.lp.contributed)} = ${lpEquityMultiple.toFixed(2)}x`
        : `LP equity multiple = deal equity multiple ${equityMultiple.toFixed(2)}x (LP holds the entire deal)`,
    },
    {
      key: "lp_preferred_return",
      label: "LP Preferred Return Distributed",
      value: lpPreferredReturn,
      unit: "$",
      formula: `LP preferred return distributed = ${money(lpPreferredReturn)} (return of capital excluded)`,
    },
    {
      key: "gp_irr",
      label: "GP Levered IRR",
      value: gpIrrPct,
      unit: "%",
      formula: Number.isFinite(gpIrrPct)
        ? `GP IRR = ${gpIrrPct.toFixed(2)}% from GP equity cash flows (co-invest plus promote).`
        : `GP IRR not meaningful (GP contributed no co-invest capital).`,
    },
    {
      key: "gp_equity_multiple",
      label: "GP Equity Multiple",
      value: gpEquityMultiple,
      unit: "x",
      formula:
        wf.gp.contributed > 0
          ? `GP equity multiple = GP distributions ${money(wf.gp.distributed)} / GP capital ${money(wf.gp.contributed)} = ${gpEquityMultiple.toFixed(2)}x`
          : `GP equity multiple not applicable: GP contributed no co-invest capital`,
    },
    {
      key: "gp_promote",
      label: "GP Promote",
      value: gpPromote,
      unit: "$",
      formula: `GP promote (carried interest) = GP distributions ${money(wf.gp.distributed)} less a pari-passu split by ownership = ${money(gpPromote)}`,
    },
    // 1D. Emitted only when lease-up absorption is active, so deals without it
    // (every golden fixture) are byte-identical and carry no extra metric row.
    ...(leaseUpActive
      ? [
          {
            key: "lease_up_adjusted_irr",
            label: "Lease-up Adjusted IRR",
            value: leaseUpAdjustedIrrPct,
            unit: "%" as const,
            formula: `Lease-up adjusted IRR = ${leaseUpAdjustedIrrPct.toFixed(2)}%, crediting partial operating income across the ${input.leaseUpMonths}-month lease-up (linear absorption) vs the ${irrPct.toFixed(2)}% full-delay deal IRR`,
          },
        ]
      : []),
  ];

  const baseOutput: EngineOutput = {
    metrics,
    cashFlows,
    warnings,
    irrStatus,
    equityWipeout,
    values: {
      tdcPreFinancing,
      interestReserve,
      tdc,
      gpr,
      egi,
      opex,
      noi,
      effectiveOccupancyPct,
      yieldOnCostPct,
      developmentSpreadBps,
      exitValue,
      netSaleBeforeDebt,
      loanPayoffAtExit,
      saleProceedsToEquity,
      developmentProfit,
      profitOnCostPct,
      costPerUnit,
      equity,
      requiredEquity: impliedEquity,
      ltcPct,
      annualDebtService: annualDs,
      dscr,
      interestOnlyDscr,
      cashOnCashPct,
      cumulativeCashShortfall,
      equityMultiple,
      irrPct,
      debtYieldPct,
      breakEvenOccupancyPct,
      totalDebt,
      seniorDebtService: annualDs,
      mezzDebtService,
      totalDebtService,
      seniorDscr,
      allInDscr,
      lpIrrPct,
      lpEquityMultiple,
      lpPreferredReturn,
      gpIrrPct,
      gpEquityMultiple,
      gpPromote,
      leaseUpAdjustedIrrPct,
    },
  };

  // Monthly cash-flow spine (WS1). OFF by default: a deal that does not opt in
  // returns the annual output above byte-for-byte. When monthlyModel is on the
  // spine refines the figures it can (construction carry, lease-up absorption,
  // refinance) and rolls back up to these annual figures.
  if (!input.monthlyModel) return baseOutput;
  const scheduleContext: ScheduleContext = {
    constructionMonths: input.constructionMonths,
    leaseUpMonths: input.leaseUpMonths,
    exitYear,
    developmentYears,
    debtStack,
    budget: {
      land: input.budget.land,
      hard: input.budget.hard,
      soft: input.budget.soft,
      contingency: input.budget.contingency,
    },
    interestReserve,
    egi,
    opex,
    noi,
    gpr,
    equity,
    rentGrowthPct: input.rentGrowthPct,
    expenseGrowthPct: input.expenseGrowthPct,
    equityContributions,
    holdLevered,
    finalEquityFlow,
    netSaleBeforeDebt,
    loanPayoffAtExit,
    irrPct,
    exitCapRatePct: input.exitCapRatePct,
    equityWipeout,
  };
  return applyMonthlySchedule(input, baseOutput, scheduleContext);
}
