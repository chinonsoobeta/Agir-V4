import { describe, expect, test } from "vitest";
import { applyStress, runUnderwriting, STRESS_PRESETS, type UnderwritingInput } from "@/lib/engine";
import { generateFindings } from "@/lib/findings";

function rivergateInput(): UnderwritingInput {
  return {
    budget: {
      land: 58_750_000,
      hard: 286_400_000,
      soft: 48_900_000,
      contingency: 21_600_000,
      financingInterest: 31_250_000,
      other: 14_500_000,
    },
    revenueProgram: [
      {
        unitType: "Residential",
        unitCount: 620,
        rent: 3_850,
        rentBasis: "per_unit",
        occupancyPct: 95,
      },
      {
        unitType: "Retail",
        unitCount: 1,
        avgSf: 36_000,
        rent: 68,
        rentBasis: "per_sf",
        occupancyPct: 92,
      },
      {
        unitType: "Office",
        unitCount: 1,
        avgSf: 120_000,
        rent: 55,
        rentBasis: "per_sf",
        occupancyPct: 90,
      },
    ],
    constructionMonths: 0,
    leaseUpMonths: 0,
    stabilizedOccupancyPct: 90,
    expenseRatioPct: 35,
    otherIncomeAnnual: 1_900_000,
    exitCapRatePct: 5.4,
    loanAmount: 276_800_000,
    interestRatePct: 6.85,
    amortYears: 25,
    ioMonths: 24,
    avgOutstandingFactor: 0,
    sellingCostsPct: 1.5,
    holdYears: 6,
    equityAmount: 184_600_000,
    rentGrowthPct: 3.25,
    expenseGrowthPct: 0,
  };
}

function rivergateAssumptions() {
  const a = (field_key: string, value_numeric: number, field_label = field_key) => ({
    field_key,
    field_label,
    value_numeric,
    status: "approved",
    confidence_score: 98,
  });
  return [
    a("residential_occupancy", 95, "Residential Occupancy"),
    a("retail_occupancy", 92, "Retail Occupancy"),
    a("office_occupancy", 90, "Office Occupancy"),
    a("min_dscr", 1.2, "Minimum DSCR Covenant"),
    a("debt_amount", 276_800_000, "Debt Amount"),
    a("equity_amount", 184_600_000, "Equity Amount"),
  ];
}

describe("Findings Engine", () => {
  test("Rivergate acceptance findings are deterministic", () => {
    const input = rivergateInput();
    const base = runUnderwriting(input);
    const scenarios = STRESS_PRESETS.map((preset) => ({
      key: preset.key,
      label: preset.label,
      output: runUnderwriting(applyStress(input, preset)),
    }));

    const report = generateFindings(base, rivergateAssumptions(), scenarios, { input });
    const all = [
      ...report.strengths,
      ...report.weaknesses,
      ...report.risks,
      ...report.opportunities,
      ...report.covenants,
      ...report.approvalConditions,
      ...report.rootCauseFindings,
      ...report.recommendationFindings,
    ];
    const ids = new Set(all.map((finding) => finding.id));

    expect(ids.has("debt.weak_dscr")).toBe(true);
    expect(ids.has("returns.thin_spread")).toBe(true);
    expect(ids.has("returns.low_equity_multiple")).toBe(true);
    expect(ids.has("debt.refinance_risk")).toBe(true);
    expect(ids.has("scenario.cap_rate_sensitivity")).toBe(true);
    expect(ids.has("scenario.revenue_sensitivity")).toBe(true);
    expect(ids.has("root_cause.noi_cost_leverage")).toBe(true);

    expect(report.rootCauseFindings[0].title).toBe(
      "Insufficient NOI Relative to Cost Basis and Leverage",
    );
    expect(report.recommendation).toBe("RETURN_TO_UNDERWRITING");
    expect(report.approvalConditions.map((finding) => finding.title)).toEqual(
      expect.arrayContaining([
        "Increase NOI",
        "Reduce Leverage",
        "Increase Development Spread",
        "Improve Stress Resilience",
      ]),
    );
    expect(report.downsideDrivers.length).toBeGreaterThan(0);
    expect(report.downsideDrivers[0].impact).toBeLessThan(0);
    expect(report.highPriorityFindings.length).toBeGreaterThan(0);
  });
});
