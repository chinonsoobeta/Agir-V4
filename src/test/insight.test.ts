import { describe, expect, test } from "vitest";
import {
  runUnderwriting,
  mapleHeightsInput,
  buildAllowedValues,
  verifyNumericProvenance,
  type UnderwritingInput,
} from "@/lib/engine";
import {
  buildInsight,
  writeNarrative,
  deriveDealContext,
  resolveBenchmark,
  interpretMetric,
} from "@/lib/context";
import { reconcileRecommendation } from "@/lib/decision";

// A partial-IO mixed-use deal (echoes the Confluence Yards sample).
function mixedUseInput(): UnderwritingInput {
  return {
    budget: {
      land: 26_000_000,
      hard: 175_000_000,
      soft: 24_000_000,
      contingency: 10_000_000,
      financingInterest: 15_000_000,
    },
    revenueProgram: [
      {
        unitType: "Residential",
        unitCount: 320,
        avgSf: 850,
        rent: 3_900,
        rentBasis: "per_unit",
        occupancyPct: 95,
      },
      {
        unitType: "Retail",
        unitCount: 1,
        avgSf: 45_000,
        rent: 48,
        rentBasis: "per_sf",
        occupancyPct: 93,
      },
      {
        unitType: "Office",
        unitCount: 1,
        avgSf: 80_000,
        rent: 55,
        rentBasis: "per_sf",
        occupancyPct: 90,
      },
      {
        unitType: "Last-Mile Flex",
        unitCount: 1,
        avgSf: 60_000,
        rent: 22,
        rentBasis: "per_sf",
        occupancyPct: 96,
      },
    ],
    constructionMonths: 26,
    leaseUpMonths: 18,
    stabilizedOccupancyPct: 93,
    expenseRatioPct: 31,
    otherIncomeAnnual: 1_200_000,
    exitCapRatePct: 5.0,
    loanAmount: 150_000_000,
    interestRatePct: 6.0,
    amortYears: 30,
    ioMonths: 30,
    avgOutstandingFactor: 0.6,
    sellingCostsPct: 1.5,
    holdYears: 7,
    equityAmount: 100_000_000,
    rentGrowthPct: 3.0,
    expenseGrowthPct: 2.5,
  };
}

describe("insight layer: deal context", () => {
  test("classifies asset class, loan structure and stage from data alone", () => {
    const mf = deriveDealContext(mapleHeightsInput(), {
      type: "multifamily",
      location: "Reference Market",
    });
    expect(mf.assetClass).toBe("multifamily");
    expect(mf.loanStructure).toBe("interest_only_full"); // io 12mo >= 12mo hold
    expect(mf.stage).toBe("ground_up");

    const mu = deriveDealContext(mixedUseInput(), {
      type: "mixed_use",
      location: "Gateway District",
    });
    expect(mu.assetClass).toBe("mixed_use");
    expect(mu.loanStructure).toBe("partial_io"); // io 30mo < 84mo hold
    expect(mu.marketTier).toBe("gateway");
    expect(mu.assetMix[0].assetClass).toBe("multifamily"); // largest GPR share
  });
});

describe("insight layer: benchmarks", () => {
  test("context-aware and carry provenance, with firm + portfolio layering", () => {
    const ctx = deriveDealContext(mapleHeightsInput(), {
      type: "multifamily",
      location: "secondary metro",
    });
    const dy = resolveBenchmark("debt_yield", ctx);
    expect(dy?.source).toBe("curated");
    expect(dy?.target).toBeCloseTo(9.0, 5); // base 9.5 + mf asset delta -0.5 + secondary tier 0

    const firm = resolveBenchmark("debt_yield", ctx, {
      firmConfig: { overrides: { multifamily: { debt_yield: { target: 10 } } } },
    });
    expect(firm?.target).toBe(10);
    expect(firm?.source).toBe("firm");

    const port = resolveBenchmark("debt_yield", ctx, {
      portfolioNorms: {
        sampleSize: 12,
        bands: { debt_yield: { p25: 8, p50: 10, p75: 12, n: 12 } },
      },
      portfolioMinSample: 8,
    });
    expect(port?.source).toBe("blended");
    expect(port?.target).toBeCloseTo((9.0 + 10) / 2, 5);
  });
});

describe("insight layer: interpretation", () => {
  test("bands, comparative phrasing, and provenance numbers", () => {
    const ctx = deriveDealContext(mapleHeightsInput(), {
      type: "multifamily",
      location: "secondary metro",
    });
    const i = interpretMetric("debt_yield", "Debt Yield", 7.8, "%", ctx);
    expect(["weak", "soft"]).toContain(i.band);
    expect(i.comparativePhrase).toMatch(/below the .* norm of/);
    expect(i.derived).toContain(i.benchmark!.target);
    expect(i.salience).toBeGreaterThan(0);
  });
});

describe("insight layer: synthesis", () => {
  test("thesis + bullets are produced, deterministic, and the narrative is provenance-clean", () => {
    const input = mixedUseInput();
    const out = runUnderwriting(input);
    const opts = {
      meta: { name: "Confluence Yards", type: "mixed_use", location: "Gateway District" },
      covenants: { minDebtYield: 9.0, minDscr: 1.2 },
      verdictCode: "APPROVE_WITH_CONDITIONS",
    };
    const b1 = buildInsight(out, input, opts);
    const b2 = buildInsight(out, input, opts);
    expect(b1.thesis).toBe(b2.thesis); // fully deterministic
    expect(b1.thesis.length).toBeGreaterThan(20);
    expect(b1.bullets.length).toBeGreaterThan(0);

    const text = [
      b1.thesis,
      writeNarrative(b1, "ic"),
      writeNarrative(b1, "lender"),
      writeNarrative(b1, "investor"),
      ...b1.bullets,
    ].join("  ");
    const allowed = buildAllowedValues(Object.values(out.values), b1.derivedValues, [
      input.loanAmount,
      input.exitCapRatePct,
      input.equityAmount ?? 0,
      input.interestRatePct,
    ]);
    const report = verifyNumericProvenance(text, allowed);
    expect(report.orphans, `orphans: ${JSON.stringify(report.orphans)}`).toEqual([]);
  });
});

describe("unified recommendation reconciler", () => {
  test("a hard fail is terminal (REJECT) regardless of the lenses", () => {
    expect(
      reconcileRecommendation({ verdictCode: "APPROVE", findingsRec: "APPROVE", hardFail: true })
        .code,
    ).toBe("REJECT");
  });
  test("takes the more conservative of the gate verdict and the findings lens", () => {
    // Gate set flags conditions, findings clear -> conditions (the Confluence case).
    expect(
      reconcileRecommendation({ verdictCode: "APPROVE_WITH_CONDITIONS", findingsRec: "APPROVE" })
        .code,
    ).toBe("APPROVE_WITH_CONDITIONS");
    // Findings send it back, gates clear -> return to underwriting.
    expect(
      reconcileRecommendation({ verdictCode: "APPROVE", findingsRec: "RETURN_TO_UNDERWRITING" })
        .code,
    ).toBe("RETURN_TO_UNDERWRITING");
  });
  test("a non-hard-fail gate REJECT is a returnable no", () => {
    expect(
      reconcileRecommendation({ verdictCode: "REJECT", findingsRec: "APPROVE", hardFail: false })
        .code,
    ).toBe("RETURN_TO_UNDERWRITING");
  });
  test("context can escalate a clean approve to conditions, never loosen", () => {
    expect(
      reconcileRecommendation({ verdictCode: "APPROVE", findingsRec: "APPROVE", weakContext: true })
        .code,
    ).toBe("APPROVE_WITH_CONDITIONS");
    expect(
      reconcileRecommendation({
        verdictCode: "APPROVE",
        findingsRec: "APPROVE",
        weakContext: false,
      }).code,
    ).toBe("APPROVE");
  });
});
