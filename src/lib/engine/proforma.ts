import { annualDebtService, interestOnlyDebtService, loanBalanceAfterYears } from "./debt";
import { irr, pct } from "./metrics";
import type { CashFlowRow, EngineOutput, EngineWarning, MetricOutput, RevenueUnitInput, UnderwritingInput } from "./types";

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
    input.budget.land + input.budget.hard + input.budget.soft + input.budget.contingency + num(input.budget.other ?? 0);
  const computedInterestReserve =
    input.loanAmount *
    (input.interestRatePct / 100) *
    ((input.constructionMonths + input.leaseUpMonths) / 12) *
    input.avgOutstandingFactor;
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
    input.loanAmount, input.interestRatePct, input.amortYears, input.ioMonths, input.holdYears);
  const saleProceedsToEquity = netSaleBeforeDebt - loanPayoffAtExit;
  const equityWipeout = input.loanAmount > 0 && netSaleBeforeDebt < loanPayoffAtExit;
  const developmentProfit = exitValue - tdc;
  const profitOnCostPct = pct(developmentProfit, tdc);
  // Cost/unit counts dwelling units only; per_sf components (retail/office)
  // are not "units" and must never inflate the count (220 stays 220).
  const unitCount = input.revenueProgram.reduce(
    (sum, row) => sum + (row.rentBasis === "per_unit" ? row.unitCount : 0), 0);
  const costPerUnit = unitCount ? tdc / unitCount : 0;
  const impliedEquity = tdc - input.loanAmount;
  const equity = input.equityAmount && input.equityAmount > 0 ? input.equityAmount : impliedEquity;
  const ltcPct = pct(input.loanAmount, tdc);

  // Debt service follows extracted terms: amortizing payment is the headline
  // whenever an amortization term exists; interest-only is secondary, labeled.
  const amortizingDebtService = annualDebtService(input.loanAmount, input.interestRatePct, input.amortYears);
  const ioDebtService = interestOnlyDebtService(input.loanAmount, input.interestRatePct);
  const annualDs = input.amortYears > 0 ? amortizingDebtService : ioDebtService;
  const dscr = annualDs > 0 ? noi / annualDs : 0;
  const interestOnlyDscr = ioDebtService > 0 ? noi / ioDebtService : 0;
  const stabilizedLeveredCf = noi - annualDs;
  const cashOnCashPct = pct(stabilizedLeveredCf, equity);

  const exitYear = Math.max(1, Math.round(input.holdYears));
  const holdLevered = Array.from({ length: exitYear }, (_, i) => {
    const revenueGrowth = Math.pow(1 + input.rentGrowthPct / 100, i);
    const expenseGrowth = Math.pow(1 + input.expenseGrowthPct / 100, i);
    const yearEgi = egi * revenueGrowth;
    const yearOpex = opex * expenseGrowth;
    return yearEgi - yearOpex - annualDs;
  });
  const interimLevered = holdLevered.slice(0, Math.max(0, exitYear - 1));
  const interimSum = interimLevered.reduce((a, b) => a + b, 0);
  const cumulativeCashShortfall = holdLevered.reduce((sum, cf) => sum + (cf < 0 ? -cf : 0), 0);

  // Equity is non-recourse at exit: the final equity flow floors at zero. On a
  // wipeout the equity multiple is ~0.0x and IRR is not meaningful -- never a
  // positive IRR, never 0% as a placeholder.
  const finalEquityFlow = equityWipeout ? 0 : saleProceedsToEquity;
  const equityMultiple = equity > 0
    ? Math.max(0, (finalEquityFlow + interimSum) / equity)
    : 0;
  const irrFlows = [-equity, ...interimLevered, finalEquityFlow];
  const irrPct = equityWipeout ? Number.NaN : irr(irrFlows);
  const irrStatus: EngineOutput["irrStatus"] = Number.isFinite(irrPct) ? "computed" : "not_meaningful";

  const cashFlows: CashFlowRow[] = [
    { periodYear: 0, lineKey: "equity", amount: -equity },
    { periodYear: 0, lineKey: "construction", amount: -tdcPreFinancing },
    { periodYear: 0, lineKey: "interest", amount: -interestReserve },
    { periodYear: 1, lineKey: "gross_revenue", amount: gpr },
    { periodYear: 1, lineKey: "egi", amount: egi },
    { periodYear: 1, lineKey: "opex", amount: -opex },
    { periodYear: 1, lineKey: "noi", amount: noi },
    { periodYear: 1, lineKey: "debt_service", amount: -annualDs },
    { periodYear: 1, lineKey: "levered_cf", amount: stabilizedLeveredCf },
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
    ? `Equity loss — IRR not meaningful: sale proceeds ${money(netSaleBeforeDebt)} < loan payoff ${money(loanPayoffAtExit)}; EM ≈ 0.0x`
    : Number.isFinite(irrPct)
      ? `IRR from equity cash flows [${irrFlows.map((v) => money(v)).join(", ")}] = ${irrPct.toFixed(2)}%`
      : "IRR not meaningful: equity cash flows do not include both negative and positive values.";

  const metrics: MetricOutput[] = [
    { key: "total_project_cost", label: "Total Project Cost", value: tdc, unit: "$", formula: `TDC = land ${money(input.budget.land)} + hard ${money(input.budget.hard)} + soft ${money(input.budget.soft)} + contingency ${money(input.budget.contingency)}${input.budget.other ? ` + reserves ${money(num(input.budget.other))}` : ""} + financing ${money(interestReserve)} = ${money(tdc)}` },
    { key: "gpr", label: "Gross Potential Rent", value: gpr, unit: "$", formula: `GPR = ${input.revenueProgram.map((r) => `${r.unitType} ${money(componentGpr(r))}`).join(" + ")} = ${money(gpr)}` },
    { key: "projected_revenue", label: "Effective Gross Income", value: egi, unit: "$", formula: `EGI = ${input.revenueProgram.map((r) => `${r.unitType} ${money(componentGpr(r))} x ${(r.occupancyPct ?? input.stabilizedOccupancyPct).toFixed(0)}%`).join(" + ")} + other income ${money(input.otherIncomeAnnual)} = ${money(egi)}` },
    { key: "stabilized_noi", label: "Stabilized NOI", value: noi, unit: "$", formula: `NOI = EGI ${money(egi)} - OpEx ${money(opex)} (${input.expenseRatioPct}%) = ${money(noi)}` },
    { key: "projected_profit", label: "Development Profit", value: developmentProfit, unit: "$", formula: `Development profit = exit value ${money(exitValue)} - TDC ${money(tdc)} = ${money(developmentProfit)}` },
    { key: "profit_margin", label: "Profit on Cost", value: profitOnCostPct, unit: "%", formula: `Profit on cost = ${money(developmentProfit)} / ${money(tdc)} = ${profitOnCostPct.toFixed(2)}%` },
    { key: "equity_requirement", label: "Equity Requirement", value: impliedEquity, unit: "$", formula: `Required equity = TDC ${money(tdc)} - loan ${money(input.loanAmount)} = ${money(impliedEquity)}` },
    { key: "loan_to_cost", label: "Loan-to-Cost", value: ltcPct, unit: "%", formula: `LTC = loan ${money(input.loanAmount)} / TDC ${money(tdc)} = ${ltcPct.toFixed(2)}%` },
    { key: "annual_debt_service", label: "Annual Debt Service (amortizing)", value: annualDs, unit: "$", formula: `ADS = standard mortgage payment on ${money(input.loanAmount)} @ ${input.interestRatePct}% / ${input.amortYears}yr = ${money(annualDs)}` },
    { key: "dscr", label: "DSCR (amortizing)", value: dscr, unit: "x", formula: `DSCR = NOI ${money(noi)} / amortizing debt service ${money(annualDs)} = ${dscr.toFixed(2)}x` },
    { key: "interest_only_dscr", label: "DSCR (interest-only, secondary)", value: interestOnlyDscr, unit: "x", formula: `Interest-only DSCR (secondary) = NOI ${money(noi)} / interest ${money(ioDebtService)} = ${interestOnlyDscr.toFixed(2)}x` },
    { key: "irr_estimate", label: "Levered IRR", value: irrPct, unit: "%", formula: irrFormula },
    { key: "cash_on_cash", label: "Cash-on-Cash", value: cashOnCashPct, unit: "%", formula: `Cash-on-cash = stabilized levered CF ${money(stabilizedLeveredCf)} / committed equity ${money(equity)} = ${cashOnCashPct.toFixed(2)}%` },
    { key: "cumulative_cash_shortfall", label: "Cumulative Cash Shortfall", value: cumulativeCashShortfall, unit: "$", formula: `Cumulative cash shortfall during hold = sum of negative annual levered cash flow over ${exitYear} years = ${money(cumulativeCashShortfall)}` },
    { key: "yield_on_cost", label: "Going-in Yield on Cost", value: yieldOnCostPct, unit: "%", formula: `Yield on cost = NOI ${money(noi)} / TDC ${money(tdc)} = ${yieldOnCostPct.toFixed(2)}%` },
    { key: "development_spread", label: "Development Spread", value: developmentSpreadBps, unit: "bps", formula: `Development spread = yield ${yieldOnCostPct.toFixed(2)}% - exit cap ${input.exitCapRatePct.toFixed(2)}% = ${developmentSpreadBps.toFixed(0)} bps` },
    { key: "exit_value", label: "Exit Value", value: exitValue, unit: "$", formula: `Exit value = NOI ${money(noi)} / exit cap ${input.exitCapRatePct.toFixed(2)}% = ${money(exitValue)}` },
    { key: "net_sale_proceeds", label: "Net Sale Proceeds", value: netSaleBeforeDebt, unit: "$", formula: `Net sale = exit value ${money(exitValue)} x (1 - selling costs ${input.sellingCostsPct}%) = ${money(netSaleBeforeDebt)}` },
    { key: "loan_payoff_at_exit", label: "Loan Payoff at Exit", value: loanPayoffAtExit, unit: "$", formula: `Loan balance after ${input.holdYears}yr (${input.ioMonths}mo IO, ${input.amortYears}yr amort) = ${money(loanPayoffAtExit)}` },
    { key: "equity_multiple", label: "Equity Multiple", value: equityMultiple, unit: "x", formula: equityWipeout ? `Equity wipeout: sale proceeds ${money(netSaleBeforeDebt)} < loan payoff ${money(loanPayoffAtExit)} → EM ≈ 0.0x` : `Equity multiple = distributions ${money(finalEquityFlow + interimSum)} / equity ${money(equity)} = ${equityMultiple.toFixed(2)}x` },
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
      annualDebtService: annualDs,
      dscr,
      interestOnlyDscr,
      cashOnCashPct,
      cumulativeCashShortfall,
      equityMultiple,
      irrPct,
    },
  };
}
