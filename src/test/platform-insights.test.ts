import { describe, expect, it } from "vitest";
import { buildPortfolioInsights, dealVelocityScore } from "@/lib/platform-insights";
import type { DealSummary } from "@/lib/portfolio.functions";

function deal(patch: Partial<DealSummary> = {}): DealSummary {
  return {
    id: "deal-1",
    name: "Harbour Centre",
    location: "Vancouver",
    type: "industrial",
    status: "underwriting",
    stage: "Underwriting",
    capital: 10_000_000,
    recommendation: "APPROVE_WITH_CONDITIONS",
    recommendationLabel: "Approve with Conditions",
    investmentScore: 68,
    confidenceScore: 82,
    riskRating: "Moderate",
    hasUnderwriting: true,
    topRisk: null,
    nextAction: "Complete Underwriting",
    decisionCount: 0,
    docCount: 4,
    startDate: null,
    targetCloseDate: null,
    updatedAt: new Date().toISOString(),
    source: "Direct",
    probability: 60,
    irr: 16,
    dscr: 1.35,
    ...patch,
  };
}

describe("operating-platform insights", () => {
  it("surfaces capital concentration, confidence gaps, and elevated risk", () => {
    const insights = buildPortfolioInsights([
      deal({ id: "large", capital: 80_000_000, confidenceScore: 54, riskRating: "Critical" }),
      deal({ id: "small", name: "Small Deal", capital: 20_000_000 }),
    ]);

    expect(insights.map((insight) => insight.id)).toEqual(
      expect.arrayContaining(["concentration", "confidence", "risk"]),
    );
    expect(insights.find((insight) => insight.id === "concentration")?.severity).toBe("critical");
  });

  it("returns a healthy signal when no exception is present", () => {
    const insights = buildPortfolioInsights([
      deal({ id: "a", capital: 5_000_000 }),
      deal({ id: "b", name: "Second", capital: 5_000_000 }),
      deal({ id: "c", name: "Third", capital: 5_000_000 }),
    ]);

    expect(insights).toHaveLength(1);
    expect(insights[0].id).toBe("healthy");
  });

  it("rewards fresh, underwritten deal activity", () => {
    expect(dealVelocityScore(deal())).toBeGreaterThan(
      dealVelocityScore(
        deal({
          hasUnderwriting: false,
          docCount: 0,
          updatedAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
        }),
      ),
    );
  });
});
