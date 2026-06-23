import { describe, expect, test } from "vitest";
import * as XLSX from "xlsx";
import { parseRentRollWorkbook } from "@/lib/parsers/rent-roll.server";
import { parseBudgetWorkbook } from "@/lib/parsers/budget.server";

// Build an in-memory .xlsx ArrayBuffer from a 2-D array of cells.
function wb(aoa: unknown[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, ws, "Sheet1");
  return XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("workbook parsers", () => {
  test("rent roll: a 'Rent PSF' column is not mistaken for the SF column", () => {
    // The old loose /sf/ test matched the "sf" inside "psf", copying the rent
    // value into avgSf. With \bsf\b it must not.
    const { inserted } = parseRentRollWorkbook(wb([
      ["Component", "Units", "Rent PSF", "Occupancy"],
      ["Retail", 1, 32.5, 93],
    ]));
    expect(inserted).toHaveLength(1);
    expect(inserted[0].rent).toBe(32.5);
    expect(inserted[0].avgSf).not.toBe(32.5);
  });

  test("rent roll: a dedicated SF column is read while 'Rent PSF' stays the rent", () => {
    const { inserted } = parseRentRollWorkbook(wb([
      ["Component", "Units", "Rentable SF", "Rent PSF", "Occupancy"],
      ["Retail", 1, 12000, 32.5, 93],
    ]));
    expect(inserted).toHaveLength(1);
    expect(inserted[0].avgSf).toBe(12000);
    expect(inserted[0].rent).toBe(32.5);
    expect(inserted[0].rentBasis).toBe("per_sf");
  });

  test("budget: a label column named like money does not preempt the numeric amount column", () => {
    // "Cost Center" matches the money-word regex but is a label; the amount
    // must be read from the actually-numeric "Amount" column.
    const { inserted } = parseBudgetWorkbook(wb([
      ["Cost Center", "Line Item", "Amount"],
      ["CC-1", "Land Acquisition", 26000000],
      ["CC-2", "Hard Costs (GMP)", 175000000],
    ]));
    const land = inserted.find((r) => /land/i.test(r.label));
    const hard = inserted.find((r) => /hard/i.test(r.label));
    expect(land?.amount).toBe(26000000);
    expect(hard?.amount).toBe(175000000);
  });
});
