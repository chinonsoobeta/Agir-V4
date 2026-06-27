// Deterministic synthetic Harbour Centre demo documents, derived ONLY from the
// verified golden fixture (harbour-fixture.ts). These stand in for the real
// source files (which are not distributed) so the demo's extraction pipeline
// has real documents to read. Every value here traces to the fixture: no other
// Harbour numbers are introduced. Labels are written to match the canonical
// alias taxonomy so the deterministic mapper resolves them without an LLM.
//
// Genuinely-absent values (expense ratio, hold period, selling costs) are NOT
// present in any document and must remain missing/defaultable downstream.

import {
  HARBOUR_BUDGET_LINES,
  HARBOUR_EXIT_CAP_CONFLICT,
  HARBOUR_REVENUE_COMPONENTS,
  HARBOUR_SCALARS,
} from "./engine/harbour-fixture";

const usd = (n: number) =>
  `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n)}`;
const sf = (n: number) => `${new Intl.NumberFormat("en-US").format(n)} SF`;

const scalar = (key: string): number => {
  const row = HARBOUR_SCALARS.find((r) => r.key === key);
  if (!row || row.value_numeric == null) throw new Error(`Harbour fixture missing scalar ${key}`);
  return row.value_numeric;
};
const component = (unitType: string) => {
  const row = HARBOUR_REVENUE_COMPONENTS.find((r) => r.unit_type === unitType);
  if (!row) throw new Error(`Harbour fixture missing revenue component ${unitType}`);
  return row;
};
const brokerCap = HARBOUR_EXIT_CAP_CONFLICT.values[0].value; // 4.75: broker opinion
const lenderCap = HARBOUR_EXIT_CAP_CONFLICT.values[1].value; // 5.25: lender term sheet

const res = component("Residential");
const retail = component("Retail");
const office = component("Office");

export type DemoDoc =
  | {
      name: string;
      storage_file: string;
      category: string;
      file_type: string;
      kind: "pdf";
      title: string;
      lines: string[];
    }
  | {
      name: string;
      storage_file: string;
      category: string;
      file_type: string;
      kind: "xlsx";
      sheet: string;
      rows: string[][];
    };

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const HARBOUR_DEMO_DOCS: DemoDoc[] = [
  {
    name: "Harbour_Centre_Sponsor_Summary.pdf",
    storage_file: "Sponsor_Summary.pdf",
    category: "Sponsor",
    file_type: "application/pdf",
    kind: "pdf",
    title: "Harbour Centre: Sponsor Summary",
    lines: [
      `Common equity contribution: ${usd(scalar("equity_amount"))}`,
      `Residential rental units: ${res.unit_count} units`,
      `Retail area: ${sf(retail.avg_sf ?? 0)}`,
      `Office area: ${sf(office.avg_sf ?? 0)}`,
    ],
  },
  {
    name: "Harbour_Centre_Market_Study.pdf",
    storage_file: "Market_Study.pdf",
    category: "Market Study",
    file_type: "application/pdf",
    kind: "pdf",
    title: "Harbour Centre: Market Study",
    lines: [
      `Residential rent: ${usd(res.rent)} per unit per month`,
      `Residential occupancy: ${res.occupancy_pct}%`,
      `Retail rent: ${usd(retail.rent)} per square foot`,
      `Retail occupancy: ${retail.occupancy_pct}%`,
      `Office rent: ${usd(office.rent)} per square foot`,
      `Office occupancy: ${office.occupancy_pct}%`,
      `Annual rent growth: ${scalar("rent_growth_pct")}%`,
    ],
  },
  {
    name: "Harbour_Centre_Broker_Opinion.pdf",
    storage_file: "Broker_Opinion.pdf",
    category: "Appraisal",
    file_type: "application/pdf",
    kind: "pdf",
    title: "Harbour Centre: Broker Opinion of Value",
    lines: [`Exit cap rate: ${brokerCap}%`],
  },
  {
    name: "Harbour_Centre_Lender_Term_Sheet.pdf",
    storage_file: "Lender_Term_Sheet.pdf",
    category: "Loan Package",
    file_type: "application/pdf",
    kind: "pdf",
    title: "Harbour Centre: Lender Term Sheet",
    lines: [
      `Senior loan amount: ${usd(scalar("loan_amount"))}`,
      `Interest rate: ${scalar("interest_rate_pct")}%`,
      `Amortization: ${scalar("amort_years")}-year`,
      `Minimum DSCR covenant: ${scalar("min_dscr").toFixed(2)}x`,
      `Lender stabilization requirement: ${scalar("lender_stabilized_occupancy_pct")}%`,
      `Terminal cap rate: ${lenderCap}%`,
    ],
  },
  {
    name: "Harbour_Centre_Construction_Budget.xlsx",
    storage_file: "Construction_Budget.xlsx",
    category: "Budget",
    file_type: XLSX_TYPE,
    kind: "xlsx",
    sheet: "Construction Budget",
    rows: [
      ["Line item", "Amount"],
      ...HARBOUR_BUDGET_LINES.map((b) => [b.label ?? "", usd(b.amount)]),
    ],
  },
  {
    name: "Harbour_Centre_Rent_Roll.xlsx",
    storage_file: "Rent_Roll.xlsx",
    category: "Financial Model",
    file_type: XLSX_TYPE,
    kind: "xlsx",
    sheet: "Rent Roll",
    rows: [
      ["Component", "Value"],
      ["Residential units", `${res.unit_count} units`],
      ["Residential rent", `${usd(res.rent)} per unit per month`],
      ["Residential occupancy", `${res.occupancy_pct}%`],
      ["Retail area", sf(retail.avg_sf ?? 0)],
      ["Retail rent", `${usd(retail.rent)} per square foot`],
      ["Retail occupancy", `${retail.occupancy_pct}%`],
      ["Office area", sf(office.avg_sf ?? 0)],
      ["Office rent", `${usd(office.rent)} per square foot`],
      ["Office occupancy", `${office.occupancy_pct}%`],
    ],
  },
];

// Plain-text rendering of a narrative (pdf) demo doc: the same text the PDF
// carries: for unit tests that exercise the candidate extractor directly.
export function demoDocPlainText(doc: DemoDoc): string {
  if (doc.kind === "pdf") return [doc.title, ...doc.lines].join("\n");
  // Mirror xlsxBufferToText's "Sheet <name> row <n>: ..." layout.
  const out = [`# Sheet: ${doc.sheet}`];
  doc.rows.forEach((row, i) => out.push(`Sheet ${doc.sheet} row ${i + 1}: ${row.join(" | ")}`));
  return out.join("\n");
}
