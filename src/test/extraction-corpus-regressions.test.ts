// Tier 3 hardening: a labeled corpus over the real-world patterns fixed in the
// 2026-06 extraction audit, run through the FULL pipeline (text extraction ->
// candidates -> mapping -> structured parsers -> group/resolve). Each fixture
// asserts (a) recall: every labelled value is extracted at the right key and
// magnitude, and (b) the dangerous mismaps that motivated the fixes never recur.
// Recall-based (not a strict global-precision ratchet) so incidental extra
// extractions never make it flaky -- the guarantees that matter are pinned.

import { describe, expect, test } from "vitest";
import * as XLSX from "xlsx";
import { extractFileText } from "@/lib/document-text.server";
import { extractCandidates } from "@/lib/assumption-candidates.server";
import { groupAndResolve, mapCandidates, type MappedCandidate } from "@/lib/assumption-mapping";
import { parseBudgetWorkbook } from "@/lib/parsers/budget.server";
import { parseRentRollWorkbook } from "@/lib/parsers/rent-roll.server";
import { aggregateBudgetRows } from "@/lib/budget-assumption-mapper";
import { mapRevenueProgramRowToAssumptions } from "@/lib/revenue-assumption-mapper";

function textBuffer(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function workbookBuffer(sheets: { name: string; rows: unknown[][] }[]) {
  const book = XLSX.utils.book_new();
  for (const s of sheets)
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(s.rows), s.name);
  return XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

async function predictions(
  name: string,
  fileType: string,
  buffer: ArrayBuffer,
): Promise<Map<string, number>> {
  const text = await extractFileText(name, fileType, buffer);
  const mapped: MappedCandidate[] = mapCandidates(extractCandidates(name, text));
  if (/\.(xlsx|xls)$/i.test(name)) {
    mapped.push(...aggregateBudgetRows(parseBudgetWorkbook(buffer).inserted, { name }));
    mapped.push(
      ...parseRentRollWorkbook(buffer).inserted.flatMap((row) =>
        mapRevenueProgramRowToAssumptions(row, { name }),
      ),
    );
  }
  const grouped = groupAndResolve(mapped);
  const out = new Map<string, number>();
  for (const row of grouped.values()) {
    if (row.status === "extracted" && row.value_numeric != null)
      out.set(row.field_key, Number(row.value_numeric));
  }
  return out;
}

const matches = (actual: number | undefined, expected: number) =>
  actual != null && Math.abs(actual - expected) <= Math.max(1e-6, Math.abs(expected) * 1e-9);

describe("extraction corpus: audited real-world patterns", () => {
  test("commercial rent roll with '$/SF' headers and no unit-count column", async () => {
    const buf = workbookBuffer([
      {
        name: "Rent Roll",
        rows: [
          ["Component", "SF", "Rent ($/SF)", "Occupancy"],
          ["Office", 120_000, 38, 0.92],
          ["Retail", 18_000, 45, 0.88],
        ],
      },
    ]);
    const p = await predictions("commercial_rent_roll.xlsx", "x", buf);
    // Per-SF rents are detected (the "Rent ($/SF)" header was previously dropped).
    expect(matches(p.get("office_rent_psf"), 38)).toBe(true);
    expect(matches(p.get("retail_rent_psf"), 45)).toBe(true);
    expect(matches(p.get("office_sf"), 120_000)).toBe(true);
    expect(matches(p.get("retail_sf"), 18_000)).toBe(true);
    expect(matches(p.get("office_occupancy"), 92)).toBe(true);
    expect(matches(p.get("retail_occupancy"), 88)).toBe(true);
    // The dangerous mismap: a $/SF rent must NOT land on the monthly field.
    expect(p.has("residential_rent_monthly")).toBe(false);
  });

  test("budget with a '% of Total' column and subtotal rows", async () => {
    const buf = workbookBuffer([
      {
        name: "Budget",
        rows: [
          ["Line Item", "% of Total", "Amount"],
          ["Land acquisition", 0.1, 30_000_000],
          ["Building shell", 0.4, 120_000_000],
          ["Sitework", 0.2, 60_000_000],
          ["Total Hard Costs", 0.6, 180_000_000],
          ["Soft costs", 0.1, 30_000_000],
        ],
      },
    ]);
    const p = await predictions("budget.xlsx", "x", buf);
    expect(matches(p.get("land_cost"), 30_000_000)).toBe(true);
    // Hard = shell 120M + sitework 60M; the "Total Hard Costs" subtotal must NOT
    // be double-counted, and the "% of Total" column must NOT be read as dollars.
    expect(matches(p.get("hard_costs"), 180_000_000)).toBe(true);
    expect(matches(p.get("soft_costs"), 30_000_000)).toBe(true);
  });

  test("capital-stack prose: scaled money, mezzanine, and a takeout refinance", async () => {
    const buf = textBuffer(
      [
        "Total development cost $300M.",
        "Senior loan amount 250M.",
        "Interest rate 6.25%.",
        "Mezzanine loan amount $25,000,000.",
        "Mezzanine interest rate 11%.",
        "Refinance loan amount (permanent takeout) $180,000,000.",
        "The development delivers 220 residential units across two towers.",
      ].join("\n"),
    );
    const p = await predictions("capital_stack.txt", "text/plain", buf);
    expect(matches(p.get("total_project_cost"), 300_000_000)).toBe(true);
    expect(matches(p.get("debt_amount"), 250_000_000)).toBe(true); // "250M" bare, near a money label
    expect(matches(p.get("interest_rate"), 6.25)).toBe(true);
    expect(matches(p.get("mezz_debt_amount"), 25_000_000)).toBe(true);
    expect(matches(p.get("mezz_interest_rate"), 11)).toBe(true);
    expect(matches(p.get("refinance_amount"), 180_000_000)).toBe(true);
    expect(matches(p.get("residential_units"), 220)).toBe(true);
    // The senior interest rate must not be contaminated by the mezzanine rate.
    expect(p.get("interest_rate")).not.toBe(11);
  });
});
