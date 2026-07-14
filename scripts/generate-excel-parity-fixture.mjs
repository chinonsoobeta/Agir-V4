import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import xlsx from "xlsx";

const XLSX = xlsx;

const DEFAULT_WORKBOOK =
  "/Users/chinonsoobeta/outputs/agir_excel_parity_package/Agir_Representative_Excel_Validation_Package_v1.xlsx";
const DEFAULT_OUTPUT = "src/test/fixtures/excel-parity/representative-maple-heights-excel-v1.json";

const workbookPath = process.argv[2] ?? process.env.AGIR_EXCEL_PARITY_WORKBOOK ?? DEFAULT_WORKBOOK;
const outputPath = process.argv[3] ?? DEFAULT_OUTPUT;

function requiredSheet(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Workbook is missing ${sheetName}.`);
  return sheet;
}

function readRows(workbook, sheetName) {
  return XLSX.utils.sheet_to_json(requiredSheet(workbook, sheetName), {
    header: 1,
    blankrows: false,
    defval: null,
    raw: true,
  });
}

function tableObjects(rows, headerName) {
  const headerIndex = rows.findIndex((row) => row[0] === headerName);
  if (headerIndex < 0) throw new Error(`Could not find ${headerName} header.`);
  const headers = rows[headerIndex].map((cell) => String(cell ?? "").trim());
  return rows
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => cell != null))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null])));
}

const workbook = XLSX.read(readFileSync(workbookPath), {
  cellFormula: true,
  cellDates: false,
});
const fixtureRows = tableObjects(readRows(workbook, "Fixture_Table"), "project_deal_name");
const checks = tableObjects(readRows(workbook, "Checks"), "Check");

if (!fixtureRows.length) throw new Error("Fixture_Table has no fixture rows.");
const badChecks = checks.filter((row) => row.Status !== "OK");
if (badChecks.length) {
  throw new Error(`Workbook checks are not OK: ${badChecks.map((row) => row.Check).join(", ")}`);
}

const first = fixtureRows[0];
const sourceVersions = new Set(fixtureRows.map((row) => String(row.source_model_version ?? "")));
if (sourceVersions.size !== 1) throw new Error("Fixture rows have mixed source model versions.");

const fixture = {
  fixture_kind: "representative_excel_validation_package",
  limitation:
    "Representative validation package for harness development only. Not external institutional parity.",
  project_deal_name: first.project_deal_name,
  scenario: first.scenario,
  source_model_version: first.source_model_version,
  source_workbook: path.basename(workbookPath),
  expected_outputs: fixtureRows.map((row) => ({
    metric_key: row.metric_key,
    expected_value: row.expected_value,
    unit: row.unit,
    tolerance_abs: row.tolerance_abs,
    tolerance_pct: row.tolerance_pct,
    source_model_version: row.source_model_version,
    source_cell: row.source_cell,
    source_type: row.source_type,
    notes: row.notes,
  })),
  workbook_checks: checks.map((row) => ({
    check: row.Check,
    actual: row.Actual,
    expected: row.Expected,
    difference: row.Difference,
    tolerance: row.Tolerance,
    status: row.Status,
  })),
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
