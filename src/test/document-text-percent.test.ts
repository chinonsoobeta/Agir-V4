// Regression: whole-number percents on the spreadsheet -> text extraction path.
// Previously formatSpreadsheetCell only emitted a "%" when |cell| <= 1, so an
// occupancy stored as 96, an exit cap of 5.5, or an expense ratio of 35 lost the
// "%" and flowed downstream as a bare number with the wrong unit (or no candidate
// at all). Within an unambiguous percent context we now also accept 1 < |cell| <=
// 100 as an already-percent value, while leaving counts and >100 values alone.

import { describe, expect, test } from "vitest";
import * as XLSX from "xlsx";
import { xlsxBufferToText } from "@/lib/document-text.server";

function sheetToXlsxBuffer(aoa: (string | number)[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const written = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return (
    written instanceof Uint8Array
      ? written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength)
      : written
  ) as ArrayBuffer;
}

describe("whole-number percent extraction", () => {
  test("whole-number occupancy / cap / expense ratio / vacancy get a % suffix", async () => {
    const buf = sheetToXlsxBuffer([
      ["Metric", "Occupancy", "Exit Cap Rate", "Expense Ratio", "Vacancy"],
      ["Stabilized", 96, 5.5, 35, 4],
    ]);
    const text = await xlsxBufferToText(buf);
    expect(text).toContain("96.00%");
    expect(text).toContain("5.50%");
    expect(text).toContain("35.00%");
    expect(text).toContain("4.00%");
  });

  test("fractions (<=1) are still scaled to N% (unchanged behavior)", async () => {
    const text = await xlsxBufferToText(sheetToXlsxBuffer([["Occupancy"], [0.96]]));
    expect(text).toContain("96.00%");
  });

  test("a count column is never turned into a percent", async () => {
    const text = await xlsxBufferToText(sheetToXlsxBuffer([["Residential Units"], [220]]));
    expect(text).not.toContain("220.00%");
    expect(text).toContain("220");
  });

  test("a value above 100 in a percent column is left alone (never mislabeled)", async () => {
    const text = await xlsxBufferToText(sheetToXlsxBuffer([["Occupancy"], [2024]]));
    expect(text).not.toContain("2024.00%");
  });
});
