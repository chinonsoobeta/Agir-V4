import { f, metric, money } from "../findings-rules";
import type { Driver, Finding, NormalizedFindingsInput } from "../findings-types";

const SCENARIO_DRIVER_NAMES: Record<string, string> = {
  cap_expansion: "Exit Cap Rate",
  cost_overrun: "Construction Cost",
  rate_shock: "Interest Rate",
  revenue_down: "NOI",
  occupancy_down: "Occupancy",
  expense_inflation: "Operating Expenses",
  combined: "Combined Stress",
};

export function scenarioFindings(input: NormalizedFindingsInput): {
  findings: Finding[];
  primaryDrivers: Driver[];
  downsideDrivers: Driver[];
} {
  const findings: Finding[] = [];
  const baseProfit = metric(input.base, "projected_profit");
  const drivers: Driver[] = [];

  for (const [key, metrics] of Object.entries(input.scenarios)) {
    if (key === "base") continue;
    const profit = metric(metrics, "projected_profit");
    if (baseProfit != null && profit != null) {
      const impact = profit - baseProfit;
      drivers.push({
        rank: 0,
        name: SCENARIO_DRIVER_NAMES[key] ?? key,
        impact,
        rationale: `${SCENARIO_DRIVER_NAMES[key] ?? key} scenario changes development profit by ${money(impact)} versus base case.`,
      });
    }
  }

  const capProfit = metric(input.scenarios.cap_expansion ?? {}, "projected_profit");
  if (capProfit != null && capProfit < 0) {
    findings.push(
      f(
        "scenario.cap_rate_sensitivity",
        "risk",
        "high",
        "Cap Rate Sensitivity",
        [`Cap expansion profit ${money(capProfit)}`],
        { cap_expansion_profit: capProfit },
        "The cap-rate expansion scenario produces negative development profit.",
        "scenario",
        "Increase development spread and reduce dependence on favorable exit capitalization rates.",
      ),
    );
  }

  const revenueProfit = metric(input.scenarios.revenue_down ?? {}, "projected_profit");
  if (revenueProfit != null && revenueProfit < 0) {
    findings.push(
      f(
        "scenario.revenue_sensitivity",
        "risk",
        "high",
        "Revenue Sensitivity",
        [`Revenue downside profit ${money(revenueProfit)}`],
        { revenue_downside_profit: revenueProfit },
        "The revenue downside scenario produces negative development profit.",
        "scenario",
        "Improve stress resilience through higher NOI, lower cost basis, or reduced leverage.",
      ),
    );
  }

  const costProfit = metric(input.scenarios.cost_overrun ?? {}, "projected_profit");
  if (costProfit != null && costProfit < 0) {
    findings.push(
      f(
        "scenario.cost_overrun_sensitivity",
        "risk",
        "medium",
        "Cost Overrun Risk",
        [`Cost overrun profit ${money(costProfit)}`],
        { cost_overrun_profit: costProfit },
        "The cost-overrun scenario produces negative development profit.",
        "scenario",
        "Increase contingency or rebid construction costs before approval.",
      ),
    );
  }

  const rankedDownside = [...drivers]
    .sort((a, b) => a.impact - b.impact)
    .slice(0, 5)
    .map((d, i) => ({ ...d, rank: i + 1 }));
  const rankedUpside = [...drivers]
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 5)
    .map((d, i) => ({ ...d, rank: i + 1 }));

  return { findings, primaryDrivers: rankedUpside, downsideDrivers: rankedDownside };
}
