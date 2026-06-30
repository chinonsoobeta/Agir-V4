// Reports subsystem: definitions, readiness decisions, the four deterministic
// builders, numeric provenance, XLSX tabs, and PDF-safe symbols. Builds a
// Harbour-derived ReportData fixture from the deterministic engine.

import { describe, expect, test } from "vitest";
import {
  assembleEngineInput,
  applyStress,
  STRESS_PRESETS,
  runUnderwriting,
  conservativePick,
  DEFAULTS,
  runReconciliationChecks,
  deriveRiskRegister,
  verifyNumericProvenance,
  type ProjectInputRows,
} from "@/lib/engine";
import { harbourSeedRows } from "@/lib/engine/harbour-fixture";
import { ASSUMPTION_BY_KEY } from "@/lib/assumption-taxonomy";
import { memoReportText } from "@/lib/memo-report";
import { REPORT_DEFINITIONS, REPORT_BY_TYPE } from "@/lib/reports/report-definitions";
import { computeReportStatus, deriveCore, reportAllowedValues } from "@/lib/reports/report-common";
import { buildReport } from "@/lib/reports/report-builders";
import type { ReportData } from "@/lib/reports/report-data.server";
import { renderReportXlsxArrayBuffer } from "@/lib/reports/report-xlsx";

const DOC = {
  budget: { id: "d1", name: "Harbour_Centre_Construction_Budget.xlsx", category: "Budget" },
  lender: { id: "d2", name: "Harbour_Centre_Lender_Term_Sheet.pdf", category: "Loan Package" },
  sponsor: { id: "d3", name: "Harbour_Centre_Sponsor_Summary.pdf", category: "Sponsor" },
  market: { id: "d4", name: "Harbour_Centre_Market_Study.pdf", category: "Market Study" },
};

function harbourReportData(): ReportData {
  const rows: ProjectInputRows = harbourSeedRows();
  for (const key of ["expense_ratio_pct", "hold_years", "selling_costs_pct"]) {
    rows.scalars.push({
      key,
      value_numeric: DEFAULTS[key].value,
      status: "default_accepted",
      source: "default",
    });
  }
  const cap = rows.scalars.find(
    (r) => r.key === "exit_cap_rate_pct" && r.status === "conflicting",
  )!;
  cap.value_numeric = conservativePick(
    "exit_cap_rate_pct",
    cap.conflict_values!.map((c) => c.value),
  );
  cap.status = "approved";
  const input = assembleEngineInput(rows);

  const SCEN = [
    { key: "base", out: runUnderwriting(input) },
    { key: "cap_expansion", out: runUnderwriting(applyStress(input, STRESS_PRESETS[0])) },
    { key: "cost_overrun", out: runUnderwriting(applyStress(input, STRESS_PRESETS[1])) },
    { key: "rate_shock", out: runUnderwriting(applyStress(input, STRESS_PRESETS[2])) },
    { key: "revenue_down", out: runUnderwriting(applyStress(input, STRESS_PRESETS[3])) },
    { key: "combined", out: runUnderwriting(applyStress(input, STRESS_PRESETS[4])) },
  ];
  const outputs = SCEN.flatMap(({ key, out }) =>
    out.metrics.map((m) => ({
      scenario_key: key,
      metric_key: m.key,
      metric_label: m.label,
      value_numeric: m.value,
      unit: m.unit,
      formula_text: m.formula,
    })),
  );
  const base = SCEN[0].out;
  const cashFlows = base.cashFlows.map((c) => ({
    scenario_key: "base",
    period_year: c.periodYear,
    line_key: c.lineKey,
    amount: c.amount,
  }));
  const flags = runReconciliationChecks({
    tdc: base.values.tdc,
    equity: 50_000_000,
    loan: 162_500_000,
    noi: base.values.noi,
    amortizingAnnualDebtService: base.values.annualDebtService,
    minDscr: 1.2,
    lenderStabilizedOccupancyPct: 93,
    componentOccupancies: input.revenueProgram.map((r) => ({
      unitType: r.unitType,
      occupancyPct: r.occupancyPct ?? null,
    })),
    unitCounts: [220, 220],
  }).map((f) => ({ ...f, resolved: false }));
  const risks = deriveRiskRegister(base, flags);

  const a = (key: string, value: number, docId: string | null, status = "approved") => {
    const def = ASSUMPTION_BY_KEY[key];
    return {
      id: `a-${key}`,
      field_key: key,
      value_numeric: value,
      field_label: def.label,
      unit: def.unit,
      category: def.category,
      status,
      confidence_score: 100,
      confidence_band: "high",
      source_document_id: docId,
      documents: docId ? { name: Object.values(DOC).find((d) => d.id === docId)?.name } : null,
    };
  };
  const assumptions = [
    a("land_cost", 34_500_000, "d1"),
    a("hard_costs", 162_000_000, "d1"),
    a("soft_costs", 27_500_000, "d1"),
    a("financing_costs", 18_000_000, "d1"),
    a("contingency", 8_000_000, "d1"),
    a("debt_amount", 162_500_000, "d2"),
    a("equity_amount", 50_000_000, "d3"),
    a("residential_units", 220, "d3"),
    a("residential_rent_monthly", 3050, "d4"),
    a("residential_occupancy", 96, "d4"),
    a("retail_sf", 18_000, "d3"),
    a("retail_rent_psf", 42, "d4"),
    a("retail_occupancy", 92, "d4"),
    a("office_sf", 32_000, "d3"),
    a("office_rent_psf", 36, "d4"),
    a("office_occupancy", 85, "d4"),
    a("interest_rate", 6.25, "d2"),
    a("amortization_years", 30, "d2"),
    a("min_dscr", 1.2, "d2"),
    a("lender_stabilized_occupancy", 93, "d2"),
    a("rent_growth", 3, "d4"),
    a("total_project_cost", 250_000_000, null, "calculated"),
  ];
  const engineInputs = rows.scalars.map((s) => ({
    key: s.key,
    value_numeric: s.value_numeric,
    status: s.status,
    conflict_values:
      s.key === "exit_cap_rate_pct"
        ? [
            { value: 4.75, source: "Harbour_Centre_Broker_Opinion.pdf" },
            { value: 5.25, source: "Harbour_Centre_Lender_Term_Sheet.pdf" },
          ]
        : null,
  }));
  const revenue = input.revenueProgram.map((r) => ({
    unit_type: r.unitType,
    unit_count: r.unitCount,
    avg_sf: r.avgSf ?? null,
    market_rent_monthly: r.rent,
    rent_basis: r.rentBasis,
    occupancy_pct: r.occupancyPct ?? null,
    status: "approved",
  }));

  return {
    project: {
      id: "p1",
      name: "Harbour Centre",
      location: "Vancouver",
      type: "mixed_use",
      status: "underwriting",
    },
    documents: Object.values(DOC).map((d) => ({ ...d, status: "uploaded", upload_date: null })),
    assumptions,
    assumptionVersions: [],
    engineInputs,
    budget: [],
    revenue,
    outputs,
    cashFlows,
    flags,
    risks,
    memos: [],
    decisions: [],
    auditLogs: [],
    scenarios: [],
    unitContractIssues: [],
    // Deterministic fixture carries only the fields the report builders read;
    // assert to the full ReportData row shapes (test mock, not real DB rows).
  } as unknown as ReportData;
}

const allText = (r: any) => memoReportText(r);

describe("report definitions", () => {
  test("all four report types exist with correct formats", () => {
    expect(REPORT_DEFINITIONS.map((d) => d.type).sort()).toEqual([
      "executive_summary",
      "internal_team_report",
      "investor_report",
      "lender_package",
    ]);
    expect(REPORT_BY_TYPE.investor_report.supportedFormats).toEqual(["pdf", "docx", "xlsx"]);
    expect(REPORT_BY_TYPE.lender_package.supportedFormats).toEqual(["pdf", "docx", "xlsx"]);
    expect(REPORT_BY_TYPE.executive_summary.supportedFormats).toEqual(["pdf", "docx"]);
    expect(REPORT_BY_TYPE.internal_team_report.supportedFormats).toEqual(["pdf", "xlsx"]);
  });
});

describe("report readiness", () => {
  const inv = REPORT_BY_TYPE.investor_report;
  const internal = REPORT_BY_TYPE.internal_team_report;
  test("no project -> missing_project", () => {
    expect(
      computeReportStatus(inv, {
        projectExists: false,
        baseOutputs: 0,
        financialOutputs: 0,
        reconErrors: 0,
      }).status,
    ).toBe("missing_project");
  });
  test("project without outputs -> needs_underwriting", () => {
    const r = computeReportStatus(inv, {
      projectExists: true,
      baseOutputs: 0,
      financialOutputs: 0,
      reconErrors: 0,
    });
    expect(r.status).toBe("needs_underwriting");
    expect(r.ready).toBe(false);
  });
  test("outputs with errors -> ready (has_unresolved_errors) with warning", () => {
    const r = computeReportStatus(inv, {
      projectExists: true,
      baseOutputs: 22,
      financialOutputs: 120,
      reconErrors: 2,
    });
    expect(r.status).toBe("has_unresolved_errors");
    expect(r.ready).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/unresolved reconciliation/);
  });
  test("internal team report generates even without underwriting", () => {
    const r = computeReportStatus(internal, {
      projectExists: true,
      baseOutputs: 0,
      financialOutputs: 0,
      reconErrors: 0,
    });
    expect(r.ready).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/Underwriting has not run/);
  });
});

describe("report builders", () => {
  const data = harbourReportData();
  const opts = { generatedLabel: "June 2026" };

  test("investor report: key metrics, sensitivity analysis, risks, IRR N/M, footer", () => {
    const r = buildReport("investor_report", data, opts);
    expect(r.title).toBe("Investor Report");
    const t = allText(r);
    expect(r.sections.some((s) => s.heading === "Key Returns")).toBe(true);
    expect(r.sections.some((s) => s.heading === "Sensitivity Analysis")).toBe(true);
    expect(r.sections.some((s) => s.heading === "Risk Register")).toBe(true);
    expect(t).toContain("Not meaningful"); // IRR on equity wipeout
    expect(r.footnotes.join(" ")).toContain("No AI-generated financial values were used.");
  });

  test("lender package: covenant compliance, loan payoff, conditions, not-lender-ready", () => {
    const r = buildReport("lender_package", data, opts);
    expect(r.sections.some((s) => s.heading === "Covenant Compliance")).toBe(true);
    expect(r.sections.some((s) => s.heading === "Debt Service")).toBe(true);
    expect(r.sections.some((s) => s.heading === "Required Conditions")).toBe(true);
    expect(allText(r)).toMatch(/BREACH/);
    expect(r.verdict_banner).toContain("not lender-ready");
  });

  test("executive summary: recommendation, key metrics grid, top risks, required actions", () => {
    const r = buildReport("executive_summary", data, opts);
    expect(r.verdict_code).toBe("REJECT");
    expect(r.metric_cards.length).toBeGreaterThan(6);
    expect(r.sections.some((s) => s.heading === "Top Risks")).toBe(true);
    expect(r.sections.some((s) => s.heading === "Required Actions")).toBe(true);
  });

  test("internal team report: assumptions, defaults, audit, action items", () => {
    const r = buildReport("internal_team_report", data, opts);
    expect(r.sections.some((s) => s.heading === "Assumptions")).toBe(true);
    expect(r.sections.some((s) => s.heading === "Defaults")).toBe(true);
    expect(r.sections.some((s) => s.heading === "Audit Log")).toBe(true);
    expect(r.sections.some((s) => s.heading === "Action Items")).toBe(true);
  });

  test("internal team XLSX has the expected tabs", async () => {
    const r = buildReport("internal_team_report", data, opts);
    const ab = await renderReportXlsxArrayBuffer(r);
    const XLSX = await import("xlsx");
    const wb = XLSX.read(new Uint8Array(ab), { type: "array" });
    for (const tab of [
      "Summary",
      "Assumptions",
      "Defaults",
      "Reconciliation Flags",
      "Risks",
      "Financial Outputs",
      "Cash Flows",
      "Documents",
      "Audit Log",
      "Action Items",
    ]) {
      expect(wb.SheetNames).toContain(tab);
    }
  });
});

describe("numeric provenance + PDF-safe text", () => {
  const data = harbourReportData();
  const opts = { generatedLabel: "June 2026" };

  for (const type of [
    "investor_report",
    "lender_package",
    "executive_summary",
    "internal_team_report",
  ] as const) {
    test(`${type} passes provenance with the Harbour fixture`, () => {
      const r = buildReport(type, data, opts);
      const allowed = reportAllowedValues(data, deriveCore(data), r.derived_values ?? []);
      const report = verifyNumericProvenance(memoReportText(r), allowed);
      expect(report.orphans, JSON.stringify(report.orphans)).toEqual([]);
    });

    test(`${type} contains no PDF-breaking symbols`, () => {
      const t = memoReportText(buildReport(type, data, opts));
      for (const sym of ["≈", "→", "≥", "≤", "×", "−", "∞"]) expect(t.includes(sym)).toBe(false);
    });
  }

  test("an injected orphan number fails provenance (-> needs_review)", () => {
    const r = buildReport("investor_report", data, opts);
    r.sections.push({ heading: "Injected", body: "Fabricated figure 123456789." });
    const allowed = reportAllowedValues(data, deriveCore(data), r.derived_values ?? []);
    const report = verifyNumericProvenance(memoReportText(r), allowed);
    expect(report.pass).toBe(false);
    expect(report.orphans.some((o) => o.value === 123456789)).toBe(true);
  });
});
