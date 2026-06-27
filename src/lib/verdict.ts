export type VerdictCode = "APPROVE" | "APPROVE_WITH_CONDITIONS" | "REJECT";

export type VerdictMetricMap = {
  equity_multiple?: number;
  profit_margin?: number;
  yield_on_cost?: number;
  development_spread?: number;
  stress_dscr?: number;
  stress_equity_multiple?: number;
  // Hard-fail conditions: an equity wipeout or an unresolved error-severity
  // reconciliation flag is an automatic REJECT regardless of gate count.
  equity_wipeout?: boolean;
  error_flag_count?: number;
};

export function computeInvestmentVerdict(metrics: VerdictMetricMap) {
  const gates = [
    {
      key: "equity_multiple",
      label: "Equity Multiple >= 1.50x",
      pass: (metrics.equity_multiple ?? 0) >= 1.5,
      actual: metrics.equity_multiple,
    },
    {
      key: "profit_margin",
      label: "Profit Margin >= 15%",
      pass: (metrics.profit_margin ?? 0) >= 15,
      actual: metrics.profit_margin,
    },
    {
      key: "development_spread",
      label: "Yield-on-Cost Spread >= 100 bps",
      pass: (metrics.development_spread ?? 0) >= 100,
      actual: metrics.development_spread,
    },
    {
      key: "stress_dscr",
      label: "Stress DSCR >= 1.20x",
      pass: (metrics.stress_dscr ?? 0) >= 1.2,
      actual: metrics.stress_dscr,
    },
    {
      key: "stress_equity_multiple",
      label: "Stress Equity Multiple >= 1.00x",
      pass: (metrics.stress_equity_multiple ?? 0) >= 1,
      actual: metrics.stress_equity_multiple,
    },
  ];
  const failures = gates.filter((gate) => !gate.pass);
  const hardFail = metrics.equity_wipeout === true || (metrics.error_flag_count ?? 0) > 0;
  const code: VerdictCode =
    hardFail || failures.length > 2
      ? "REJECT"
      : failures.length === 0
        ? "APPROVE"
        : "APPROVE_WITH_CONDITIONS";
  return { code, gates, hardFail };
}
