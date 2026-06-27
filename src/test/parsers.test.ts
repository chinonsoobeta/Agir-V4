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

// Build a multi-sheet workbook.
function multiWb(sheets: { name: string; aoa: unknown[][] }[]): ArrayBuffer {
  const book = XLSX.utils.book_new();
  for (const s of sheets)
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(s.aoa), s.name);
  return XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

// Build a single-sheet workbook with explicit merged ranges (r/c, 0-indexed).
function wbWithMerges(aoa: unknown[][], merges: XLSX.Range[], sheetName = "Sheet1"): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!merges"] = merges;
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, ws, sheetName);
  return XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("workbook parsers", () => {
  test("rent roll: a 'Rent PSF' column is not mistaken for the SF column", () => {
    // The old loose /sf/ test matched the "sf" inside "psf", copying the rent
    // value into avgSf. With \bsf\b it must not.
    const { inserted } = parseRentRollWorkbook(
      wb([
        ["Component", "Units", "Rent PSF", "Occupancy"],
        ["Retail", 1, 32.5, 93],
      ]),
    );
    expect(inserted).toHaveLength(1);
    expect(inserted[0].rent).toBe(32.5);
    expect(inserted[0].avgSf).not.toBe(32.5);
  });

  test("rent roll: a dedicated SF column is read while 'Rent PSF' stays the rent", () => {
    const { inserted } = parseRentRollWorkbook(
      wb([
        ["Component", "Units", "Rentable SF", "Rent PSF", "Occupancy"],
        ["Retail", 1, 12000, 32.5, 93],
      ]),
    );
    expect(inserted).toHaveLength(1);
    expect(inserted[0].avgSf).toBe(12000);
    expect(inserted[0].rent).toBe(32.5);
    expect(inserted[0].rentBasis).toBe("per_sf");
  });

  test("budget: a label column named like money does not preempt the numeric amount column", () => {
    // "Cost Center" matches the money-word regex but is a label; the amount
    // must be read from the actually-numeric "Amount" column.
    const { inserted } = parseBudgetWorkbook(
      wb([
        ["Cost Center", "Line Item", "Amount"],
        ["CC-1", "Land Acquisition", 26000000],
        ["CC-2", "Hard Costs (GMP)", 175000000],
      ]),
    );
    const land = inserted.find((r) => /land/i.test(r.label));
    const hard = inserted.find((r) => /hard/i.test(r.label));
    expect(land?.amount).toBe(26000000);
    expect(hard?.amount).toBe(175000000);
  });
});

describe("2B: multi-sheet workbooks", () => {
  test("budget: scans every sheet and selects the budget tab, not the first sheet", () => {
    const { inserted, meta } = parseBudgetWorkbook(
      multiWb([
        {
          name: "Cover",
          aoa: [
            ["Project", "Harbour Centre"],
            ["Prepared by", "Capital Markets"],
          ],
        },
        {
          name: "Rent Roll",
          aoa: [
            ["Unit Type", "Units", "Rent"],
            ["1BR", 60, 2200],
          ],
        },
        {
          name: "Development Budget",
          aoa: [
            ["Category", "Line Item", "Amount"],
            ["land", "Land", 34_500_000],
            ["hard", "Hard costs", 162_000_000],
          ],
        },
      ]),
    );
    expect(meta.sheetsScanned).toBe(3);
    expect(meta.sheetSelected).toBe("Development Budget");
    expect(inserted.find((r) => r.category === "land")?.amount).toBe(34_500_000);
    expect(inserted.find((r) => r.category === "hard")?.amount).toBe(162_000_000);
  });

  test("rent roll: parses multiple rent-roll tabs and merges their rows", () => {
    const { inserted, meta } = parseRentRollWorkbook(
      multiWb([
        {
          name: "Summary",
          aoa: [
            ["Metric", "Value"],
            ["NOI", 6_000_000],
          ],
        },
        {
          name: "Residential",
          aoa: [
            ["Unit Type", "Units", "Rent", "Occupancy"],
            ["1BR", 60, 2200, 95],
            ["2BR", 50, 2600, 95],
          ],
        },
        {
          name: "Commercial",
          aoa: [
            ["Component", "Units", "Rent PSF", "Rentable SF", "Occupancy"],
            ["Retail", 1, 42, 18_000, 92],
          ],
        },
      ]),
    );
    expect(meta.sheetsSelected.sort()).toEqual(["Commercial", "Residential"]);
    expect(inserted).toHaveLength(3);
    expect(inserted.find((r) => r.unitType === "1BR")?.rent).toBe(2200);
    const retail = inserted.find((r) => r.unitType === "Retail");
    expect(retail?.rentBasis).toBe("per_sf");
    expect(retail?.avgSf).toBe(18_000);
    expect(retail?.rent).toBe(42);
  });
});

describe("2C: merged cells", () => {
  test("budget: a vertically merged category label is propagated to every spanned row", () => {
    // The "hard" category label is merged down across two line-item rows; without
    // propagation the second row would lose its category and be miscategorised.
    const aoa = [
      ["Category", "Line Item", "Amount"],
      ["hard", "Structure & shell", 100_000_000],
      [null, "Facade & envelope", 62_000_000],
    ];
    const { inserted, meta } = parseBudgetWorkbook(
      wbWithMerges(aoa, [{ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }]),
    );
    expect(meta.mergedCellsFilled).toBeGreaterThan(0);
    expect(inserted).toHaveLength(2);
    expect(inserted.every((r) => r.category === "hard")).toBe(true);
    expect(inserted.reduce((s, r) => s + r.amount, 0)).toBe(162_000_000);
  });

  test("budget: a merged title banner above the header is skipped and its scale honored", () => {
    // A merged "$ in thousands" title sits above the real header row.
    const aoa = [
      ["Construction Budget ($ in thousands)", null, null],
      ["Category", "Line Item", "Amount"],
      ["land", "Land acquisition", 34_500],
    ];
    const { inserted, meta } = parseBudgetWorkbook(
      wbWithMerges(aoa, [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }]),
    );
    expect(meta.headerRow).toBe(2); // 1-indexed: the real header is row 2
    // The scale declared in the title banner lifts 34,500 to $34.5M.
    expect(inserted.find((r) => r.category === "land")?.amount).toBe(34_500_000);
  });
});
