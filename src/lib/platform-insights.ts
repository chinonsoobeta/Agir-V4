import type { DealSummary } from "./portfolio.functions";

export type PortfolioInsight = {
  id: string;
  severity: "positive" | "watch" | "critical";
  title: string;
  detail: string;
  action: string;
};

export function buildPortfolioInsights(deals: DealSummary[]): PortfolioInsight[] {
  if (!deals.length) return [];
  const totalCapital = deals.reduce((sum, deal) => sum + deal.capital, 0) || 1;
  const insights: PortfolioInsight[] = [];

  const largest = [...deals].sort((a, b) => b.capital - a.capital)[0];
  const largestShare = largest.capital / totalCapital;
  if (largestShare >= 0.4) {
    insights.push({
      id: "concentration",
      severity: largestShare >= 0.55 ? "critical" : "watch",
      title: "Single-deal concentration",
      detail: `${largest.name} represents ${Math.round(largestShare * 100)}% of aggregate capital.`,
      action: "Review exposure limits and downside liquidity.",
    });
  }

  const weakConfidence = deals.filter((deal) => deal.confidenceScore < 65);
  if (weakConfidence.length) {
    insights.push({
      id: "confidence",
      severity: weakConfidence.length / deals.length >= 0.4 ? "critical" : "watch",
      title: "Decision confidence gap",
      detail: `${weakConfidence.length} deal${weakConfidence.length === 1 ? "" : "s"} fall below 65/100 confidence.`,
      action: "Resolve missing, conflicting, or weakly sourced assumptions.",
    });
  }

  const highRisk = deals.filter(
    (deal) => deal.riskRating === "High" || deal.riskRating === "Critical",
  );
  if (highRisk.length) {
    insights.push({
      id: "risk",
      severity: highRisk.some((deal) => deal.riskRating === "Critical") ? "critical" : "watch",
      title: "Elevated portfolio risk",
      detail: `${highRisk.length} active decision${highRisk.length === 1 ? " is" : "s are"} rated High or Critical.`,
      action: "Prioritize stress-case review and mitigation conditions.",
    });
  }

  const stale = deals.filter((deal) => {
    const age = Date.now() - new Date(deal.updatedAt).getTime();
    return age > 14 * 24 * 60 * 60 * 1000 && !["Approved", "Rejected"].includes(deal.stage);
  });
  if (stale.length) {
    insights.push({
      id: "velocity",
      severity: "watch",
      title: "Pipeline velocity",
      detail: `${stale.length} deal${stale.length === 1 ? " has" : "s have"} had no update in 14 days.`,
      action: "Assign a next action and refresh the target close date.",
    });
  }

  if (!insights.length) {
    insights.push({
      id: "healthy",
      severity: "positive",
      title: "Portfolio controls are healthy",
      detail:
        "No material concentration, confidence, risk, or velocity exception is currently visible.",
      action: "Continue monitoring live underwriting and execution signals.",
    });
  }

  return insights;
}

export function daysUntil(date: string | null | undefined) {
  if (!date) return null;
  return Math.ceil((new Date(`${date}T12:00:00`).getTime() - Date.now()) / 86_400_000);
}

export function dealVelocityScore(deal: DealSummary) {
  const updatedDays = Math.max(0, (Date.now() - new Date(deal.updatedAt).getTime()) / 86_400_000);
  const freshness = Math.max(0, 100 - updatedDays * 4);
  const decisionReadiness = deal.hasUnderwriting ? 100 : deal.docCount ? 55 : 20;
  return Math.round(freshness * 0.45 + decisionReadiness * 0.55);
}
