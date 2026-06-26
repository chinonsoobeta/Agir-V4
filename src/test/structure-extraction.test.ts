import { describe, test, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  parseNamedRanges,
  parseSourcesAndUses,
  parseStructuredWorkbook,
  detectBlocks,
  applyHeaderMapping,
} from "@/lib/parsers/structure.server";
import type { SheetRow } from "@/lib/parsers/xlsx-utils";

const numFor = (rows: { field_key: string; value_numeric: number | null }[], key: string) =>
  rows.find((r) => r.field_key === key)?.value_numeric ?? null;

describe("WS2 2B named ranges", () => {
  test("a named range resolves to a taxonomy key and reads its cell value", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Exit Cap Rate", 5.25],
      ["Senior Loan", 120_000_000],
    ]);
    const book: XLSX.WorkBook = {
      SheetNames: ["Inputs"],
      Sheets: { Inputs: ws },
      Workbook: {
        Names: [
          { Name: "ExitCapRate", Ref: "Inputs!$B$1" }, // camelCase
          { Name: "senior_loan", Ref: "Inputs!$B$2" }, // snake_case
          { Name: "_FilterDatabase", Ref: "Inputs!$A$1:$B$2" }, // Excel internal, ignored
        ],
      },
    };
    const out = parseNamedRanges(book, "deal.xlsx");
    expect(numFor(out, "exit_cap_rate")).toBe(5.25);
    expect(numFor(out, "debt_amount")).toBe(120_000_000);
    // The Excel internal name never becomes a candidate.
    expect(out.every((m) => !m.matched_alias.includes("filterdatabase"))).toBe(true);
    // Named-range candidates carry their provenance location.
    expect(out.find((m) => m.field_key === "exit_cap_rate")?.source_location).toContain("Named range");
  });
});

describe("WS2 2B sources and uses", () => {
  const su: SheetRow[] = [
    ["Sources & Uses"],
    ["Sources"],
    ["Senior Loan", 120_000_000],
    ["Mezzanine Loan", 20_000_000],
    ["Sponsor Equity", 60_000_000],
    ["Total Sources", 200_000_000],
    ["Uses"],
    ["Land Acquisition", 40_000_000],
    ["Hard Costs", 120_000_000],
    ["Soft Costs", 30_000_000],
    ["Contingency", 10_000_000],
    ["Total Uses", 200_000_000],
  ];

  test("lifts debt, mezz, and equity from the Sources block and budget from Uses", () => {
    const { scalars, budgetRows } = parseSourcesAndUses(su, "S&U", "deal.xlsx");
    expect(numFor(scalars, "debt_amount")).toBe(120_000_000);
    expect(numFor(scalars, "mezz_debt_amount")).toBe(20_000_000);
    expect(numFor(scalars, "equity_amount")).toBe(60_000_000);
    // Total rows are never lifted (they would double-count).
    expect(scalars.some((s) => s.value_numeric === 200_000_000)).toBe(false);

    const cat = (label: string) => budgetRows.find((r) => r.label === label);
    expect(cat("Land Acquisition")?.category).toBe("land");
    expect(cat("Hard Costs")?.category).toBe("hard");
    expect(cat("Soft Costs")?.category).toBe("soft");
    expect(cat("Contingency")?.category).toBe("contingency");
    expect(budgetRows.some((r) => /total/i.test(r.label))).toBe(false);
  });

  test("a sheet with no Sources/Uses markers yields nothing (no false positives)", () => {
    const plain: SheetRow[] = [
      ["Category", "Amount"],
      ["Land", 40_000_000],
    ];
    expect(parseSourcesAndUses(plain, "Budget", "deal.xlsx")).toEqual({ budgetRows: [], scalars: [] });
  });

  test("workbook entry point reads Sources and Uses from a real buffer", () => {
    const ws = XLSX.utils.aoa_to_sheet(su);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, ws, "S&U");
    const buf = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const { sourcesUses } = parseStructuredWorkbook(buf, "deal.xlsx");
    expect(numFor(sourcesUses.scalars, "debt_amount")).toBe(120_000_000);
    expect(sourcesUses.budgetRows.length).toBe(4);
  });
});

describe("WS2 2B block detection", () => {
  test("splits a mixed sheet into its recognized blocks", () => {
    const rows: SheetRow[] = [
      ["Construction Budget"],
      ["Category", "Line Item", "Amount"],
      ["Land", "Site", 40_000_000],
      [],
      ["Rent Roll"],
      ["Unit Type", "Count", "Market Rent"],
      ["Residential", 100, 3000],
    ];
    const kinds = detectBlocks(rows).map((b) => b.kind);
    expect(kinds).toContain("budget");
    expect(kinds).toContain("rent_roll");
  });
});

describe("WS2 2C header mapping (deterministic consumer of an LLM structure suggestion)", () => {
  test("maps headers to columns, accepts alias suggestions, and drops unknown/ignore keys", () => {
    const cols = applyHeaderMapping(["Loan", "Mkt Rent", "Occ", "Junk"], {
      Loan: "senior loan", // an alias the deterministic index resolves to debt_amount
      "Mkt Rent": "residential_rent_monthly", // a canonical key
      Occ: "ignore",
      Junk: "not_a_real_key", // fail-closed: dropped
    });
    expect(cols).toEqual([
      { columnIndex: 0, field_key: "debt_amount", header: "Loan" },
      { columnIndex: 1, field_key: "residential_rent_monthly", header: "Mkt Rent" },
    ]);
  });
});
