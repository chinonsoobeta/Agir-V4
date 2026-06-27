import { FINDING_THRESHOLDS, bps, f, metric, pct, x } from "../findings-rules";
import type { Finding, NormalizedFindingsInput } from "../findings-types";

export function returnFindings(input: NormalizedFindingsInput): Finding[] {
  const findings: Finding[] = [];
  const spread = metric(input.base, "development_spread");
  const equityMultiple = metric(input.base, "equity_multiple");
  const profitMargin = metric(input.base, "profit_margin");
  const yoc = metric(input.base, "yield_on_cost");

  if (spread != null && spread < FINDING_THRESHOLDS.thinSpreadBps) {
    findings.push(
      f(
        "returns.thin_spread",
        "weakness",
        "high",
        "Thin Development Spread",
        [`Development spread ${bps(spread)}`, `Threshold ${bps(FINDING_THRESHOLDS.thinSpreadBps)}`],
        { development_spread_bps: spread, threshold_bps: FINDING_THRESHOLDS.thinSpreadBps },
        "The project does not generate sufficient yield-on-cost premium over the approved exit cap.",
        "underwriting",
        `Increase spread until it exceeds ${bps(FINDING_THRESHOLDS.thinSpreadBps)}.`,
      ),
    );
  } else if (spread != null) {
    findings.push(
      f(
        "returns.spread_pass",
        "strength",
        "medium",
        "Positive Development Spread",
        [`Development spread ${bps(spread)}`],
        { development_spread_bps: spread },
        "Yield on cost exceeds the exit capitalization rate by the required margin.",
        "underwriting",
      ),
    );
  }

  if (equityMultiple != null && equityMultiple < FINDING_THRESHOLDS.weakEquityMultiple) {
    findings.push(
      f(
        "returns.low_equity_multiple",
        "weakness",
        "high",
        "Low Equity Multiple",
        [
          `Equity multiple ${x(equityMultiple)}`,
          `Threshold ${x(FINDING_THRESHOLDS.weakEquityMultiple)}`,
        ],
        { equity_multiple: equityMultiple, threshold: FINDING_THRESHOLDS.weakEquityMultiple },
        "Projected distributions are weak relative to required equity.",
        "underwriting",
        "Improve exit proceeds, reduce cost basis, or resize leverage before approval.",
      ),
    );
  }

  if (profitMargin != null && profitMargin < FINDING_THRESHOLDS.weakProfitMarginPct) {
    findings.push(
      f(
        "returns.low_profit_margin",
        "weakness",
        "medium",
        "Insufficient Profit Margin",
        [
          `Profit margin ${pct(profitMargin)}`,
          `Threshold ${pct(FINDING_THRESHOLDS.weakProfitMarginPct)}`,
        ],
        { profit_margin_pct: profitMargin, threshold_pct: FINDING_THRESHOLDS.weakProfitMarginPct },
        "The base case leaves limited profit cushion relative to total development cost.",
        "underwriting",
        "Improve pricing, rents, costs, or exit assumptions until profit margin clears the threshold.",
      ),
    );
  }

  if (yoc != null) {
    findings.push(
      f(
        "returns.yoc_observed",
        yoc >= 0 ? "strength" : "weakness",
        "low",
        "Yield on Cost Observation",
        [`Yield on cost ${pct(yoc)}`],
        { yield_on_cost_pct: yoc },
        "Yield on cost is produced by deterministic NOI divided by total development cost.",
        "underwriting",
      ),
    );
  }

  return findings;
}
