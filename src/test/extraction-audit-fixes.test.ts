// Regression locks for the 2026-06 extraction/finder/mapping audit fixes.
// Each test pins a specific bug that fed a wrong/lost value to the engine.

import { describe, expect, test } from "vitest";
import * as XLSX from "xlsx";
import { extractCandidates } from "@/lib/assumption-candidates.server";
import { groupAndResolve, mapCandidates } from "@/lib/assumption-mapping";
import { xlsxBufferToText, stripDocxXml } from "@/lib/document-text.server";
import { parseRentRollWorkbook } from "@/lib/parsers/rent-roll.server";
import { parseBudgetWorkbook } from "@/lib/parsers/budget.server";
import { aggregateBudgetRows } from "@/lib/budget-assumption-mapper";

function values(text: string): Map<string, number | string | null> {
  const grouped = groupAndResolve(mapCandidates(extractCandidates("doc.txt", text)));
  const out = new Map<string, number | string | null>();
  for (const g of grouped.values()) {
    if (g.status === "extracted") out.set(g.field_key, g.value_numeric ?? g.value_text);
  }
  return out;
}
function kinds(text: string) {
  return extractCandidates("doc.txt", text).map((c) => `${c.kind}:${c.value_numeric}`);
}
function workbookBuffer(sheets: { name: string; rows: unknown[][] }[]) {
  const book = XLSX.utils.book_new();
  for (const s of sheets)
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(s.rows), s.name);
  return XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("candidate extractor", () => {
  test("a scaled non-money quantity ('5 million square feet') is not emitted as currency", () => {
    const ks = kinds("The budget covers a 5 million square foot campus.");
    expect(ks).not.toContain("currency:5000000");
    // The adjacent, already-scaled-out form is still extracted as square footage.
    expect(kinds("Rentable area 5,000,000 SF")).toContain("sf:5000000");
  });

  test("'5 million residents' near a cost word is not read as $5,000,000", () => {
    const ks = kinds("The cost study covers a region of 5 million residents.");
    expect(ks).not.toContain("currency:5000000");
  });

  test("a unit descriptor does not bridge across 'per'", () => {
    // "5 dollars per units" must not yield a units count of 5.
    const ks = kinds("Tenants pay 5 dollars per units monthly.");
    expect(ks).not.toContain("units:5");
  });
});

describe("bare compact-suffix money vs item references", () => {
  test("'250M' / '162.5M' next to money labels are extracted as currency", () => {
    expect(kinds("Total development cost: 250M")).toContain("currency:250000000");
    expect(kinds("Senior debt amount: 162.5M")).toContain("currency:162500000");
  });

  test("an enumerator like 'Phase 2b' / 'Exhibit 4k' is NOT read as a money magnitude", () => {
    // A money word ("budget"/"cost") elsewhere on the line must not promote the
    // section reference to a dollar figure.
    expect(kinds("Phase 2b construction budget is on schedule.")).not.toContain(
      "currency:2000000000",
    );
    expect(kinds("Refer to Exhibit 4k of the cost report.")).not.toContain("currency:4000");
    expect(kinds("Building 3b cost overruns noted.")).not.toContain("currency:3000000000");
  });

  test("'12 km' and '18 months' are never money", () => {
    const ks = kinds("The trail is 12 km away; schedule is 18 months.");
    expect(ks.some((k) => k.startsWith("currency:"))).toBe(false);
  });
});

describe("scaled non-money quantities (millions/thousands of SF or units)", () => {
  test("'5 million square feet' is extracted as 5,000,000 SF, not $5M", () => {
    const ks = kinds("Rentable area of 5 million square feet");
    expect(ks).toContain("sf:5000000");
    expect(ks).not.toContain("currency:5000000");
  });

  test("'2 thousand units' is extracted at the scaled magnitude", () => {
    expect(kinds("A 2 thousand units portfolio")).toContain("units:2000");
  });

  test("'5 million units' is 5,000,000, not the bare 5 the descriptor rule would give", () => {
    expect(kinds("5 million units")).toContain("units:5000000");
  });
});

describe("tranche re-route (refinance / mezzanine qualifiers)", () => {
  test("a permanent-takeout loan amount maps to refinance_amount, not the senior debt", () => {
    const v = values("Loan amount (permanent takeout) $120,000,000");
    expect(v.get("refinance_amount")).toBe(120000000);
    expect(v.get("debt_amount")).toBeUndefined();
  });

  test("a mezzanine loan amount written generically maps to mezz_debt_amount", () => {
    const v = values("Loan amount (mezzanine) $25,000,000");
    expect(v.get("mezz_debt_amount")).toBe(25000000);
    expect(v.get("debt_amount")).toBeUndefined();
  });

  test("a refinance amortization maps to refinance_amort_years", () => {
    expect(values("Amortization (refinance) 30 years").get("refinance_amort_years")).toBe(30);
  });

  test("a refinance interest rate does not contaminate the senior interest rate", () => {
    const v = values("Interest rate (refinance) 6.0%");
    expect(v.get("refinance_rate")).toBe(6);
    expect(v.get("interest_rate")).toBeUndefined();
  });

  test("an unqualified senior loan amount / amortization are NOT re-routed", () => {
    expect(values("Senior loan amount $162,500,000").get("debt_amount")).toBe(162500000);
    expect(values("Amortization 30 years").get("amortization_years")).toBe(30);
  });
});

describe("mapper denomination + plausibility", () => {
  test("a multi-million lump sum labelled 'office rent' is not a per-SF rent", () => {
    expect(values("Office rent total $5,200,000").get("office_rent_psf")).toBeUndefined();
  });

  test("a multi-million lump sum labelled 'rent' is not a monthly residential rent", () => {
    expect(
      values("Total rent collected $50,000,000").get("residential_rent_monthly"),
    ).toBeUndefined();
  });
});

describe("sensitive-key guards", () => {
  test("economic/physical occupancy still populate the required stabilized occupancy", () => {
    expect(values("Economic occupancy 93%").get("stabilized_occupancy")).toBe(93);
    expect(values("Physical occupancy 95%").get("stabilized_occupancy")).toBe(95);
  });

  test("'OER 35%' populates the operating expense ratio", () => {
    expect(values("OER 35%").get("opex_ratio")).toBe(35);
  });

  test("a SOFR spread is not mapped to the all-in interest rate", () => {
    expect(values("SOFR spread of 2.50%").get("interest_rate")).toBeUndefined();
  });

  test("a mezzanine interest rate does not contaminate the senior interest rate", () => {
    const v = values("Interest rate (mezzanine) of 9.0%");
    expect(v.get("interest_rate")).toBeUndefined();
    expect(v.get("mezz_interest_rate")).toBe(9);
  });

  test("an implausible DSCR multiple is rejected, a real covenant is kept", () => {
    expect(values("DSCR covenant 7.5x").get("min_dscr")).toBeUndefined();
    expect(values("DSCR covenant 1.25x").get("min_dscr")).toBe(1.25);
  });
});

describe("spreadsheet text extraction", () => {
  test("a 'Total Units' column is not rescaled by an 'in thousands' sheet", () => {
    const buf = workbookBuffer([
      {
        name: "Summary (in thousands)",
        rows: [
          ["Line Item", "Total Cost", "Total Units"],
          ["Residential", 34500, 220],
        ],
      },
    ]);
    return xlsxBufferToText(buf).then((text) => {
      // The dollar column IS scaled; the unit count is NOT.
      expect(text).toContain("$34,500,000");
      expect(text).toMatch(/Total Units=220\b/);
      expect(text).not.toContain("220,000");
    });
  });

  test("a number stored as TEXT still receives the declared thousands scale", async () => {
    const buf = workbookBuffer([
      {
        name: "Budget ($ in thousands)",
        rows: [
          ["Line Item", "Amount"],
          ["Land", "34,500"], // text, not a number
        ],
      },
    ]);
    const text = await xlsxBufferToText(buf);
    expect(text).toContain("$34,500,000");
  });
});

describe("docx run boundaries", () => {
  test("a number Word split across runs is not truncated by a run-boundary space", () => {
    const xml =
      "<w:p><w:r><w:t>Senior Debt </w:t></w:r><w:r><w:t>$162,</w:t></w:r><w:r><w:t>500,000</w:t></w:r></w:p>";
    const text = stripDocxXml(xml);
    expect(text).toContain("$162,500,000");
    expect(text).not.toContain("$162, 500,000");
  });

  test("paragraph and table-cell boundaries still separate distinct values", () => {
    const xml =
      "<w:tr><w:tc><w:p><w:r><w:t>Preferred Equity</w:t></w:r></w:p></w:tc>" +
      "<w:tc><w:p><w:r><w:t>$37,500,000</w:t></w:r></w:p></w:tc></w:tr>";
    const text = stripDocxXml(xml);
    expect(text).not.toContain("Preferred Equity$37,500,000");
    expect(text).toContain("Preferred Equity");
    expect(text).toContain("$37,500,000");
  });
});

describe("structured parsers", () => {
  test("a 'Rent ($/SF)' column is detected and parsed per-SF", () => {
    const buf = workbookBuffer([
      {
        name: "Rent Roll",
        rows: [
          ["Component", "SF", "Rent ($/SF)"],
          ["Retail", 2000, 42],
        ],
      },
    ]);
    const parsed = parseRentRollWorkbook(buf);
    expect(parsed.inserted).toHaveLength(1);
    expect(parsed.inserted[0].rent).toBe(42);
    expect(parsed.inserted[0].rentBasis).toBe("per_sf");
  });

  test("a reported 0% occupancy is kept as 0, not dropped to null", () => {
    const buf = workbookBuffer([
      {
        name: "Rent Roll",
        rows: [
          ["Type", "Units", "Rent", "Occupancy"],
          ["Retail Shell", 1, 30, 0],
        ],
      },
    ]);
    const parsed = parseRentRollWorkbook(buf);
    expect(parsed.inserted[0].occupancyPct).toBe(0);
  });

  test("a '% of Total' column is not selected as the dollar amount", () => {
    const buf = workbookBuffer([
      {
        name: "Budget",
        rows: [
          ["Line Item", "% of Total", "Amount"],
          ["Land", 0.15, 3000000],
          ["Hard Costs", 0.7, 14000000],
        ],
      },
    ]);
    const parsed = parseBudgetWorkbook(buf);
    const land = parsed.inserted.find((r) => r.label === "Land");
    expect(land?.amount).toBe(3000000);
  });

  test("a parenthesized credit is parsed as negative, not dropped", () => {
    const buf = workbookBuffer([
      {
        name: "Budget",
        rows: [
          ["Line Item", "Amount"],
          ["Land Acquisition", 12000000],
          ["Seller Credit", "(500,000)"],
        ],
      },
    ]);
    const parsed = parseBudgetWorkbook(buf);
    const credit = parsed.inserted.find((r) => r.label === "Seller Credit");
    expect(credit?.amount).toBe(-500000);
  });

  test("a subtotal row is not double-counted with its detail lines", () => {
    const buf = workbookBuffer([
      {
        name: "Budget",
        rows: [
          ["Line Item", "Amount"],
          ["Concrete", 2000000],
          ["Framing", 3000000],
          ["Total Hard Costs", 5000000],
        ],
      },
    ]);
    const parsed = parseBudgetWorkbook(buf);
    const agg = aggregateBudgetRows(parsed.inserted, { name: "budget.xlsx" });
    const hard = agg.find((m) => m.field_key === "hard_costs");
    expect(hard?.value_numeric).toBe(5000000);
  });

  test("a summary-only budget (subtotals, no detail) keeps its category totals", () => {
    const buf = workbookBuffer([
      {
        name: "Budget",
        rows: [
          ["Line Item", "Amount"],
          ["Total Land Costs", 34500000],
          ["Total Hard Costs", 162000000],
        ],
      },
    ]);
    const parsed = parseBudgetWorkbook(buf);
    const agg = aggregateBudgetRows(parsed.inserted, { name: "budget.xlsx" });
    expect(agg.find((m) => m.field_key === "land_cost")?.value_numeric).toBe(34500000);
    expect(agg.find((m) => m.field_key === "hard_costs")?.value_numeric).toBe(162000000);
  });
});
