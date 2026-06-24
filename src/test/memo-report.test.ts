// Memo report content rules: ASCII-only symbols (clean PDF), accurate footer
// language, input-conflicts vs reconciliation-exceptions wording, the IC action
// list, and document-name provenance.

import { describe, expect, test } from "vitest";
import { buildMemoReport, memoReportText } from "@/lib/memo-report";

function report() {
  const assumptions = [
    { field_key: "land_cost", value_numeric: 34_500_000, field_label: "Land Cost", unit: "$", status: "approved", source_document_id: "doc-budget" },
    { field_key: "hard_costs", value_numeric: 162_000_000, field_label: "Hard / Construction Costs", unit: "$", status: "approved", source_document_id: "doc-budget" },
    { field_key: "soft_costs", value_numeric: 27_500_000, field_label: "Soft Costs", unit: "$", status: "approved", source_document_id: "doc-budget" },
    { field_key: "financing_costs", value_numeric: 18_000_000, field_label: "Financing Costs", unit: "$", status: "approved", source_document_id: "doc-budget" },
    { field_key: "contingency", value_numeric: 8_000_000, field_label: "Contingency", unit: "$", status: "approved", source_document_id: "doc-budget" },
    { field_key: "debt_amount", value_numeric: 162_500_000, field_label: "Debt Amount", unit: "$", status: "approved", source_document_id: "doc-lender" },
    { field_key: "equity_amount", value_numeric: 50_000_000, field_label: "Equity Amount", unit: "$", status: "approved", source_document_id: "doc-sponsor" },
    { field_key: "min_dscr", value_numeric: 1.2, field_label: "Minimum DSCR Covenant", unit: "x", status: "approved", source_document_id: "doc-lender" },
  ];
  const m = (scenario: string, metric_key: string, metric_label: string, value_numeric: number, unit: string) =>
    ({ scenario_key: scenario, metric_key, metric_label, value_numeric, unit, formula_text: "" });
  const outputs = [
    m("base", "total_project_cost", "Total Project Cost", 250_000_000, "$"),
    m("base", "stabilized_noi", "Stabilised NOI", 6_395_155, "$"),
    m("base", "yield_on_cost", "Yield on Cost", 2.56, "%"),
    m("base", "development_spread", "Development Spread", -269, "bps"),
    m("base", "dscr", "DSCR", 0.53, "x"),
    m("base", "exit_value", "Exit Value", 121_812_480, "$"),
    m("base", "equity_requirement", "Equity Requirement", 87_500_000, "$"),
    m("base", "loan_to_cost", "Loan-to-Cost", 65, "%"),
    m("base", "annual_debt_service", "Annual Debt Service", 12_006_485, "$"),
    m("base", "equity_multiple", "Equity Multiple", 0, "x"),
  ];
  // Engine-sourced strings deliberately carry the banned Unicode symbols.
  const flags = [
    { check_key: "covenant_feasibility", severity: "error", message: "requires NOI 14,407,782 (1.20x × ADS): fails by 2.4×.", expected: 14_407_782, actual: 6_395_155, resolved: false },
    { check_key: "sources_vs_uses", severity: "error", message: "equity + debt → $37,500,000 short.", expected: 250_000_000, actual: 212_500_000, resolved: false },
    { check_key: "occupancy_vs_lender:Office", severity: "warning", message: "Office occupancy 85.0% is below 93.0%.", expected: 93, actual: 85, resolved: false },
  ];
  const risks = [{ title: "Equity Wipeout at Exit", severity: "critical", description: "Equity wiped out (EM ≈ 0.0x, IRR not meaningful)." }];
  const documents = [
    { id: "doc-budget", name: "Harbour_Centre_Construction_Budget.xlsx", category: "Budget" },
    { id: "doc-lender", name: "Harbour_Centre_Lender_Term_Sheet.pdf", category: "Loan Package" },
    { id: "doc-sponsor", name: "Harbour_Centre_Sponsor_Summary.pdf", category: "Sponsor" },
  ];
  return buildMemoReport({
    project: { name: "Harbour Centre", location: "Vancouver", type: "mixed_use", status: "underwriting" },
    assumptions, engineInputs: [{ key: "exit_cap_rate_pct", value_numeric: 5.25, status: "approved" }],
    outputs, flags, risks, documents,
    verdict: { code: "REJECT", hardFail: true, gates: [{ key: "equity_multiple", label: "Equity Multiple >= 1.50x", pass: false, actual: 0 }] },
    generationMode: "deterministic", generatedLabel: "June 2026",
  });
}

describe("Memo report content rules", () => {
  test("renders no PDF-breaking Unicode symbols", () => {
    const text = memoReportText(report());
    for (const sym of ["−", "×", "≈", "→", "≥", "≤", "∞"]) {
      expect(text.includes(sym), `should not contain ${sym}`).toBe(false);
    }
  });

  test("footer language is accurate", () => {
    const f = report().footnotes.join("\n");
    expect(f).toContain("No AI-generated financial values were used.");
    expect(f).not.toContain("No assumptions, defaults, or AI-generated values were used.");
  });

  test("distinguishes input conflicts from reconciliation exceptions with real counts", () => {
    const f = report().footnotes.join("\n");
    expect(f).toContain("Input conflicts: none outstanding.");
    expect(f).toContain("Reconciliation exceptions: 2 error(s) and 1 warning(s) remain open.");
  });

  test("includes approval conditions covering the open issues", () => {
    const r = report();
    const actions = r.sections.find((s) => s.heading === "Approval Conditions");
    expect(actions).toBeDefined();
    expect(actions!.body).toContain("funding gap");
    expect(actions!.body).toContain("DSCR");
    expect(actions!.body).toContain("lender stabilization shortfalls");
  });

  test("shows document provenance, not a generic label", () => {
    const text = memoReportText(report());
    expect(text).toContain("Harbour_Centre_Construction_Budget.xlsx");
    expect(text).toContain("Harbour_Centre_Lender_Term_Sheet.pdf");
  });

  test("still rejects Harbour Centre", () => {
    expect(report().verdict_code).toBe("REJECT");
    expect(report().verdict_banner).toContain("DOES NOT MEET INVESTMENT HURDLES");
  });
});
