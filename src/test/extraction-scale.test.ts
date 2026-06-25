import { describe, expect, test } from "vitest";
import * as XLSX from "xlsx";
import { detectMoneyScale } from "@/lib/money-scale";
import { parseBudgetWorkbook } from "@/lib/parsers/budget.server";
import { xlsxBufferToText, extractFileTextWithMeta, pdfBufferToTextWithMeta } from "@/lib/document-text.server";
import { extractCandidates } from "@/lib/assumption-candidates.server";
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

describe("2A: OCR fallback for scanned / image-only PDFs (mocked boundary)", () => {
  // A buffer that is not a real text PDF: unpdf recovers nothing, so the text
  // layer is empty and the OCR fallback must engage.
  const scanned = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]).buffer;
  const mockOcr = async () => ({
    text: "Land acquisition cost $34,500,000. The project delivers 220 units. Exit cap rate 5.25%.",
    confidence: 87,
  });

  test("empty text layer -> OCR path -> recovered text yields candidates", async () => {
    const meta = await pdfBufferToTextWithMeta(scanned, { ocr: mockOcr });
    expect(meta.recoveredViaOcr).toBe(true);
    expect(meta.ocrConfidence).toBe(87);
    expect(meta.text).toContain("$34,500,000");

    const extracted = await extractFileTextWithMeta("Scanned_Term_Sheet.pdf", "application/pdf", scanned, { ocr: mockOcr });
    expect(extracted.recoveredViaOcr).toBe(true);
    const cands = extractCandidates("Scanned_Term_Sheet.pdf", extracted.text);
    expect(cands.length).toBeGreaterThan(0);
    expect(cands.some((c) => c.kind === "currency" && c.value_numeric === 34_500_000)).toBe(true);
    expect(cands.some((c) => c.kind === "units" && c.value_numeric === 220)).toBe(true);
  });

  test("OCR that recovers nothing degrades gracefully to no-text (not a crash)", async () => {
    const meta = await pdfBufferToTextWithMeta(scanned, { ocr: async () => ({ text: "", confidence: 0 }) });
    expect(meta.recoveredViaOcr).toBe(false);
    expect(meta.text).toBe("");
  });

  test("non-PDF documents never invoke the PDF OCR runner", async () => {
    const ws = XLSX.utils.aoa_to_sheet([["Category", "Line Item", "Amount"], ["land", "Land", 34_500_000]]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, ws, "Budget");
    const buf = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const throwing = async () => { throw new Error("OCR must not run for a spreadsheet"); };
    const extracted = await extractFileTextWithMeta("budget.xlsx", null, buf, { ocr: throwing });
    expect(extracted.recoveredViaOcr).toBe(false);
    expect(extracted.text.toLowerCase()).toContain("land");
  });
});

describe("2C: merged cells in the free-text spreadsheet path", () => {
  test("a merged label is propagated onto every spanned row instead of dropped", async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Category", "Line Item", "Amount"],
      ["Hard Costs", "Structure & shell", 100_000_000],
      [null, "Facade & envelope", 62_000_000],
    ]);
    ws["!merges"] = [{ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, ws, "Budget");
    const buf = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const text = await xlsxBufferToText(buf);
    const facadeLine = text.split("\n").find((l) => /Facade/.test(l));
    expect(facadeLine).toBeTruthy();
    expect(facadeLine).toMatch(/Hard Costs/i);
  });
});
