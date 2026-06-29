import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import { extractFileText } from "@/lib/document-text.server";
import { extractCandidates } from "@/lib/assumption-candidates.server";
import { groupAndResolve, mapCandidates, type MappedCandidate } from "@/lib/assumption-mapping";
import { ASSUMPTION_BY_KEY } from "@/lib/assumption-taxonomy";
import { parseBudgetWorkbook } from "@/lib/parsers/budget.server";
import { parseRentRollWorkbook } from "@/lib/parsers/rent-roll.server";
import { aggregateBudgetRows } from "@/lib/budget-assumption-mapper";
import { mapRevenueProgramRowToAssumptions } from "@/lib/revenue-assumption-mapper";
import { withinModelTolerance } from "@/lib/engine/tolerance-policy";
import {
  buildExtractionCorpusDashboard,
  renderExtractionCorpusDashboard,
} from "@/lib/extraction-corpus-dashboard";

type ExpectedAssumption = {
  key: string;
  value: number;
  fieldType: string;
};

type CorpusFixture = {
  name: string;
  fileType: string;
  buffer: ArrayBuffer;
  expected: ExpectedAssumption[];
  expectedAbsent?: string[];
  expectedConflicts?: string[];
};

type RealCorpusFixture = {
  name: string;
  fixturePath: string;
  fileType: string;
};

type FieldMetrics = {
  expected: number;
  predicted: number;
  truePositive: number;
  recall: number;
  precision: number;
};

const FIELD_TYPE_FLOORS: Record<string, { recall: number; precision: number }> = {
  currency: { recall: 1, precision: 1 },
  percent: { recall: 1, precision: 1 },
  duration: { recall: 1, precision: 1 },
  ratio: { recall: 1, precision: 1 },
  sf: { recall: 1, precision: 1 },
  units: { recall: 1, precision: 1 },
};

function fieldTypeFor(key: string) {
  const unit = ASSUMPTION_BY_KEY[key]?.unit;
  if (unit === "$" || unit === "$/SF") return "currency";
  if (unit === "%") return "percent";
  if (unit === "mo" || unit === "yr") return "duration";
  if (unit === "x") return "ratio";
  if (unit === "SF") return "sf";
  if (unit === "units") return "units";
  return "other";
}

function expected(key: string, value: number): ExpectedAssumption {
  return { key, value, fieldType: fieldTypeFor(key) };
}

function textBuffer(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function workbookBuffer(sheets: { name: string; rows: unknown[][]; merges?: XLSX.Range[] }[]) {
  const book = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
    if (sheet.merges) ws["!merges"] = sheet.merges;
    XLSX.utils.book_append_sheet(book, ws, sheet.name);
  }
  return XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

function pdfBuffer(lines: string[]) {
  const doc = new jsPDF();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(lines, 18, 18, { lineHeightFactor: 1.25 });
  return doc.output("arraybuffer") as ArrayBuffer;
}

const realFixture = (folder: "rivergate" | "summit-point", name: string): RealCorpusFixture => ({
  name,
  fixturePath: path.join(import.meta.dirname, "fixtures", folder, name),
  fileType: name.endsWith(".pdf")
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});

function makeRealAnonymizedCorpus(): RealCorpusFixture[] {
  return [
    realFixture("rivergate", "Rivergate_Appraisal_Valuation_Memo.pdf"),
    realFixture("rivergate", "Rivergate_Construction_Budget.xlsx"),
    realFixture("rivergate", "Rivergate_Lender_Term_Sheet.pdf"),
    realFixture("rivergate", "Rivergate_Market_Study.pdf"),
    realFixture("rivergate", "Rivergate_Rate_Lock_Addendum.pdf"),
    realFixture("rivergate", "Rivergate_Rent_Roll.xlsx"),
    realFixture("rivergate", "Rivergate_Sponsor_Investment_Summary.pdf"),
    realFixture("summit-point", "Summit_Point_Appraisal_Valuation_Memo.pdf"),
    realFixture("summit-point", "Summit_Point_Construction_Budget.xlsx"),
    realFixture("summit-point", "Summit_Point_Lender_Term_Sheet.pdf"),
  ];
}

async function readArrayBuffer(filePath: string): Promise<ArrayBuffer> {
  const bytes = await readFile(filePath);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function makeCorpus(): CorpusFixture[] {
  return [
    {
      name: "messy_sources_and_uses.csv",
      fileType: "text/csv",
      buffer: textBuffer(
        [
          "Section,Line Item,Amount,Notes",
          'Costs,Land acquisition,"($34,500,000)",accounting export uses negatives',
          'Costs,Hard costs,"($162,000,000)",GMP per draft schedule',
          'Costs,Soft costs,"($27,500,000)",includes permits and design',
          'Capital,Senior construction debt,"$162.5 million",term sheet source',
          'Capital,Sponsor equity,"$50.0 million",approved IC source',
        ].join("\n"),
      ),
      expected: [
        expected("land_cost", 34_500_000),
        expected("hard_costs", 162_000_000),
        expected("soft_costs", 27_500_000),
        expected("debt_amount", 162_500_000),
        expected("equity_amount", 50_000_000),
      ],
    },
    {
      name: "multi_sheet_scaled_budget_and_rent_roll.xlsx",
      fileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: workbookBuffer([
        {
          name: "Cover",
          rows: [
            ["Project", "Corpus Crossing"],
            ["Prepared from lender package", null],
          ],
        },
        {
          name: "Budget ($ in thousands)",
          rows: [
            ["Category", "Line Item", "Amount"],
            ["land", "Land acquisition", 34_500],
            ["hard", "Building shell", 162_000],
            [null, "Facade and envelope", 18_000],
            ["soft", "Soft costs", 27_500],
            ["contingency", "Construction contingency", 8_000],
          ],
          merges: [{ s: { r: 2, c: 0 }, e: { r: 3, c: 0 } }],
        },
        {
          name: "Rent Roll",
          rows: [
            ["Unit Type", "Units", "Avg SF", "Market Rent", "Rent Basis", "Occupancy"],
            ["Residential", 220, null, 3050, "per_unit", 96],
            ["Retail", 1, 18_000, 42, "per_sf", 92],
            ["Office", 1, 32_000, 36, "per_sf", 85],
          ],
        },
      ]),
      expected: [
        expected("land_cost", 34_500_000),
        expected("hard_costs", 180_000_000),
        expected("soft_costs", 27_500_000),
        expected("contingency", 8_000_000),
        expected("residential_units", 220),
        expected("residential_rent_monthly", 3050),
        expected("residential_occupancy", 96),
        expected("retail_sf", 18_000),
        expected("retail_rent_psf", 42),
        expected("retail_occupancy", 92),
        expected("office_sf", 32_000),
        expected("office_rent_psf", 36),
        expected("office_occupancy", 85),
      ],
    },
    {
      name: "ocr_style_lender_notes.txt",
      fileType: "text/plain",
      buffer: textBuffer(
        [
          "OCR EXPORT - page 12",
          "all-in interest rate: 6.25 %",
          "minimum dscr covenant: 1.20x",
          "lender stabilization requirement: 93 percent",
          "lease-up period ........ 12 months",
          "rent growth: 3 pct annually",
          "operating expense ratio 35%",
        ].join("\n"),
      ),
      expected: [
        expected("interest_rate", 6.25),
        expected("min_dscr", 1.2),
        expected("lender_stabilized_occupancy", 93),
        expected("lease_up_months", 12),
        expected("rent_growth", 3),
        expected("opex_ratio", 35),
      ],
    },
    {
      name: "broker_opinion_messy.pdf",
      fileType: "application/pdf",
      buffer: pdfBuffer([
        "Broker opinion extract - OCR corrected",
        "Exit cap rate 5.25%",
        "Hold period 5 years",
        "Disposition costs 1.50%",
        "Other income annual $450,000",
        "Total project cost $250.0 million",
      ]),
      expected: [
        expected("exit_cap_rate", 5.25),
        expected("hold_period_years", 5),
        expected("disposition_cost_pct", 1.5),
        expected("other_income_annual", 450_000),
        expected("total_project_cost", 250_000_000),
      ],
    },
    {
      name: "false_positive_guards.txt",
      fileType: "text/plain",
      buffer: textBuffer(
        [
          "Broker narrative",
          "The office lease term is 12 years and expires after stabilization.",
          "Tenant improvement allowance is $65 psf, not office rent.",
          "Exit cap rate range 5.0% - 5.5% for sensitivity only.",
        ].join("\n"),
      ),
      expected: [],
      expectedAbsent: ["lease_up_months", "office_rent_psf", "opex_ratio"],
    },
    {
      name: "adversarial_conflicting_terms.txt",
      fileType: "text/plain",
      buffer: textBuffer(
        [
          "Final IC memo",
          "Exit cap rate: 5.25%",
          "Broker sensitivity page",
          "Exit cap rate: 4.75%",
          "Office rent $42/SF; do not treat the tenant allowance of $65/SF as rent.",
          "Lease terms are 12 years, not a lease-up period.",
          "Senior construction debt amount: $162,500,000",
        ].join("\n"),
      ),
      expected: [expected("debt_amount", 162_500_000)],
      expectedAbsent: ["lease_up_months"],
      expectedConflicts: ["exit_cap_rate"],
    },
  ];
}

async function extractGroupedAssumptions(fixture: CorpusFixture) {
  const text = await extractFileText(fixture.name, fixture.fileType, fixture.buffer);
  const mapped: MappedCandidate[] = mapCandidates(extractCandidates(fixture.name, text));

  if (fixture.name.endsWith(".xlsx")) {
    mapped.push(
      ...aggregateBudgetRows(parseBudgetWorkbook(fixture.buffer).inserted, {
        name: fixture.name,
      }),
    );
    mapped.push(
      ...parseRentRollWorkbook(fixture.buffer).inserted.flatMap((row) =>
        mapRevenueProgramRowToAssumptions(row, { name: fixture.name }),
      ),
    );
  }

  return groupAndResolve(mapped);
}

async function extractMappedAssumptions(fixture: CorpusFixture) {
  const grouped = await extractGroupedAssumptions(fixture);
  return new Map(
    Array.from(grouped.values())
      .filter((row) => row.status === "extracted" && row.value_numeric != null)
      .map((row) => [row.field_key, Number(row.value_numeric)]),
  );
}

function valuesMatch(actual: number | undefined, expectedValue: number) {
  if (actual == null || !Number.isFinite(actual)) return false;
  return withinModelTolerance(actual, expectedValue);
}

function computeMetrics(
  runs: { expectedRows: ExpectedAssumption[]; predictions: Map<string, number> }[],
): Record<string, FieldMetrics> {
  const metrics: Record<string, FieldMetrics> = {};
  for (const { expectedRows, predictions } of runs) {
    const fieldTypes = new Set(expectedRows.map((row) => row.fieldType));
    for (const fieldType of fieldTypes) {
      const rows = expectedRows.filter((row) => row.fieldType === fieldType);
      const predictedForType = Array.from(predictions.keys()).filter(
        (key) => fieldTypeFor(key) === fieldType,
      );
      const truePositive = rows.filter((row) =>
        valuesMatch(predictions.get(row.key), row.value),
      ).length;
      const prev = metrics[fieldType] ?? {
        expected: 0,
        predicted: 0,
        truePositive: 0,
        recall: 1,
        precision: 1,
      };
      prev.expected += rows.length;
      prev.predicted += predictedForType.length;
      prev.truePositive += truePositive;
      metrics[fieldType] = prev;
    }
  }

  for (const metric of Object.values(metrics)) {
    metric.recall = metric.expected ? metric.truePositive / metric.expected : 1;
    metric.precision = metric.predicted ? metric.truePositive / metric.predicted : 1;
  }
  return metrics;
}

function summarize(metrics: Record<string, FieldMetrics>) {
  return Object.entries(metrics)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([fieldType, m]) =>
        `${fieldType}: recall=${m.recall.toFixed(3)} precision=${m.precision.toFixed(3)} tp=${m.truePositive}/${m.expected} predicted=${m.predicted}`,
    )
    .join("\n");
}

describe("labeled extraction corpus", () => {
  test("reports and ratchets precision/recall by field type", async () => {
    const corpus = makeCorpus();
    const runs: { expectedRows: ExpectedAssumption[]; predictions: Map<string, number> }[] = [];

    for (const fixture of corpus) {
      const grouped = await extractGroupedAssumptions(fixture);
      const extracted = new Map(
        Array.from(grouped.values())
          .filter((row) => row.status === "extracted" && row.value_numeric != null)
          .map((row) => [row.field_key, Number(row.value_numeric)]),
      );
      for (const absent of fixture.expectedAbsent ?? []) {
        expect(extracted.has(absent), `${fixture.name} should not extract ${absent}`).toBe(false);
      }
      for (const conflict of fixture.expectedConflicts ?? []) {
        expect(grouped.get(conflict)?.status, `${fixture.name} should conflict ${conflict}`).toBe(
          "conflicting",
        );
      }
      runs.push({ expectedRows: fixture.expected, predictions: extracted });
    }

    const metrics = computeMetrics(runs);
    const dashboard = buildExtractionCorpusDashboard(metrics, FIELD_TYPE_FLOORS);
    console.info(
      `\nExtraction corpus metrics\n${summarize(metrics)}\n${renderExtractionCorpusDashboard(dashboard)}`,
    );

    for (const [fieldType, floor] of Object.entries(FIELD_TYPE_FLOORS)) {
      const metric = metrics[fieldType];
      expect(metric, `${fieldType} metrics should be reported`).toBeDefined();
      expect(metric.recall, `${fieldType} recall`).toBeGreaterThanOrEqual(floor.recall);
      expect(metric.precision, `${fieldType} precision`).toBeGreaterThanOrEqual(floor.precision);
    }
    expect(dashboard.every((row) => row.status === "pass")).toBe(true);
  }, 30_000);

  test("runs a real anonymized document corpus through extraction", async () => {
    const corpus = makeRealAnonymizedCorpus();
    expect(corpus.length).toBeGreaterThanOrEqual(10);

    const allMapped: MappedCandidate[] = [];
    for (const fixture of corpus) {
      const buffer = await readArrayBuffer(fixture.fixturePath);
      const text = await extractFileText(fixture.name, fixture.fileType, buffer);
      const candidates = extractCandidates(fixture.name, text);
      expect(candidates.length, `${fixture.name} should produce candidates`).toBeGreaterThan(0);
      allMapped.push(...mapCandidates(candidates));

      if (fixture.name.endsWith(".xlsx")) {
        if (fixture.name.includes("Budget")) {
          allMapped.push(
            ...aggregateBudgetRows(parseBudgetWorkbook(buffer).inserted, {
              name: fixture.name,
            }),
          );
        }
        if (fixture.name.includes("Rent_Roll")) {
          allMapped.push(
            ...parseRentRollWorkbook(buffer).inserted.flatMap((row) =>
              mapRevenueProgramRowToAssumptions(row, { name: fixture.name }),
            ),
          );
        }
      }
    }

    const grouped = groupAndResolve(allMapped);
    for (const key of [
      "land_cost",
      "hard_costs",
      "soft_costs",
      "debt_amount",
      "interest_rate",
      "exit_cap_rate",
      "residential_units",
      "residential_rent_monthly",
    ]) {
      expect(grouped.has(key), `${key} should be covered by the real corpus`).toBe(true);
    }
  }, 30_000);
});
