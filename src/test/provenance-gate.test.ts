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
import { buildMemoReport, memoReportText, type MemoReport } from "@/lib/memo-report";
import { buildReport } from "@/lib/reports/report-builders";
import {
  REPORT_DEFINITIONS,
  type ReportFormat,
  type ReportType,
} from "@/lib/reports/report-definitions";
import {
  deriveCore,
  generationLabel,
  reportAllowedValues,
  reportVerdict,
} from "@/lib/reports/report-common";
import type { ReportData } from "@/lib/reports/report-data.server";

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
  const scenarios = [
    { key: "base", out: runUnderwriting(input) },
    { key: "cap_expansion", out: runUnderwriting(applyStress(input, STRESS_PRESETS[0])) },
    { key: "cost_overrun", out: runUnderwriting(applyStress(input, STRESS_PRESETS[1])) },
    { key: "rate_shock", out: runUnderwriting(applyStress(input, STRESS_PRESETS[2])) },
    { key: "revenue_down", out: runUnderwriting(applyStress(input, STRESS_PRESETS[3])) },
    { key: "combined", out: runUnderwriting(applyStress(input, STRESS_PRESETS[4])) },
  ];
  const outputs = scenarios.flatMap(({ key, out }) =>
    out.metrics.map((m) => ({
      scenario_key: key,
      metric_key: m.key,
      metric_label: m.label,
      value_numeric: m.value,
      unit: m.unit,
      formula_text: m.formula,
    })),
  );
  const base = scenarios[0].out;
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

  const assumption = (key: string, value: number, docId: string | null, status = "approved") => {
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
      source_document_id: docId,
      documents: docId ? { name: Object.values(DOC).find((d) => d.id === docId)?.name } : null,
    };
  };

  const assumptions = [
    assumption("land_cost", 34_500_000, "d1"),
    assumption("hard_costs", 162_000_000, "d1"),
    assumption("soft_costs", 27_500_000, "d1"),
    assumption("financing_costs", 18_000_000, "d1"),
    assumption("contingency", 8_000_000, "d1"),
    assumption("debt_amount", 162_500_000, "d2"),
    assumption("equity_amount", 50_000_000, "d3"),
    assumption("residential_units", 220, "d3"),
    assumption("residential_rent_monthly", 3050, "d4"),
    assumption("residential_occupancy", 96, "d4"),
    assumption("retail_sf", 18_000, "d3"),
    assumption("retail_rent_psf", 42, "d4"),
    assumption("retail_occupancy", 92, "d4"),
    assumption("office_sf", 32_000, "d3"),
    assumption("office_rent_psf", 36, "d4"),
    assumption("office_occupancy", 85, "d4"),
    assumption("interest_rate", 6.25, "d2"),
    assumption("amortization_years", 30, "d2"),
    assumption("min_dscr", 1.2, "d2"),
    assumption("lender_stabilized_occupancy", 93, "d2"),
    assumption("rent_growth", 3, "d4"),
    assumption("total_project_cost", 250_000_000, null, "calculated"),
  ];

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
    engineInputs: rows.scalars.map((s) => ({
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
    })),
    budget: [],
    revenue: input.revenueProgram.map((r) => ({
      unit_type: r.unitType,
      unit_count: r.unitCount,
      avg_sf: r.avgSf ?? null,
      market_rent_monthly: r.rent,
      rent_basis: r.rentBasis,
      occupancy_pct: r.occupancyPct ?? null,
      status: "approved",
    })),
    outputs,
    cashFlows,
    flags,
    risks,
    memos: [],
    decisions: [],
    auditLogs: [],
    scenarios: [],
  };
}

function memoArtifact(data: ReportData): MemoReport {
  return buildMemoReport({
    project: data.project!,
    assumptions: data.assumptions,
    engineInputs: data.engineInputs,
    outputs: data.outputs,
    flags: data.flags,
    risks: data.risks,
    documents: data.documents,
    verdict: reportVerdict(data),
    generationMode: "deterministic",
    generatedLabel: generationLabel("2026-06-01T00:00:00.000Z"),
  });
}

function verifyArtifact(data: ReportData, report: MemoReport) {
  const allowed = reportAllowedValues(data, deriveCore(data), report.derived_values ?? []);
  const provenance = verifyNumericProvenance(memoReportText(report), allowed);
  return {
    status: provenance.pass ? "generated" : "needs_review",
    needs_review: !provenance.pass,
    verification_report: provenance,
  };
}

const reportArtifacts = REPORT_DEFINITIONS.flatMap((def) =>
  def.supportedFormats.map((format) => ({
    label: `${def.type}:${format}`,
    reportType: def.type,
    format,
  })),
) satisfies Array<{ label: string; reportType: ReportType; format: ReportFormat }>;

const memoArtifacts = [
  { label: "memo:pdf", reportType: null, format: "pdf" },
  { label: "memo:docx", reportType: null, format: "docx" },
] satisfies Array<{ label: string; reportType: null; format: "pdf" | "docx" }>;

describe("provenance gate for generated artifacts", () => {
  const data = harbourReportData();

  test.each([...memoArtifacts, ...reportArtifacts])(
    "$label requires every numeric token to trace to an approved input, derived value, or engine output",
    ({ reportType }) => {
      const report = reportType
        ? buildReport(reportType, data, { generatedLabel: "June 2026" })
        : memoArtifact(data);
      const gate = verifyArtifact(data, report);

      expect(gate.status).toBe("generated");
      expect(gate.needs_review).toBe(false);
      expect(gate.verification_report.pass).toBe(true);
      expect(gate.verification_report.tokenCount).toBeGreaterThan(0);
      expect(gate.verification_report.orphans).toEqual([]);
    },
  );

  test("an orphaned number trips needs_review", () => {
    const report = buildReport("investor_report", data, { generatedLabel: "June 2026" });
    report.sections.push({ heading: "Injected", body: "Fabricated acquisition basis 123456789." });

    const gate = verifyArtifact(data, report);

    expect(gate.status).toBe("needs_review");
    expect(gate.needs_review).toBe(true);
    expect(gate.verification_report.pass).toBe(false);
    expect(gate.verification_report.orphans.some((orphan) => orphan.value === 123456789)).toBe(
      true,
    );
  });
});
