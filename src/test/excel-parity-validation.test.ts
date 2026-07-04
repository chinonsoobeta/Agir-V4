import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { mapleHeightsInput, runUnderwriting } from "@/lib/engine";

type ExpectedRow = {
  metric_key: string;
  expected_value: number;
  tolerance: number;
};

type ExcelParityFixture = {
  fixture_kind: "synthetic_excel_parity_scaffold";
  project_deal_name: string;
  source_model_version: string;
  input_key: "maple_heights";
  scenario: "base";
  expected_outputs: ExpectedRow[];
};

type VarianceRow = ExpectedRow & {
  project_deal_name: string;
  scenario: string;
  source_model_version: string;
  actual_value: number;
  absolute_variance: number;
  percentage_variance: number;
  pass: boolean;
};

type MetricKey = "tdc" | "noi" | "dscr" | "equity_multiple";

function loadFixture(name: string): ExcelParityFixture {
  const here = dirname(fileURLToPath(import.meta.url));
  const text = readFileSync(join(here, "fixtures", "excel-parity", name), "utf8");
  return JSON.parse(text) as ExcelParityFixture;
}

function listFixtureNames(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return readdirSync(join(here, "fixtures", "excel-parity"))
    .filter((name) => name.endsWith(".json"))
    .sort();
}

function metricValues(inputKey: ExcelParityFixture["input_key"]) {
  if (inputKey !== "maple_heights") throw new Error(`Unknown fixture input ${inputKey}`);
  const values = runUnderwriting(mapleHeightsInput()).values;
  return {
    tdc: values.tdc,
    noi: values.noi,
    dscr: values.dscr,
    equity_multiple: values.equityMultiple,
  };
}

function isMetricKey(value: string): value is MetricKey {
  return ["tdc", "noi", "dscr", "equity_multiple"].includes(value);
}

function compareFixture(fixture: ExcelParityFixture): VarianceRow[] {
  const actual = metricValues(fixture.input_key);
  return fixture.expected_outputs.map((row) => {
    if (!isMetricKey(row.metric_key)) throw new Error(`Unknown metric ${row.metric_key}`);
    const actualValue = actual[row.metric_key];
    if (typeof actualValue !== "number" || !Number.isFinite(actualValue)) {
      throw new Error(`Metric ${row.metric_key} did not produce a finite value.`);
    }
    const absoluteVariance = Math.abs(actualValue - row.expected_value);
    const percentageVariance =
      row.expected_value === 0 ? absoluteVariance : absoluteVariance / Math.abs(row.expected_value);
    return {
      ...row,
      project_deal_name: fixture.project_deal_name,
      scenario: fixture.scenario,
      source_model_version: fixture.source_model_version,
      actual_value: actualValue,
      absolute_variance: absoluteVariance,
      percentage_variance: percentageVariance,
      pass: absoluteVariance <= row.tolerance,
    };
  });
}

function assertFixtureWithinTolerance(fixture: ExcelParityFixture) {
  const rows = compareFixture(fixture);
  const failed = rows.filter((row) => !row.pass);
  if (failed.length) {
    throw new Error(
      failed
        .map(
          (row) =>
            `${row.project_deal_name} ${row.scenario} ${row.metric_key}: expected ${row.expected_value}, actual ${row.actual_value}, absolute variance ${row.absolute_variance}, percentage variance ${row.percentage_variance}, tolerance ${row.tolerance}, source ${row.source_model_version}`,
        )
        .join("\n"),
    );
  }
  return rows;
}

describe("Excel parity validation scaffold", () => {
  test("all synthetic benchmark fixture files pass within tolerance", () => {
    const fixtureNames = listFixtureNames();
    expect(fixtureNames.length).toBeGreaterThan(0);
    for (const name of fixtureNames) {
      const fixture = loadFixture(name);
      expect(fixture.fixture_kind).toBe("synthetic_excel_parity_scaffold");
      const rows = assertFixtureWithinTolerance(fixture);
      expect(rows.map((row) => row.metric_key)).toEqual(["tdc", "noi", "dscr", "equity_multiple"]);
    }
  });

  test("variance outside tolerance fails with absolute and percentage variance", () => {
    const fixture = loadFixture("synthetic-maple-heights.json");
    const badFixture: ExcelParityFixture = {
      ...fixture,
      expected_outputs: [{ metric_key: "tdc", expected_value: 1, tolerance: 0.01 }],
    };
    expect(() => assertFixtureWithinTolerance(badFixture)).toThrow(
      /Synthetic Maple Heights base tdc: expected 1, actual 42500000, absolute variance .* source Agir synthetic benchmark v1/,
    );
  });
});
