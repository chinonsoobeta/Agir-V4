import { describe, expect, test } from "vitest";
import * as XLSX from "xlsx";
import { detectMoneyScale } from "@/lib/money-scale";
import { parseBudgetWorkbook } from "@/lib/parsers/budget.server";
import { xlsxBufferToText } from "@/lib/document-text.server";
import { groupAndResolve, type MappedCandidate } from "@/lib/assumption-mapping";

function wb(aoa: unknown[][], sheetName = "Sheet1"): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, ws, sheetName);
  return XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("detectMoneyScale", () => {
  test("recognizes thousands / millions / billions in currency context", () => {
    expect(detectMoneyScale("Construction Budget ($ in thousands)")).toBe(1_000);
    expect(detectMoneyScale("Sources & Uses (in millions of dollars)")).toBe(1_000_000);
    expect(detectMoneyScale("Amount ($000)")).toBe(1_000);
    expect(detectMoneyScale("Cost ($MM)")).toBe(1_000_000);
    expect(detectMoneyScale("Budget (millions)")).toBe(1_000_000);
    expect(detectMoneyScale("amounts in $ billions")).toBe(1_000_000_000);
    expect(detectMoneyScale("Loan ('000s)")).toBe(1_000);
  });

  test("does not rescale non-currency columns or plain headers (no false positives)", () => {
    expect(detectMoneyScale("Rentable Area (in thousands of SF)")).toBe(1);
    expect(detectMoneyScale("Population (thousands)")).toBe(1);
    expect(detectMoneyScale("Units")).toBe(1);
    expect(detectMoneyScale("Amount")).toBe(1);
    expect(detectMoneyScale("Construction Budget")).toBe(1);
    expect(detectMoneyScale("")).toBe(1);
  });
});

describe("budget parser honors a declared scale (authoritative path)", () => {
  test("a '$ in thousands' tab lifts a 34,500 land line to $34.5M", () => {
    const { inserted } = parseBudgetWorkbook(
      wb(
        [
          ["Category", "Line Item", "Amount"],
          ["land", "Land acquisition", 34500],
          ["hard", "Hard costs", 162000],
        ],
        "Budget ($ in thousands)",
      ),
    );
    expect(inserted.find((r) => r.category === "land")?.amount).toBe(34_500_000);
    expect(inserted.find((r) => r.category === "hard")?.amount).toBe(162_000_000);
    expect(inserted.find((r) => r.category === "land")?.sourceText).toContain("Scale=thousands");
  });

  test("a column-header scale wins; an unscaled tab is left exactly as written", () => {
    const scaled = parseBudgetWorkbook(
      wb([
        ["Category", "Line Item", "Amount ($000)"],
        ["land", "Land", 5000],
      ]),
    );
    expect(scaled.inserted[0].amount).toBe(5_000_000);

    const plain = parseBudgetWorkbook(
      wb([
        ["Category", "Line Item", "Amount"],
        ["land", "Land", 8_500_000],
      ]),
    );
    expect(plain.inserted[0].amount).toBe(8_500_000);
  });
});

describe("free-text spreadsheet conversion honors a declared scale", () => {
  test("money columns are scaled; percent and count columns are not", async () => {
    const text = await xlsxBufferToText(
      wb(
        [
          ["Line Item", "Amount", "Occupancy", "Units"],
          ["Parcel A", 34500, 0.95, 220],
        ],
        "Budget (in thousands)",
      ),
    );
    expect(text).toContain("$34,500,000"); // money scaled 1000x
    expect(text).toContain("95.00%"); // percent untouched
    expect(text).toContain("220"); // count untouched (not 220,000)
    expect(text).not.toContain("220,000");
  });
});

describe("plausibility backstop blocks an implausibly small aggregate", () => {
  const base = (over: Partial<MappedCandidate>): MappedCandidate => ({
    field_key: "hard_costs",
    value_numeric: 162_000_000,
    value_text: null,
    unit: "$",
    confidence: 90,
    source_doc_name: "Budget.xlsx",
    source_text: "",
    source_location: null,
    matched_alias: "hard costs",
    via: "alias",
    ...over,
  });

  test("a sub-floor hard-costs value becomes a conflict, not a silent value", () => {
    const small = groupAndResolve([base({ value_numeric: 162_000 })]).get("hard_costs");
    expect(small?.status).toBe("conflicting");
    expect(small?.value_numeric).toBeNull();

    const ok = groupAndResolve([base({ value_numeric: 162_000_000 })]).get("hard_costs");
    expect(ok?.status).toBe("extracted");
    expect(ok?.value_numeric).toBe(162_000_000);
  });

  test("small-by-nature dollar keys are never floored", () => {
    const rent = groupAndResolve([
      base({ field_key: "residential_rent_monthly", value_numeric: 2500, matched_alias: "rent" }),
    ]).get("residential_rent_monthly");
    expect(rent?.status).toBe("extracted");
    expect(rent?.value_numeric).toBe(2500);
  });
});
