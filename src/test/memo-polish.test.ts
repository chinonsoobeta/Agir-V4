// Polish pass: source-label helper, default-accepted disclosure, exit-cap
// conflict footnote, committed-equity action, opex-ratio provenance, North
// American spelling, and PDF-safe symbols.

import { describe, expect, test } from "vitest";
import { buildMemoReport, memoReportText, displaySourceLabel } from "@/lib/memo-report";

const out = (
  scenario: string,
  metric_key: string,
  metric_label: string,
  value_numeric: number,
  unit: string,
) => ({ scenario_key: scenario, metric_key, metric_label, value_numeric, unit, formula_text: "" });

function ctx(overrides: Partial<Parameters<typeof buildMemoReport>[0]> = {}) {
  const base = {
    project: {
      name: "Harbour Centre",
      location: "Vancouver",
      type: "mixed_use",
      status: "underwriting",
    },
    assumptions: [
      {
        field_key: "land_cost",
        value_numeric: 34_500_000,
        field_label: "Land Cost",
        unit: "$",
        status: "approved",
        source_document_id: "doc-budget",
      },
      {
        field_key: "hard_costs",
        value_numeric: 162_000_000,
        field_label: "Hard / Construction Costs",
        unit: "$",
        status: "approved",
        source_document_id: "doc-budget",
      },
      {
        field_key: "soft_costs",
        value_numeric: 27_500_000,
        field_label: "Soft Costs",
        unit: "$",
        status: "approved",
        source_document_id: "doc-budget",
      },
      {
        field_key: "financing_costs",
        value_numeric: 18_000_000,
        field_label: "Financing Costs",
        unit: "$",
        status: "approved",
        source_document_id: "doc-budget",
      },
      {
        field_key: "contingency",
        value_numeric: 8_000_000,
        field_label: "Contingency",
        unit: "$",
        status: "approved",
        source_document_id: "doc-budget",
      },
      {
        field_key: "debt_amount",
        value_numeric: 162_500_000,
        field_label: "Debt Amount",
        unit: "$",
        status: "approved",
        source_document_id: "doc-lender",
      },
      {
        field_key: "equity_amount",
        value_numeric: 50_000_000,
        field_label: "Equity Amount",
        unit: "$",
        status: "approved",
        source_document_id: "doc-sponsor",
      },
      {
        field_key: "residential_units",
        value_numeric: 220,
        field_label: "Residential Units",
        unit: "units",
        status: "approved",
        source_document_id: "doc-sponsor",
      },
      {
        field_key: "residential_rent_monthly",
        value_numeric: 3050,
        field_label: "Residential Rent",
        unit: "$",
        status: "approved",
        source_document_id: "doc-market",
      },
      {
        field_key: "residential_occupancy",
        value_numeric: 96,
        field_label: "Residential Occupancy",
        unit: "%",
        status: "approved",
        source_document_id: "doc-market",
      },
      {
        field_key: "total_project_cost",
        value_numeric: 250_000_000,
        field_label: "Total Project Cost",
        unit: "$",
        status: "calculated",
        source_document_id: null,
      },
    ],
    engineInputs: [
      { key: "loan_amount", value_numeric: 162_500_000, status: "approved" },
      { key: "equity_amount", value_numeric: 50_000_000, status: "approved" },
      { key: "min_dscr", value_numeric: 1.2, status: "approved" },
      { key: "lender_stabilized_occupancy_pct", value_numeric: 93, status: "approved" },
      { key: "expense_ratio_pct", value_numeric: 35, status: "default_accepted" },
      { key: "hold_years", value_numeric: 5, status: "default_accepted" },
      { key: "selling_costs_pct", value_numeric: 2, status: "default_accepted" },
      {
        key: "exit_cap_rate_pct",
        value_numeric: 5.25,
        status: "approved",
        conflict_values: [
          { value: 4.75, source: "Harbour_Centre_Broker_Opinion.pdf" },
          { value: 5.25, source: "Harbour_Centre_Lender_Term_Sheet.pdf" },
          { value: 5, source: "Harbour_Centre_Underwriting_Assumptions_Addendum.docx" },
        ],
      },
    ],
    outputs: [
      out("base", "total_project_cost", "Total Project Cost", 250_000_000, "$"),
      out("base", "equity_requirement", "Equity Requirement", 87_500_000, "$"),
      out("base", "stabilized_noi", "Stabilized NOI", 6_113_016, "$"),
      out("base", "gpr", "GPR", 9_960_000, "$"),
      out("base", "projected_revenue", "EGI", 9_404_640, "$"),
      out("base", "dscr", "DSCR", 0.51, "x"),
      out("base", "yield_on_cost", "Yield on Cost", 2.45, "%"),
      out("base", "exit_value", "Exit Value", 116_438_400, "$"),
      out("base", "loan_to_cost", "Loan-to-Cost", 65, "%"),
      out("base", "annual_debt_service", "Annual Debt Service", 12_006_485, "$"),
      out("base", "projected_profit", "Development Profit", -133_561_600, "$"),
      out("base", "equity_multiple", "Equity Multiple", 0, "x"),
    ],
    flags: [
      {
        check_key: "sources_vs_uses",
        severity: "error",
        message: "Funding gap.",
        expected: 250_000_000,
        actual: 212_500_000,
        resolved: false,
      },
      {
        check_key: "equity_mismatch",
        severity: "warning",
        message: "Analyst equity differs from TDC minus loan amount.",
        resolved: false,
      },
      {
        check_key: "occupancy_vs_lender:Office",
        severity: "warning",
        message: "Office stabilized occupancy 85.0% is below 93.0%.",
        resolved: false,
      },
    ],
    risks: [],
    documents: [
      { id: "doc-budget", name: "Harbour_Centre_Construction_Budget.xlsx", category: "Budget" },
      { id: "doc-lender", name: "Harbour_Centre_Lender_Term_Sheet.pdf", category: "Loan Package" },
      { id: "doc-sponsor", name: "Harbour_Centre_Sponsor_Summary.pdf", category: "Sponsor" },
      { id: "doc-market", name: "Harbour_Centre_Market_Study.pdf", category: "Market Study" },
    ],
    verdict: {
      code: "REJECT",
      hardFail: true,
      gates: [
        { key: "equity_multiple", label: "Equity Multiple >= 1.50x", pass: false, actual: 0 },
      ],
    },
    generationMode: "deterministic" as const,
    generatedLabel: "June 2026",
  };
  return buildMemoReport({ ...base, ...overrides } as any);
}

describe("displaySourceLabel", () => {
  test("maps known Harbour filenames to clean labels", () => {
    expect(displaySourceLabel(null, "Harbour_Centre_Construction_Budget.xlsx")).toBe(
      "Construction Budget",
    );
    expect(displaySourceLabel(null, "Harbour_Centre_Lender_Term_Sheet.pdf")).toBe(
      "Lender Term Sheet",
    );
    expect(displaySourceLabel(null, "Harbour_Centre_Rent_Roll.xlsx")).toBe("Rent Roll");
    expect(displaySourceLabel("Harbour_Centre_Broker_Opinion.pdf")).toBe("Broker Opinion");
    expect(displaySourceLabel(null, "Harbour_Centre_Underwriting_Assumptions_Addendum.docx")).toBe(
      "Underwriting Addendum",
    );
  });
  test("cleans and title-cases unknown filenames, dropping duplicate project prefix", () => {
    expect(displaySourceLabel(null, "Harbour_Centre_Appraisal_Update.pdf")).toBe(
      "Appraisal Update",
    );
    expect(displaySourceLabel(null, "some-random_file.xlsx")).toBe("Some Random File");
  });
});

describe("memo polish", () => {
  test("source transparency and Document Sources keep full provenance", () => {
    const r = ctx();
    const prov = r.sections.find((s) => s.heading === "Assumption Source Transparency")!;
    expect(
      prov.table!.rows.some((row) => row.includes("Harbour_Centre_Construction_Budget.xlsx")),
    ).toBe(true);
    const docs = r.sections.find((s) => s.heading === "Document Sources")!;
    expect(
      docs.table!.rows.some((row) => row.includes("Harbour_Centre_Construction_Budget.xlsx")),
    ).toBe(true);
  });

  test("operating expense ratio row shows ratio and default-accepted source", () => {
    const rev = ctx().sections.find((s) => s.heading === "Operating Model Summary")!;
    const row = rev.table!.rows.find((r) => r[0] === "Operating expense ratio")!;
    expect(row).toBeDefined();
    expect(row.join(" ")).toContain("35.00%");
    expect(row.join(" ")).toContain("Default accepted");
    expect(rev.table!.note).toContain("Operating expenses = EGI x expense ratio.");
  });

  test("exit-cap conflict footnote appears with broker vs lender values", () => {
    const f = ctx().footnotes.join("\n");
    expect(f).toContain("approved conservative resolution");
    expect(f).toContain("4.75% broker opinion");
    expect(f).toContain("5.25% lender term sheet");
    expect(f).toContain(" vs ");
  });

  test("no exit-cap footnote when there is no conflict history", () => {
    const r = ctx({
      engineInputs: [
        { key: "exit_cap_rate_pct", value_numeric: 5.25, status: "approved" },
        { key: "expense_ratio_pct", value_numeric: 35, status: "default_accepted" },
      ],
    } as any);
    expect(r.footnotes.join("\n")).not.toContain("conservative resolution");
  });

  test("Approval Conditions includes the committed-equity/JV action exactly once", () => {
    const actions = ctx().sections.find((s) => s.heading === "Approval Conditions")!.body!;
    const matches = actions.split("\n").filter((l) => /committed equity is capped/.test(l));
    expect(matches.length).toBe(1);
    expect(matches[0]).toContain("$50,000,000");
  });

  test("default-accepted disclosure lists the defaulted fields and counts", () => {
    const f = ctx().footnotes.join("\n");
    expect(f).toContain("3 default-accepted");
    expect(f).toContain("Operating Expense Ratio");
    expect(f).toContain("Hold Period");
    expect(f).not.toContain("Default-accepted inputs: none");
  });

  test("North American spelling and PDF-safe symbols throughout", () => {
    const t = memoReportText(ctx());
    expect(t).not.toMatch(/stabilis(e|a)/i); // no British 'stabilised/stabilisation'
    for (const sym of ["≈", "→", "≥", "≤", "×", "−", "∞"]) {
      expect(t.includes(sym), `should not contain ${sym}`).toBe(false);
    }
  });

  test("still rejects", () => {
    expect(ctx().verdict_code).toBe("REJECT");
  });
});
