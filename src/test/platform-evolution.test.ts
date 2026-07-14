import { describe, it, expect } from "vitest";
import { translate, translateWith, makeFormatters, localeFor } from "@/lib/i18n";
import { computeOnboardingProgress } from "@/lib/preferences.functions";
import { summarizePortfolio } from "@/lib/platform-insights";
import {
  buildPipelineConversion,
  buildConcentration,
  buildUpcomingDeadlines,
  buildRiskConfidence,
  buildDecisionHistory,
  buildSourcing,
  daysBetween,
} from "@/lib/reports/portfolio-analytics";
import { reportToCsv } from "@/lib/reports/analytics-export";
import {
  COMPARISON_METRICS,
  bestDealForMetric,
  type ComparisonDeal,
} from "@/lib/reports/comparison-model";
import { sortDeals } from "@/lib/deal-views";
import { expandTemplate, milestoneTemplate } from "@/lib/milestone-templates";
import { mapTimeline } from "@/lib/timeline";
import { getSchemaCompatMode, isMissingColumn, isMissingRelation } from "@/lib/db-compat";
import { portfolioOutputsAreCurrent, type DealSummary } from "@/lib/portfolio.functions";

// ---- Fixtures ----
function deal(p: Partial<DealSummary> = {}): DealSummary {
  return {
    id: p.id ?? "id",
    name: p.name ?? "Deal",
    location: p.location ?? null,
    type: p.type ?? "multifamily",
    status: p.status ?? "pipeline",
    stage: p.stage ?? "Underwriting",
    capital: p.capital ?? 0,
    recommendation: p.recommendation ?? "APPROVE",
    recommendationLabel: p.recommendationLabel ?? "Approve",
    investmentScore: p.investmentScore ?? null,
    confidenceScore: p.confidenceScore ?? 0,
    riskRating: p.riskRating ?? "Moderate",
    hasUnderwriting: p.hasUnderwriting ?? false,
    topRisk: p.topRisk ?? null,
    nextAction: p.nextAction ?? null,
    decisionCount: p.decisionCount ?? 0,
    docCount: p.docCount ?? 0,
    startDate: p.startDate ?? null,
    targetCloseDate: p.targetCloseDate ?? null,
    updatedAt: p.updatedAt ?? "2026-06-01T00:00:00Z",
    source: p.source ?? null,
    probability: p.probability ?? 25,
    irr: p.irr ?? null,
    dscr: p.dscr ?? null,
  };
}

describe("portfolio decision freshness", () => {
  it("allows decision outputs only for the current deterministic input basis", () => {
    expect(portfolioOutputsAreCurrent("current")).toBe(true);
    expect(portfolioOutputsAreCurrent("stale")).toBe(false);
    expect(portfolioOutputsAreCurrent("blocked")).toBe(false);
    expect(portfolioOutputsAreCurrent("pending")).toBe(false);
  });
});

describe("i18n", () => {
  it("falls back to English for a missing French key", () => {
    // nav.home exists in fr; invent a key only in en by using a real en-only-ish key.
    expect(translate("fr", "nav.home")).toBe("Tableau de bord");
    expect(translate("en", "nav.home")).toBe("Dashboard");
  });
  it("returns the key itself if entirely unknown", () => {
    expect(translate("en", "totally.unknown" as any)).toBe("totally.unknown");
  });
  it("interpolates placeholders", () => {
    expect(translateWith("en", "onb.progress", { done: 2, total: 6 })).toBe("2 of 6 done");
    expect(translateWith("fr", "onb.progress", { done: 1, total: 6 })).toBe("1 sur 6 terminés");
  });
  it("formats currency/percent/multiple per locale", () => {
    const en = makeFormatters("en");
    expect(en.percent(6)).toContain("6.0");
    expect(en.multiple(1.75)).toBe("1.75x");
    expect(en.currency(250_000_000)).toContain("250,000,000");
    expect(localeFor("fr")).toBe("fr-CA");
    expect(localeFor("en")).toBe("en-CA");
  });
  it("guards non-finite numbers", () => {
    const f = makeFormatters("en");
    expect(f.currency(NaN)).toBeTruthy();
    expect(f.number(Infinity as any)).toBeTruthy();
  });
});

describe("onboarding progress", () => {
  it("derives completion from data counts", () => {
    const p = computeOnboardingProgress({ createDeal: 1, uploadDocs: 0, runUnderwriting: 2 });
    expect(p.total).toBe(6);
    expect(p.doneCount).toBe(2);
    expect(p.allDone).toBe(false);
    expect(p.nextStep).toBe("uploadDocs");
  });
  it("is all-done only when every step has data", () => {
    const p = computeOnboardingProgress({
      createDeal: 1,
      uploadDocs: 1,
      reviewAssumptions: 1,
      runUnderwriting: 1,
      prepareCommittee: 1,
      addMilestones: 1,
    });
    expect(p.allDone).toBe(true);
    expect(p.nextStep).toBeNull();
  });
});

describe("portfolio summary", () => {
  const deals = [
    deal({
      id: "a",
      capital: 100,
      probability: 50,
      investmentScore: 80,
      confidenceScore: 70,
      riskRating: "Low",
      stage: "Underwriting",
    }),
    deal({
      id: "b",
      capital: 200,
      probability: 25,
      investmentScore: 40,
      confidenceScore: 50,
      riskRating: "High",
      stage: "Investment Committee",
    }),
    deal({
      id: "c",
      capital: 60,
      probability: 100,
      investmentScore: null,
      confidenceScore: 0,
      riskRating: "Critical",
      stage: "Approved",
    }),
  ];
  it("computes gross + probability-weighted capital", () => {
    const s = summarizePortfolio(deals);
    expect(s.grossCapital).toBe(360);
    // 100*.5 + 200*.25 + 60*1 = 50 + 50 + 60 = 160
    expect(s.weightedCapital).toBe(160);
  });
  it("averages only scored deals for investment score", () => {
    const s = summarizePortfolio(deals);
    expect(s.avgInvestmentScore).toBe(60); // (80+40)/2
    expect(s.avgRiskScore).toBe(40); // (20+60)/2
  });
  it("counts elevated risk and stages", () => {
    const s = summarizePortfolio(deals);
    expect(s.elevatedRiskCount).toBe(2); // High + Critical
    expect(s.riskCounts.Critical).toBe(1);
    const uw = s.stages.find((x) => x.stage === "Underwriting");
    expect(uw?.count).toBe(1);
    expect(uw?.weighted).toBe(50);
  });
  it("is safe on an empty portfolio", () => {
    const s = summarizePortfolio([]);
    expect(s.grossCapital).toBe(0);
    expect(s.avgInvestmentScore).toBeNull();
  });
});

describe("portfolio analytics reports", () => {
  const now = new Date("2026-06-23T12:00:00Z");
  const deals = [
    deal({
      id: "a",
      name: "Alpha",
      capital: 300,
      probability: 50,
      stage: "Investment Committee",
      hasUnderwriting: true,
      investmentScore: 70,
      confidenceScore: 80,
      riskRating: "Low",
      source: "Broker",
      targetCloseDate: "2026-06-20",
    }),
    deal({
      id: "b",
      name: "Beta",
      capital: 100,
      probability: 25,
      stage: "Approved",
      hasUnderwriting: true,
      investmentScore: 50,
      confidenceScore: 55,
      riskRating: "High",
      source: "Broker",
      targetCloseDate: "2026-07-30",
    }),
    deal({
      id: "c",
      name: "Gamma",
      capital: 100,
      probability: 25,
      stage: "Rejected",
      hasUnderwriting: false,
      source: "Direct",
    }),
  ];

  it("daysBetween is deterministic given now", () => {
    expect(daysBetween("2026-06-20", now)).toBe(-3);
    expect(daysBetween(null, now)).toBeNull();
  });
  it("pipeline conversion totals + win rate", () => {
    const r = buildPipelineConversion(deals);
    const gross = r.summary.find((s) => s.label === "Gross pipeline")?.value;
    expect(gross).toBe(500);
    const win = r.summary.find((s) => s.label.startsWith("Win rate"))?.value as number;
    expect(win).toBe(50); // 1 approved of 2 decided
  });
  it("concentration shares sum sensibly and largest first", () => {
    const r = buildConcentration(deals);
    expect(r.rows[0].cells.name).toBe("Alpha");
    expect(r.rows[0].cells.share).toBeCloseTo(60, 5); // 300/500
  });
  it("upcoming deadlines flags overdue vs due-soon", () => {
    const r = buildUpcomingDeadlines(deals, now);
    const alpha = r.rows.find((x) => x.cells.name === "Alpha");
    expect(alpha?.cells.flag).toBe("Overdue");
    expect(r.rows.every((x) => x.dealId)).toBe(true); // drill-down ids present
  });
  it("risk & confidence only includes underwritten deals, low-confidence first", () => {
    const r = buildRiskConfidence(deals);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].cells.name).toBe("Beta"); // lower confidence sorts first
  });
  it("sourcing groups by channel", () => {
    const r = buildSourcing(deals);
    const broker = r.rows.find((x) => x.cells.source === "Broker");
    expect(broker?.cells.deals).toBe(2);
  });
  it("decision history maps + counts approvals", () => {
    const r = buildDecisionHistory([
      {
        project_id: "a",
        deal_name: "Alpha",
        decision: "approve",
        rationale: "ok",
        conditions: null,
        user_name: "IC",
        created_at: "2026-06-10",
      },
      {
        project_id: "b",
        deal_name: "Beta",
        decision: "reject",
        rationale: null,
        conditions: null,
        user_name: "IC",
        created_at: "2026-06-11",
      },
    ]);
    expect(r.rows).toHaveLength(2);
    expect(r.summary.find((s) => s.label === "Approvals")?.value).toBe(1);
  });
});

describe("CSV export", () => {
  it("emits raw numbers and a data-as-of preface", () => {
    const r = buildConcentration([deal({ id: "a", name: "Alpha", capital: 300, type: "office" })]);
    const csv = reportToCsv(r, "Concentration", "Jun 23, 2026");
    expect(csv).toContain("Concentration");
    // Value contains a comma, so it must be CSV-quoted.
    expect(csv).toContain('Data as of,"Jun 23, 2026"');
    expect(csv).toContain("300"); // raw numeric capital, not "$300"
    expect(csv).not.toContain("$300");
  });
});

describe("deal comparison", () => {
  function cmp(p: Partial<ComparisonDeal>): ComparisonDeal {
    return {
      id: "x",
      name: "X",
      type: "office",
      location: null,
      hasUnderwriting: true,
      recommendation: "APPROVE",
      recommendationLabel: "Approve",
      riskRating: "Low",
      investmentScore: null,
      confidenceScore: 0,
      capital: 0,
      irr: null,
      equityMultiple: null,
      dscr: null,
      yieldOnCost: null,
      exitCap: null,
      worstStressDscr: null,
      worstStressEm: null,
      keyFindings: [],
      dataGaps: 0,
      targetClose: null,
      ...p,
    };
  }
  const a = cmp({ id: "a", irr: 12, exitCap: 5, dataGaps: 1 });
  const b = cmp({ id: "b", irr: 18, exitCap: 6, dataGaps: 3 });
  it("picks the higher value for 'high' metrics", () => {
    const m = COMPARISON_METRICS.find((x) => x.key === "irr")!;
    expect(bestDealForMetric([a, b], m)).toBe("b");
  });
  it("picks the lower value for 'low' metrics", () => {
    const exitCap = COMPARISON_METRICS.find((x) => x.key === "exitCap")!;
    const gaps = COMPARISON_METRICS.find((x) => x.key === "dataGaps")!;
    expect(bestDealForMetric([a, b], exitCap)).toBe("a");
    expect(bestDealForMetric([a, b], gaps)).toBe("a");
  });
  it("returns null when not comparable or insufficient data", () => {
    const rec = COMPARISON_METRICS.find((x) => x.key === "recommendation")!;
    expect(bestDealForMetric([a, b], rec)).toBeNull();
    const irr = COMPARISON_METRICS.find((x) => x.key === "irr")!;
    expect(bestDealForMetric([a, cmp({ id: "z", irr: null })], irr)).toBeNull();
  });
});

describe("deal sorting", () => {
  const deals = [
    deal({
      id: "a",
      name: "Beta",
      investmentScore: 40,
      capital: 10,
      confidenceScore: 90,
      updatedAt: "2026-06-01T00:00:00Z",
      targetCloseDate: "2026-09-01",
    }),
    deal({
      id: "b",
      name: "Alpha",
      investmentScore: 80,
      capital: 50,
      confidenceScore: 60,
      updatedAt: "2026-06-10T00:00:00Z",
      targetCloseDate: "2026-07-01",
    }),
  ];
  it("sorts by investment score desc", () => {
    expect(sortDeals(deals, "investment")[0].id).toBe("b");
  });
  it("sorts by capital desc, name asc, close asc, updated desc", () => {
    expect(sortDeals(deals, "capital")[0].id).toBe("b");
    expect(sortDeals(deals, "name")[0].name).toBe("Alpha");
    expect(sortDeals(deals, "close")[0].id).toBe("b"); // soonest close
    expect(sortDeals(deals, "updated")[0].id).toBe("b"); // most recent
  });
});

describe("milestone templates", () => {
  it("expands a template into dated milestones for a deal", () => {
    const now = new Date("2026-06-23T00:00:00Z");
    const items = expandTemplate("acquisition_diligence", "pid-1", now);
    expect(items.length).toBe(milestoneTemplate("acquisition_diligence")!.items.length);
    expect(items.every((m) => m.project_id === "pid-1")).toBe(true);
    expect(items.every((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.due_date))).toBe(true);
    // First item offset 3 days -> 2026-06-26
    expect(items[0].due_date).toBe("2026-06-26");
  });
  it("returns [] for an unknown template", () => {
    expect(expandTemplate("nope", "pid", new Date("2026-01-01T00:00:00Z"))).toEqual([]);
  });
});

describe("timeline mapping", () => {
  it("unions sources, labels them, sorts newest-first", () => {
    const events = mapTimeline({
      activities: [
        {
          activity_type: "project_created",
          description: "Created X",
          created_at: "2026-06-01T00:00:00Z",
        },
      ],
      audit: [
        {
          action: "run_full_underwriting",
          payload: { verdict: "APPROVE", risk_score: 5 },
          user_name: "A",
          created_at: "2026-06-03T00:00:00Z",
        },
      ],
      decisions: [
        {
          decision: "approve",
          rationale: "ok",
          conditions: null,
          user_name: "IC",
          created_at: "2026-06-04T00:00:00Z",
        },
      ],
      documents: [{ name: "OM.pdf", category: "Offering", upload_date: "2026-06-02T00:00:00Z" }],
      milestones: [
        { title: "Closed", status: "complete", completed_at: "2026-06-05T00:00:00Z" },
        { title: "Pending", status: "not_started", completed_at: null },
      ],
    });
    expect(events[0].category).toBe("milestone"); // newest (Jun 5)
    expect(events.map((e) => e.category)).toContain("underwriting");
    const uw = events.find((e) => e.category === "underwriting");
    expect(uw?.detail).toContain("APPROVE");
    // incomplete milestone excluded
    expect(events.some((e) => e.title.includes("Pending"))).toBe(false);
    // chronological desc
    const times = events.map((e) => e.at);
    expect([...times].sort().reverse()).toEqual(times);
  });
  it("does not dump integration JSON into the timeline detail", () => {
    const events = mapTimeline({
      activities: [
        {
          activity_type: "integration_connection",
          description: '{"provider":"x"}',
          created_at: "2026-06-01T00:00:00Z",
        },
      ],
    });
    expect(events[0].category).toBe("integration");
    expect(events[0].detail).toBeNull();
  });
});

describe("missing-relation detection", () => {
  it("detects precise PostgREST missing-table errors", () => {
    expect(isMissingRelation({ code: "PGRST205" })).toBe(true);
    expect(isMissingRelation({ message: "Could not find the table 'public.x'" })).toBe(true);
    expect(isMissingRelation({ message: 'relation "public.x" does not exist' })).toBe(true);
    expect(
      isMissingRelation({
        message: "Could not find the table 'public.x' in the schema cache",
      }),
    ).toBe(true);
  });
  it("ignores unrelated errors and null", () => {
    expect(isMissingRelation(null)).toBe(false);
    expect(isMissingRelation({ message: "permission denied" })).toBe(false);
    expect(isMissingRelation({ message: "schema cache reload already in progress" })).toBe(false);
  });
  it("detects a missing column (older schema vs newer code)", () => {
    expect(isMissingColumn({ code: "PGRST204" })).toBe(true);
    expect(
      isMissingColumn({
        message: "Could not find the 'probability' column of 'projects' in the schema cache",
      }),
    ).toBe(true);
    expect(isMissingColumn({ message: "permission denied" })).toBe(false);
    expect(isMissingColumn(null)).toBe(false);
  });
  it("defaults compatibility mode by environment", () => {
    expect(getSchemaCompatMode({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe("strict");
    expect(getSchemaCompatMode({ AGIR_ENV: "staging" } as NodeJS.ProcessEnv)).toBe("strict");
    expect(getSchemaCompatMode({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBe("test");
    expect(getSchemaCompatMode({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe("demo");
    expect(
      getSchemaCompatMode({
        NODE_ENV: "production",
        AGIR_SCHEMA_COMPAT_MODE: "demo",
      } as NodeJS.ProcessEnv),
    ).toBe("strict");
  });
});
