import { f, money, metric, pct } from "../findings-rules";
import type { Finding, NormalizedFindingsInput } from "../findings-types";

export function capitalStackFindings(input: NormalizedFindingsInput): Finding[] {
  const findings: Finding[] = [];
  const tdc = metric(input.base, "total_project_cost");
  const loan = input.input?.loanAmount ?? null;
  const equity = input.input?.equityAmount ?? null;
  const requiredEquity = metric(input.base, "equity_requirement");
  const ltc = metric(input.base, "loan_to_cost");

  if (tdc != null && loan != null && equity != null) {
    const sources = loan + equity;
    const gap = sources - tdc;
    if (Math.abs(gap) <= 1) {
      findings.push(
        f(
          "capital.fully_funded",
          "strength",
          "medium",
          "Fully Funded Capital Stack",
          [`Sources ${money(sources)}`, `Uses ${money(tdc)}`],
          { sources, uses: tdc, difference: gap },
          "Approved sources equal total development cost.",
          "underwriting",
        ),
      );
    } else {
      findings.push(
        f(
          "capital.sources_uses_gap",
          "weakness",
          "high",
          "Sources and Uses Gap",
          [`Sources ${money(sources)}`, `Uses ${money(tdc)}`, `Difference ${money(gap)}`],
          { sources, uses: tdc, difference: gap },
          "Documented sources do not tie to total development cost.",
          "underwriting",
          "Resolve the sources and uses difference before approval.",
        ),
      );
    }
  }

  if (requiredEquity != null && equity != null && Math.abs(requiredEquity - equity) > 1) {
    findings.push(
      f(
        "capital.equity_mismatch",
        "weakness",
        "medium",
        "Committed Equity Differs From Required Equity",
        [`Required equity ${money(requiredEquity)}`, `Committed equity ${money(equity)}`],
        {
          required_equity: requiredEquity,
          committed_equity: equity,
          difference: equity - requiredEquity,
        },
        "The deterministic equity requirement does not match documented committed equity.",
        "underwriting",
        "Confirm whether additional equity is available or revise the capital plan.",
      ),
    );
  }

  if (ltc != null) {
    findings.push(
      f(
        "capital.ltc_observed",
        "covenant",
        ltc > 70 ? "medium" : "low",
        "Loan-to-Cost Test",
        [`LTC ${pct(ltc)}`],
        { loan_to_cost_pct: ltc },
        ltc > 70
          ? "Leverage is elevated relative to total cost."
          : "Loan-to-cost is observable from approved capital stack inputs.",
        "underwriting",
      ),
    );
  }

  return findings;
}
