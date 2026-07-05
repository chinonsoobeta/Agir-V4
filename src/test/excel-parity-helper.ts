import { existsSync, readFileSync } from "node:fs";
import * as XLSX from "xlsx";

export type FixtureKind =
  | "synthetic_excel_parity_scaffold"
  | "representative_excel_validation_package";

export type ExcelParityExpectedRow = {
  metric_key: string;
  expected_value: number | string;
  unit?: string;
  tolerance?: number;
  tolerance_abs?: number;
  tolerance_pct?: number;
  source_model_version?: string;
  source_cell?: string;
  source_type?: string;
  notes?: string;
};

export type WorkbookCheckRow = {
  check: string;
  actual: number | string | null;
  expected: number | string | null;
  difference: number | string | null;
  tolerance: number | string | null;
  status: string;
};

export type ExcelParityFixture = {
  fixture_kind: FixtureKind;
  limitation?: string;
  project_deal_name: string;
  source_model_version: string;
  input_key?: "maple_heights";
  scenario: "base";
  expected_outputs: ExcelParityExpectedRow[];
  workbook_checks?: WorkbookCheckRow[];
};

export type ActualMetricMap = Record<string, number | string>;

export type ExcelParityVarianceRow = {
  project_deal_name: string;
  scenario: string;
  metric_key: string;
  expected_value: number | string;
  actual_value: number | string;
  absolute_variance: number;
  percentage_variance: number;
  tolerance: { absolute: number; percentage: number };
  source_model_version: string;
  source_cell: string | null;
  pass: boolean;
};

type RawWorkbookCheck = {
  Check?: unknown;
  Actual?: unknown;
  Expected?: unknown;
  Difference?: unknown;
  Tolerance?: unknown;
  Status?: unknown;
};

type RawFixtureRow = {
  project_deal_name?: unknown;
  scenario?: unknown;
  metric_key?: unknown;
  expected_value?: unknown;
  unit?: unknown;
  tolerance_abs?: unknown;
  tolerance_pct?: unknown;
  source_model_version?: unknown;
  source_cell?: unknown;
  source_type?: unknown;
  notes?: unknown;
};

function rowsForSheet(workbook: XLSX.WorkBook, sheetName: string): unknown[][] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Workbook is missing ${sheetName}.`);
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: null,
    raw: true,
  });
}

function tableObjects<T extends Record<string, unknown>>(
  rows: unknown[][],
  headerName: string,
): T[] {
  const headerIndex = rows.findIndex((row) => row[0] === headerName);
  if (headerIndex < 0) throw new Error(`Could not find ${headerName} header.`);
  const headers = rows[headerIndex].map((cell) => String(cell ?? "").trim());
  return rows
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => cell != null))
    .map((row) =>
      Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null])),
    ) as T[];
}

function stringValue(value: unknown): string {
  return String(value ?? "");
}

function numberValue(value: unknown, label: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be numeric.`);
  return number;
}

export function readRepresentativeWorkbookFixture(workbookPath: string): ExcelParityFixture {
  if (!existsSync(workbookPath)) throw new Error(`Workbook not found at ${workbookPath}.`);
  const workbook = XLSX.readFile(workbookPath, { cellFormula: true, cellDates: false });
  const fixtureRows = tableObjects<RawFixtureRow>(
    rowsForSheet(workbook, "Fixture_Table"),
    "project_deal_name",
  );
  const checks = tableObjects<RawWorkbookCheck>(rowsForSheet(workbook, "Checks"), "Check");
  if (!fixtureRows.length) throw new Error("Fixture_Table has no fixture rows.");
  const first = fixtureRows[0];
  return {
    fixture_kind: "representative_excel_validation_package",
    limitation:
      "Representative validation package for harness development only. Not external institutional parity.",
    project_deal_name: stringValue(first.project_deal_name),
    scenario: "base",
    source_model_version: stringValue(first.source_model_version),
    expected_outputs: fixtureRows.map((row) => ({
      metric_key: stringValue(row.metric_key),
      expected_value:
        typeof row.expected_value === "number"
          ? row.expected_value
          : stringValue(row.expected_value),
      unit: stringValue(row.unit),
      tolerance_abs: numberValue(row.tolerance_abs, `${row.metric_key} tolerance_abs`),
      tolerance_pct: numberValue(row.tolerance_pct, `${row.metric_key} tolerance_pct`),
      source_model_version: stringValue(row.source_model_version),
      source_cell: stringValue(row.source_cell),
      source_type: stringValue(row.source_type),
      notes: stringValue(row.notes),
    })),
    workbook_checks: checks.map((row) => ({
      check: stringValue(row.Check),
      actual:
        row.Actual == null
          ? null
          : typeof row.Actual === "number"
            ? row.Actual
            : stringValue(row.Actual),
      expected:
        row.Expected == null
          ? null
          : typeof row.Expected === "number"
            ? row.Expected
            : stringValue(row.Expected),
      difference:
        row.Difference == null
          ? null
          : typeof row.Difference === "number"
            ? row.Difference
            : stringValue(row.Difference),
      tolerance:
        row.Tolerance == null
          ? null
          : typeof row.Tolerance === "number"
            ? row.Tolerance
            : stringValue(row.Tolerance),
      status: stringValue(row.Status),
    })),
  };
}

export function loadExcelParityFixture(path: string): ExcelParityFixture {
  return JSON.parse(readFileSync(path, "utf8")) as ExcelParityFixture;
}

export function actualsFromExpected(fixture: ExcelParityFixture): ActualMetricMap {
  return Object.fromEntries(
    fixture.expected_outputs.map((row) => [row.metric_key, row.expected_value]),
  );
}

function compareNumeric(
  row: ExcelParityExpectedRow,
  actualValue: number | string,
): Pick<
  ExcelParityVarianceRow,
  "absolute_variance" | "percentage_variance" | "tolerance" | "pass"
> {
  const expected = numberValue(row.expected_value, `${row.metric_key} expected_value`);
  const actual = numberValue(actualValue, `${row.metric_key} actual_value`);
  const absoluteVariance = Math.abs(actual - expected);
  const percentageVariance =
    expected === 0 ? absoluteVariance : absoluteVariance / Math.abs(expected);
  const tolerance = {
    absolute: row.tolerance_abs ?? row.tolerance ?? 0,
    percentage: row.tolerance_pct ?? 0,
  };
  return {
    absolute_variance: absoluteVariance,
    percentage_variance: percentageVariance,
    tolerance,
    pass: absoluteVariance <= tolerance.absolute || percentageVariance <= tolerance.percentage,
  };
}

function compareText(
  row: ExcelParityExpectedRow,
  actualValue: number | string,
): Pick<
  ExcelParityVarianceRow,
  "absolute_variance" | "percentage_variance" | "tolerance" | "pass"
> {
  const pass = String(actualValue) === String(row.expected_value);
  return {
    absolute_variance: pass ? 0 : 1,
    percentage_variance: pass ? 0 : 1,
    tolerance: {
      absolute: row.tolerance_abs ?? row.tolerance ?? 0,
      percentage: row.tolerance_pct ?? 0,
    },
    pass,
  };
}

export function compareExcelParityFixture(
  fixture: ExcelParityFixture,
  actuals: ActualMetricMap,
): ExcelParityVarianceRow[] {
  return fixture.expected_outputs.map((row) => {
    if (!(row.metric_key in actuals)) throw new Error(`Missing actual metric ${row.metric_key}.`);
    const actualValue = actuals[row.metric_key];
    const result =
      typeof row.expected_value === "number"
        ? compareNumeric(row, actualValue)
        : compareText(row, actualValue);
    return {
      project_deal_name: fixture.project_deal_name,
      scenario: fixture.scenario,
      metric_key: row.metric_key,
      expected_value: row.expected_value,
      actual_value: actualValue,
      absolute_variance: result.absolute_variance,
      percentage_variance: result.percentage_variance,
      tolerance: result.tolerance,
      source_model_version: row.source_model_version ?? fixture.source_model_version,
      source_cell: row.source_cell ?? null,
      pass: result.pass,
    };
  });
}

export function formatExcelParityFailure(rows: ExcelParityVarianceRow[]): string {
  return rows
    .map(
      (row) =>
        `${row.project_deal_name} ${row.scenario} ${row.metric_key}: expected ${row.expected_value}, actual ${row.actual_value}, absolute variance ${row.absolute_variance}, percentage variance ${row.percentage_variance}, tolerance abs ${row.tolerance.absolute}, tolerance pct ${row.tolerance.percentage}, source ${row.source_model_version}, source cell ${row.source_cell ?? "n/a"}`,
    )
    .join("\n");
}

export function assertExcelParityWithinTolerance(
  fixture: ExcelParityFixture,
  actuals: ActualMetricMap,
): ExcelParityVarianceRow[] {
  const rows = compareExcelParityFixture(fixture, actuals);
  const failed = rows.filter((row) => !row.pass);
  if (failed.length) throw new Error(formatExcelParityFailure(failed));
  return rows;
}
