import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { mapleHeightsInput, runUnderwriting } from "@/lib/engine";
import {
  actualsFromExpected,
  assertExcelParityWithinTolerance,
  compareExcelParityFixture,
  loadExcelParityFixture,
  readRepresentativeWorkbookFixture,
  type ActualMetricMap,
  type ExcelParityFixture,
} from "./excel-parity-helper";

const REPRESENTATIVE_WORKBOOK =
  process.env.AGIR_EXCEL_PARITY_WORKBOOK ??
  "/Users/chinonsoobeta/outputs/agir_excel_parity_package/Agir_Representative_Excel_Validation_Package_v1.xlsx";

type SyntheticMetricKey = "tdc" | "noi" | "dscr" | "equity_multiple";

function fixtureDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "fixtures", "excel-parity");
}

function loadFixture(name: string): ExcelParityFixture {
  return loadExcelParityFixture(join(fixtureDir(), name));
}

function listSyntheticFixtureNames(): string[] {
  return readdirSync(fixtureDir())
    .filter((name) => name.endsWith(".json"))
    .filter((name) => name.startsWith("synthetic-"))
    .sort();
}

function syntheticMetricValues(inputKey: ExcelParityFixture["input_key"]): ActualMetricMap {
  if (inputKey !== "maple_heights") throw new Error(`Unknown fixture input ${inputKey}`);
  const values = runUnderwriting(mapleHeightsInput()).values;
  return {
    tdc: values.tdc,
    noi: values.noi,
    dscr: values.dscr,
    equity_multiple: values.equityMultiple,
  };
}

function isSyntheticMetricKey(value: string): value is SyntheticMetricKey {
  return ["tdc", "noi", "dscr", "equity_multiple"].includes(value);
}

describe("Excel parity validation scaffold", () => {
  test("all synthetic benchmark fixture files stay clearly labeled and pass within tolerance", () => {
    const fixtureNames = listSyntheticFixtureNames();
    expect(fixtureNames.length).toBeGreaterThan(0);
    for (const name of fixtureNames) {
      const fixture = loadFixture(name);
      expect(fixture.fixture_kind).toBe("synthetic_excel_parity_scaffold");
      for (const row of fixture.expected_outputs) {
        expect(isSyntheticMetricKey(row.metric_key)).toBe(true);
      }
      const rows = assertExcelParityWithinTolerance(
        fixture,
        syntheticMetricValues(fixture.input_key),
      );
      expect(rows.map((row) => row.metric_key)).toEqual(["tdc", "noi", "dscr", "equity_multiple"]);
    }
  });

  test("reads the representative workbook Fixture_Table when the workbook is available", () => {
    if (!existsSync(REPRESENTATIVE_WORKBOOK)) {
      expect(
        loadFixture("representative-maple-heights-excel-v1.json").expected_outputs,
      ).toHaveLength(15);
      return;
    }

    const fixture = readRepresentativeWorkbookFixture(REPRESENTATIVE_WORKBOOK);
    expect(fixture.fixture_kind).toBe("representative_excel_validation_package");
    expect(fixture.project_deal_name).toBe("Maple Heights Representative");
    expect(fixture.source_model_version).toBe("agir-representative-validation-v1.0");
    expect(fixture.expected_outputs).toHaveLength(15);
    expect(fixture.expected_outputs.at(-1)).toMatchObject({
      metric_key: "recommendation_code",
      expected_value: "REJECT",
      source_cell: "Outputs!B18",
    });
  });

  test("workbook checks are all OK in the generated representative fixture", () => {
    const fixture = loadFixture("representative-maple-heights-excel-v1.json");
    expect(fixture.fixture_kind).toBe("representative_excel_validation_package");
    expect(fixture.limitation).toContain("Not external institutional parity");
    expect(fixture.workbook_checks?.length).toBeGreaterThan(0);
    expect(fixture.workbook_checks?.map((row) => row.status)).toEqual(
      fixture.workbook_checks?.map(() => "OK"),
    );
  });

  test("numeric representative rows validate within tolerance when Agir outputs match", () => {
    const fixture = loadFixture("representative-maple-heights-excel-v1.json");
    const rows = assertExcelParityWithinTolerance(fixture, actualsFromExpected(fixture));
    const numericRows = rows.filter((row) => typeof row.expected_value === "number");

    expect(numericRows).toHaveLength(14);
    expect(numericRows.every((row) => row.pass)).toBe(true);
    expect(rows[0]).toMatchObject({
      project_deal_name: "Maple Heights Representative",
      scenario: "base",
      metric_key: "total_development_cost",
      expected_value: 114000000,
      actual_value: 114000000,
      absolute_variance: 0,
      percentage_variance: 0,
      source_model_version: "agir-representative-validation-v1.0",
      source_cell: "Inputs!B18",
    });
  });

  test("variance outside tolerance fails with source cell evidence", () => {
    const fixture = loadFixture("representative-maple-heights-excel-v1.json");
    const actuals = actualsFromExpected(fixture);
    actuals.total_development_cost = 113000000;

    expect(() => assertExcelParityWithinTolerance(fixture, actuals)).toThrow(
      /Maple Heights Representative base total_development_cost: expected 114000000, actual 113000000, absolute variance 1000000, percentage variance .* tolerance abs 100, tolerance pct 0.001, source agir-representative-validation-v1.0, source cell Inputs!B18/,
    );
  });

  test("text metrics compare exactly", () => {
    const fixture = loadFixture("representative-maple-heights-excel-v1.json");
    const actuals = actualsFromExpected(fixture);
    expect(
      assertExcelParityWithinTolerance(fixture, actuals).find(
        (row) => row.metric_key === "recommendation_code",
      ),
    ).toMatchObject({ pass: true, absolute_variance: 0 });

    actuals.recommendation_code = "APPROVE";
    const textRow = compareExcelParityFixture(fixture, actuals).find(
      (row) => row.metric_key === "recommendation_code",
    );
    expect(textRow).toMatchObject({
      expected_value: "REJECT",
      actual_value: "APPROVE",
      pass: false,
      absolute_variance: 1,
      percentage_variance: 1,
      source_cell: "Outputs!B18",
    });
  });

  test("synthetic variance outside tolerance still fails with variance output", () => {
    const fixture = loadFixture("synthetic-maple-heights.json");
    const badFixture: ExcelParityFixture = {
      ...fixture,
      expected_outputs: [{ metric_key: "tdc", expected_value: 1, tolerance: 0.01 }],
    };
    expect(() =>
      assertExcelParityWithinTolerance(badFixture, syntheticMetricValues(fixture.input_key)),
    ).toThrow(
      /Synthetic Maple Heights base tdc: expected 1, actual 42500000, absolute variance .* source Agir synthetic benchmark v1/,
    );
  });
});
