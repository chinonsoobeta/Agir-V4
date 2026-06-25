import { annualDebtService, interestOnlyDebtService, loanBalanceAfterYears } from "./debt";
import { pct, xirr } from "./metrics";
import type { CashFlowRow, EngineOutput, EngineWarning, MetricOutput, RevenueUnitInput, UnderwritingInput } from "./types";
import { runEuropeanWaterfall, type TimedCashFlow } from "./waterfall";

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
  const seniorDebt = input.loanAmount;
  const mezzDebt = Math.max(0, input.mezzanine?.amount ?? 0);
  const totalDebt = seniorDebt + mezzDebt;
  const tdcPreFinancing =
    input.budget.land + input.budget.hard + input.budget.soft + input.budget.contingency + num(input.budget.other ?? 0);
  const reserveYears = (input.constructionMonths + input.leaseUpMonths) / 12;
  const computedSeniorInterestReserve =
    seniorDebt * (input.interestRatePct / 100) * reserveYears * input.avgOutstandingFactor;
  const computedMezzInterestReserve =
    mezzDebt *
    ((input.mezzanine?.interestRatePct ?? 0) / 100) *
    reserveYears *
    input.avgOutstandingFactor;
  const computedInterestReserve = computedSeniorInterestReserve + computedMezzInterestReserve;
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
  const loanPayoffAtExit = loanBalanceAfterYears(
    seniorDebt,
    input.interestRatePct,
    input.amortYears,
    input.ioMonths,
    input.holdYears,
  ) + loanBalanceAfterYears(
    mezzDebt,
    input.mezzanine?.interestRatePct ?? 0,
    input.mezzanine?.amortYears ?? 0,
    input.mezzanine?.ioMonths ?? 0,
    input.holdYears,
  );
  const saleProceedsToEquity = netSaleBeforeDebt - loanPayoffAtExit;
  const equityWipeout = totalDebt > 0 && netSaleBeforeDebt < loanPayoffAtExit;
  const developmentProfit = exitValue - tdc;
  const profitOnCostPct = pct(developmentProfit, tdc);
  // Cost/unit counts dwelling units only; per_sf components (retail/office)
  // are not "units" and must never inflate the count (220 stays 220).
  const unitCount = input.revenueProgram.reduce(
    (sum, row) => sum + (row.rentBasis === "per_unit" ? row.unitCount : 0), 0);
  const costPerUnit = unitCount ? tdc / unitCount : 0;
  const impliedEquity = tdc - totalDebt;
  const equity = input.equityAmount && input.equityAmount > 0 ? input.equityAmount : impliedEquity;
  const ltcPct = pct(totalDebt, tdc);

  // Debt service follows extracted terms: amortizing payment is the headline
  // whenever an amortization term exists; interest-only is secondary, labeled.
  const seniorAmortizingDebtService = annualDebtService(
    seniorDebt,
    input.interestRatePct,
    input.amortYears,
  );
  const seniorIoDebtService = interestOnlyDebtService(seniorDebt, input.interestRatePct);
  const seniorAnnualDebtService =
    input.amortYears > 0 ? seniorAmortizingDebtService : seniorIoDebtService;
  const mezzAmortizingDebtService = annualDebtService(
    mezzDebt,
    input.mezzanine?.interestRatePct ?? 0,
    input.mezzanine?.amortYears ?? 0,
  );
  const mezzIoDebtService = interestOnlyDebtService(
    mezzDebt,
    input.mezzanine?.interestRatePct ?? 0,
  );
  const mezzAnnualDebtService =
    (input.mezzanine?.amortYears ?? 0) > 0 ? mezzAmortizingDebtService : mezzIoDebtService;
  const allInAnnualDebtService = seniorAnnualDebtService + mezzAnnualDebtService;
  const allInInterestOnlyDebtService = seniorIoDebtService + mezzIoDebtService;
  const seniorDscr = seniorAnnualDebtService > 0 ? noi / seniorAnnualDebtService : 0;
  const allInDscr = allInAnnualDebtService > 0 ? noi / allInAnnualDebtService : 0;
  const dscr = allInDscr;
  const interestOnlyDscr =
    allInInterestOnlyDebtService > 0 ? noi / allInInterestOnlyDebtService : 0;

  // Debt service actually DUE in hold-year `year` (1-indexed): interest-only
  // during the IO period, the amortizing payment afterwards, blended across the
  // year that straddles conversion. The headline DSCR stays amortizing (a
  // conservative coverage reference), but the cash-flow waterfall, returns and
  // break-even must use the payment actually made -- otherwise the model bills
  // amortization that the loan balance (which honors IO, see debt.ts) never
  // applies.
  const trancheDebtServiceForYear = (
    year: number,
    ioMonths: number,
    amortYears: number,
    ioDebtService: number,
    amortizingDebtService: number,
  ) => {
    if (amortYears <= 0) return ioDebtService;
    const ioMonthsInYear = Math.min(12, Math.max(0, ioMonths - (year - 1) * 12));
    return (
      ioMonthsInYear * (ioDebtService / 12) +
      (12 - ioMonthsInYear) * (amortizingDebtService / 12)
    );
  };
  const debtServiceForYear = (year: number) =>
    trancheDebtServiceForYear(
      year,
      input.ioMonths,
      input.amortYears,
      seniorIoDebtService,
      seniorAmortizingDebtService,
    ) +
    trancheDebtServiceForYear(
      year,
      input.mezzanine?.ioMonths ?? 0,
      input.mezzanine?.amortYears ?? 0,
      mezzIoDebtService,
      mezzAmortizingDebtService,
    );
  const year1DebtService = debtServiceForYear(1);
  const stabilizedLeveredCf = noi - year1DebtService;
  const cashOnCashPct = equity > 0 ? pct(stabilizedLeveredCf, equity) : 0;

  // Debt yield = NOI / loan: the lender's primary sizing metric, independent of
  // rate and amortization (which DSCR and the loan constant conflate).
  const debtYieldPct = totalDebt > 0 ? pct(noi, totalDebt) : 0;

  // Break-even occupancy: the blended physical occupancy at which NOI just
  // covers the debt service actually due (levered CF = 0), holding the expense
  // ratio and other income fixed. Uses the in-force (year-1) debt service so it
  // matches the cash-flow waterfall and the covenant test.
  const breakEvenOccupancyPct =
    gpr > 0 && input.expenseRatioPct < 100
      ? ((year1DebtService / (1 - input.expenseRatioPct / 100) - input.otherIncomeAnnual) / gpr) * 100
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
  // Returns are phased on the real development timeline: equity is committed at
  // t=0, but the stabilized operating cash flows and the sale do not begin until
  // construction + lease-up is complete. Discounting each flow at its true time
  // (a fractional-year delay) instead of assuming year-1 stabilization is the
  // difference between a turnkey acquisition and a multi-year ground-up build --
  // without it, levered IRR is systematically overstated on development deals.
  // (The equity multiple is a money multiple and stays intentionally timing-free.)
  const developmentYears = (input.constructionMonths + input.leaseUpMonths) / 12;
  const equityContributionFlows: TimedCashFlow[] =
    input.phaseEquityDraws && input.constructionMonths > 0
      ? Array.from({ length: Math.max(1, Math.round(input.constructionMonths)) }, (_, month) => ({
          t: month / 12,
          amount: -equity / Math.max(1, Math.round(input.constructionMonths)),
        }))
      : [{ t: 0, amount: -equity }];
  const distributionFlows: TimedCashFlow[] = [
    ...interimLevered.map((cf, i) => ({ t: developmentYears + i + 1, amount: cf })),
    { t: developmentYears + exitYear, amount: finalEquityFlow },
  ];
  const irrTimedFlows = [...equityContributionFlows, ...distributionFlows];
  const irrFlows = irrTimedFlows.map((flow) => flow.amount);
  // IRR and the equity multiple agree on a total loss: when equity recovers
  // nothing (distributions <= 0) or the sale wipes out, IRR is not meaningful
  // and the equity multiple floors at ~0.0x.
  const irrPct =
    equityWipeout || (equity > 0 && totalDistributions <= 0) ? Number.NaN : xirr(irrTimedFlows);
  const irrStatus: EngineOutput["irrStatus"] = Number.isFinite(irrPct) ? "computed" : "not_meaningful";
  const waterfall = runEuropeanWaterfall(irrTimedFlows, input.waterfall);
  const lpIrrPct = waterfall.enabled ? waterfall.lpIrrPct : irrPct;
  const lpEquityMultiple = waterfall.enabled
    ? waterfall.lpEquityMultiple
    : equityMultiple;
  const gpIrrPct = waterfall.gpIrrPct;
  const gpEquityMultiple = waterfall.gpEquityMultiple;
  const gpPromote = waterfall.gpPromote;

  const equityLedgerRows: CashFlowRow[] = input.phaseEquityDraws
    ? [...equityContributionFlows
        .reduce((rows, flow) => {
          const year = Math.floor(flow.t);
          rows.set(year, (rows.get(year) ?? 0) + flow.amount);
          return rows;
        }, new Map<number, number>())
        .entries()].map(([periodYear, amount]) => ({
        periodYear,
        lineKey: "equity" as const,
        amount,
      }))
    : [{ periodYear: 0, lineKey: "equity", amount: -equity }];

  const cashFlows: CashFlowRow[] = [
    ...equityLedgerRows,
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

  const irrFormula = equityWipeout
    ? `Equity loss: IRR not meaningful: sale proceeds ${money(netSaleBeforeDebt)} < loan payoff ${money(loanPayoffAtExit)}; EM ≈ 0.0x`
    : Number.isFinite(irrPct)
      ? `IRR from equity cash flows [${irrFlows.map((v) => money(v)).join(", ")}], with equity ${input.phaseEquityDraws && input.constructionMonths > 0 ? `drawn straight-line monthly over ${input.constructionMonths} construction months` : "committed at t=0"} and operating cash flow and sale phased ${input.constructionMonths} months construction + ${input.leaseUpMonths} months lease-up = ${irrPct.toFixed(2)}%`
      : "IRR not meaningful: equity cash flows do not include both negative and positive values.";

  const metrics: MetricOutput[] = [
    { key: "total_project_cost", label: "Total Project Cost", value: tdc, unit: "$", formula: `TDC = land ${money(input.budget.land)} + hard ${money(input.budget.hard)} + soft ${money(input.budget.soft)} + contingency ${money(input.budget.contingency)}${input.budget.other ? ` + reserves ${money(num(input.budget.other))}` : ""} + financing ${money(interestReserve)} = ${money(tdc)}` },
    { key: "gpr", label: "Gross Potential Rent", value: gpr, unit: "$", formula: `GPR = ${input.revenueProgram.map((r) => `${r.unitType} ${money(componentGpr(r))}`).join(" + ")} = ${money(gpr)}` },
    { key: "projected_revenue", label: "Effective Gross Income", value: egi, unit: "$", formula: `EGI = ${input.revenueProgram.map((r) => `${r.unitType} ${money(componentGpr(r))} x ${(r.occupancyPct ?? input.stabilizedOccupancyPct).toFixed(0)}%`).join(" + ")} + other income ${money(input.otherIncomeAnnual)} = ${money(egi)}` },
    { key: "stabilized_noi", label: "Stabilized NOI", value: noi, unit: "$", formula: `NOI = EGI ${money(egi)} - OpEx ${money(opex)} (${input.expenseRatioPct}%) = ${money(noi)}` },
    { key: "projected_profit", label: "Development Profit", value: developmentProfit, unit: "$", formula: `Development profit = exit value ${money(exitValue)} - TDC ${money(tdc)} = ${money(developmentProfit)}` },
    { key: "profit_margin", label: "Profit on Cost", value: profitOnCostPct, unit: "%", formula: `Profit on cost = ${money(developmentProfit)} / ${money(tdc)} = ${profitOnCostPct.toFixed(2)}%` },
    { key: "equity_requirement", label: "Equity Requirement", value: impliedEquity, unit: "$", formula: `Required equity = TDC ${money(tdc)} - total debt ${money(totalDebt)} = ${money(impliedEquity)}` },
    { key: "loan_to_cost", label: "Loan-to-Cost", value: ltcPct, unit: "%", formula: `LTC = total debt ${money(totalDebt)} / TDC ${money(tdc)} = ${ltcPct.toFixed(2)}%` },
    { key: "senior_annual_debt_service", label: "Senior Annual Debt Service", value: seniorAnnualDebtService, unit: "$", formula: `Senior ADS = mortgage payment on ${money(seniorDebt)} @ ${input.interestRatePct}% / ${input.amortYears}yr = ${money(seniorAnnualDebtService)}` },
    { key: "annual_debt_service", label: "All-in Annual Debt Service", value: allInAnnualDebtService, unit: "$", formula: `All-in ADS = senior ${money(seniorAnnualDebtService)} + mezzanine ${money(mezzAnnualDebtService)} = ${money(allInAnnualDebtService)}` },
    { key: "senior_dscr", label: "Senior DSCR", value: seniorDscr, unit: "x", formula: `Senior DSCR = NOI ${money(noi)} / senior debt service ${money(seniorAnnualDebtService)} = ${seniorDscr.toFixed(2)}x` },
    { key: "dscr", label: "All-in DSCR", value: dscr, unit: "x", formula: `All-in DSCR = NOI ${money(noi)} / all-in debt service ${money(allInAnnualDebtService)} = ${dscr.toFixed(2)}x` },
    { key: "interest_only_dscr", label: "DSCR (interest-only, secondary)", value: interestOnlyDscr, unit: "x", formula: `Interest-only DSCR (secondary) = NOI ${money(noi)} / all-in interest ${money(allInInterestOnlyDebtService)} = ${interestOnlyDscr.toFixed(2)}x` },
    { key: "irr_estimate", label: "Levered IRR", value: irrPct, unit: "%", formula: irrFormula },
    { key: "cash_on_cash", label: "Cash-on-Cash", value: cashOnCashPct, unit: "%", formula: `Cash-on-cash = stabilized levered CF ${money(stabilizedLeveredCf)} / committed equity ${money(equity)} = ${cashOnCashPct.toFixed(2)}%` },
    { key: "debt_yield", label: "Debt Yield", value: debtYieldPct, unit: "%", formula: `Debt yield = NOI ${money(noi)} / total debt ${money(totalDebt)} = ${debtYieldPct.toFixed(2)}%` },
    { key: "break_even_occupancy", label: "Break-even Occupancy", value: breakEvenOccupancyPct, unit: "%", formula: `Break-even occupancy = (in-force debt service ${money(year1DebtService)} / (1 - opex ${input.expenseRatioPct}%) - other income ${money(input.otherIncomeAnnual)}) / GPR ${money(gpr)} = ${breakEvenOccupancyPct.toFixed(1)}%` },
    { key: "cumulative_cash_shortfall", label: "Cumulative Cash Shortfall", value: cumulativeCashShortfall, unit: "$", formula: `Cumulative cash shortfall during hold = sum of negative annual levered cash flow over ${exitYear} years = ${money(cumulativeCashShortfall)}` },
    { key: "yield_on_cost", label: "Going-in Yield on Cost", value: yieldOnCostPct, unit: "%", formula: `Yield on cost = NOI ${money(noi)} / TDC ${money(tdc)} = ${yieldOnCostPct.toFixed(2)}%` },
    { key: "development_spread", label: "Development Spread", value: developmentSpreadBps, unit: "bps", formula: `Development spread = yield ${yieldOnCostPct.toFixed(2)}% - exit cap ${input.exitCapRatePct.toFixed(2)}% = ${developmentSpreadBps.toFixed(0)} bps` },
    { key: "exit_value", label: "Exit Value", value: exitValue, unit: "$", formula: `Exit value = NOI ${money(noi)} / exit cap ${input.exitCapRatePct.toFixed(2)}% = ${money(exitValue)}` },
    { key: "net_sale_proceeds", label: "Net Sale Proceeds", value: netSaleBeforeDebt, unit: "$", formula: `Net sale = exit value ${money(exitValue)} x (1 - selling costs ${input.sellingCostsPct}%) = ${money(netSaleBeforeDebt)}` },
    { key: "loan_payoff_at_exit", label: "Loan Payoff at Exit", value: loanPayoffAtExit, unit: "$", formula: `Loan payoff = senior and mezzanine balances after ${input.holdYears}yr = ${money(loanPayoffAtExit)}` },
    { key: "equity_multiple", label: "Equity Multiple", value: equityMultiple, unit: "x", formula: equityWipeout ? `Equity wipeout: sale proceeds ${money(netSaleBeforeDebt)} < loan payoff ${money(loanPayoffAtExit)} → EM ≈ 0.0x` : `Equity multiple = distributions ${money(finalEquityFlow + interimSum)} / equity ${money(equity)} = ${equityMultiple.toFixed(2)}x` },
    { key: "lp_irr", label: "LP IRR", value: lpIrrPct, unit: "%", formula: waterfall.enabled ? `LP IRR = XIRR of LP contributions and waterfall distributions after capital return, ${input.waterfall?.preferredReturnPct ?? 0}% preferred return, catch-up ${input.waterfall?.gpCatchUp ? "on" : "off"}, and promote tiers = ${Number.isFinite(lpIrrPct) ? `${lpIrrPct.toFixed(2)}%` : "not meaningful"}` : `No waterfall inputs: LP IRR equals deal levered IRR ${Number.isFinite(irrPct) ? `${irrPct.toFixed(2)}%` : "not meaningful"}` },
    { key: "lp_equity_multiple", label: "LP Equity Multiple", value: lpEquityMultiple, unit: "x", formula: waterfall.enabled ? `LP equity multiple = LP distributions / LP contributed equity = ${lpEquityMultiple.toFixed(2)}x` : `No waterfall inputs: LP equity multiple equals deal equity multiple ${equityMultiple.toFixed(2)}x` },
    { key: "gp_irr", label: "GP IRR", value: gpIrrPct, unit: "%", formula: waterfall.enabled && Number.isFinite(gpIrrPct) ? `GP IRR = XIRR of GP contributions and waterfall distributions = ${gpIrrPct.toFixed(2)}%` : "GP IRR not meaningful: no enabled waterfall or no positive GP distribution." },
    { key: "gp_equity_multiple", label: "GP Equity Multiple", value: gpEquityMultiple, unit: "x", formula: waterfall.enabled ? `GP equity multiple = GP distributions / GP contributed equity = ${gpEquityMultiple.toFixed(2)}x` : "No waterfall inputs: GP equity multiple = 0.00x." },
    { key: "gp_promote", label: "GP Promote", value: gpPromote, unit: "$", formula: waterfall.enabled ? `GP promote = GP profit distributions above the GP's pro-rata equity share = ${money(gpPromote)}` : "No waterfall inputs: GP promote = 0." },
    { key: "cost_per_unit", label: "Cost / Unit", value: costPerUnit, unit: "$", formula: `Cost per unit = TDC ${money(tdc)} / ${unitCount} units = ${money(costPerUnit)}` },
  ];

  return {
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
      totalDebt,
      seniorAnnualDebtService,
      allInAnnualDebtService,
      annualDebtService: allInAnnualDebtService,
      seniorDscr,
      allInDscr,
      dscr,
      interestOnlyDscr,
      cashOnCashPct,
      cumulativeCashShortfall,
      equityMultiple,
      irrPct,
      debtYieldPct,
      breakEvenOccupancyPct,
      lpIrrPct,
      lpEquityMultiple,
      gpIrrPct,
      gpEquityMultiple,
      gpPromote,
    },
  };
}
