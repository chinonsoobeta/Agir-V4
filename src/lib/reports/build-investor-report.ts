// Investor Report: the equity/IC package. Reuses the IC memo report assembly
// (exec stats, sources & uses, revenue build, scenario analysis, risks,
// reconciliation flags, required actions, document sources, footnotes) and adds
// an explicit Key Returns section that shows IRR status (N/M, never 0.00%).

import { buildMemoReport, type MemoReport } from "../memo-report";
import type { ReportData } from "./report-data.server";
import { makeAccessors, reportVerdict, irrStatusText, money, pct, bps, x } from "./report-common";

export function buildInvestorReport(
  data: ReportData,
  opts: { generatedLabel: string },
): MemoReport {
  const verdict = reportVerdict(data);
  const report = buildMemoReport({
    project: data.project ?? {},
    assumptions: data.assumptions,
    engineInputs: data.engineInputs,
    outputs: data.outputs,
    flags: data.flags,
    risks: data.risks,
    documents: data.documents,
    verdict,
    generationMode: "deterministic",
    generatedLabel: opts.generatedLabel,
  });

  const { oVal } = makeAccessors(data);
  const row = (label: string, key: string, unit: string): string[] => {
    const v = oVal("base", key);
    return [
      label,
      v == null
        ? "Not available"
        : unit === "$"
          ? money(v)
          : unit === "%"
            ? pct(v)
            : unit === "x"
              ? x(v)
              : unit === "bps"
                ? bps(v)
                : String(v),
    ];
  };
  const keyReturns: string[][] = [
    row("Going-in Yield on Cost", "yield_on_cost", "%"),
    row("Development Spread", "development_spread", "bps"),
    row("Exit Value", "exit_value", "$"),
    row("Net Sale Proceeds", "net_sale_proceeds", "$"),
    row("Loan Payoff at Exit", "loan_payoff_at_exit", "$"),
    row("Development Profit", "projected_profit", "$"),
    row("Equity Multiple", "equity_multiple", "x"),
    ["Levered IRR", irrStatusText(data)],
    row("Cash-on-Cash", "cash_on_cash", "%"),
    row("Cumulative Cash Shortfall", "cumulative_cash_shortfall", "$"),
  ];

  // Insert Key Returns right after the revenue build (or near the front).
  const idx = report.sections.findIndex((s) => s.heading.startsWith("Scenario Analysis"));
  const keyReturnsSection = {
    heading: "Key Returns",
    table: { columns: ["Metric", "Value"], rows: keyReturns },
  };
  if (idx >= 0) report.sections.splice(idx, 0, keyReturnsSection);
  else report.sections.push(keyReturnsSection);

  return { ...report, title: "Investor Report" };
}
