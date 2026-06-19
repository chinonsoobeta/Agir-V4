import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractCandidates } from "@/lib/assumption-candidates.server";
import { extractFileText } from "@/lib/document-text.server";
import { groupAndResolve, mapCandidates } from "@/lib/assumption-mapping";
import { parseRentRollWorkbook } from "@/lib/parsers/rent-roll.server";
import { mapRevenueProgramRowToAssumptions } from "@/lib/revenue-assumption-mapper";
import { parseBudgetWorkbook } from "@/lib/parsers/budget.server";
import { mapBudgetRowToAssumption } from "@/lib/budget-assumption-mapper";

const fixtureDir = "/Users/chinonsoobeta/Downloads/Rivergate_Innovation_District_Test_Package/source_documents";
const rentRollPath = path.join(fixtureDir, "Rivergate_Rent_Roll.xlsx");
const budgetPath = path.join(fixtureDir, "Rivergate_Construction_Budget.xlsx");

async function readArrayBuffer(filePath: string): Promise<ArrayBuffer> {
  const bytes = await readFile(filePath);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("Rivergate revenue extraction", () => {
  test("spreadsheet text preserves row headers as key-value context", async () => {
    const text = await extractFileText("Rivergate_Rent_Roll.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", await readArrayBuffer(rentRollPath));
    expect(text).toContain("Sheet Rent Roll row 2: Unit Type=Residential | Unit Count=620 | Market Rent=$3,850 | Rent Basis=per_unit | Occupancy=95.00%");
    expect(text).toContain("Sheet Rent Roll row 3: Unit Type=Retail | Unit Count=1 | Avg SF=36,000 | Market Rent=$68 | Rent Basis=per_sf | Occupancy=92.00%");
    expect(text).toContain("Sheet Rent Roll row 4: Unit Type=Office | Unit Count=1 | Avg SF=120,000 | Market Rent=$55 | Rent Basis=per_sf | Occupancy=90.00%");
  });

  test("rent regex catches Rivergate rent notation variants", () => {
    const text = [
      "Residential rent $3,850/mo",
      "Residential rent $3,850 per month",
      "Residential rent $3,850 per unit per month",
      "Residential rent $3,850/unit/month",
      "Retail rent $68/SF",
      "Retail rent $68 per SF",
      "Retail rent $68 per square foot",
      "Retail rent 68 PSF",
      "Office rent 55 $/SF",
      "Office rent 55 per rentable square foot",
    ].join("\n");
    const rents = extractCandidates("rent-variants.txt", text).filter((c) => c.kind === "rent");
    expect(rents.map((c) => c.value_numeric)).toEqual([3850, 3850, 3850, 3850, 68, 68, 68, 68, 55, 55]);
    expect(rents.slice(0, 4).every((c) => c.unit === "$/mo")).toBe(true);
    expect(rents.slice(4).every((c) => c.unit === "$/SF")).toBe(true);
  });

  test("structured rent-roll rows map to assumption suggestions and revenue rows", async () => {
    const parsed = parseRentRollWorkbook(await readArrayBuffer(rentRollPath));
    expect(parsed.rejected).toHaveLength(1);
    expect(parsed.inserted).toMatchObject([
      { unitType: "Residential", unitCount: 620, avgSf: null, rent: 3850, rentBasis: "per_unit", occupancyPct: 95 },
      { unitType: "Retail", unitCount: 1, avgSf: 36000, rent: 68, rentBasis: "per_sf", occupancyPct: 92 },
      { unitType: "Office", unitCount: 1, avgSf: 120000, rent: 55, rentBasis: "per_sf", occupancyPct: 90 },
    ]);

    const mapped = parsed.inserted.flatMap((row) => mapRevenueProgramRowToAssumptions(row, { name: "Rivergate_Rent_Roll.xlsx" }));
    const grouped = groupAndResolve(mapped);
    const num = (key: string) => grouped.get(key)?.value_numeric ?? null;

    expect(num("residential_units")).toBe(620);
    expect(num("residential_rent_monthly")).toBe(3850);
    expect(num("residential_occupancy")).toBe(95);
    expect(num("retail_sf")).toBe(36000);
    expect(num("retail_rent_psf")).toBe(68);
    expect(num("retail_occupancy")).toBe(92);
    expect(num("office_sf")).toBe(120000);
    expect(num("office_rent_psf")).toBe(55);
    expect(num("office_occupancy")).toBe(90);

    for (const source of mapped.map((m) => m.source_text)) {
      expect(source).toContain("Component=");
      expect(source).toContain("Market Rent=");
    }
  });

  test("structured budget rows map to budget assumption suggestions and skip total row", async () => {
    const parsed = parseBudgetWorkbook(await readArrayBuffer(budgetPath));
    expect(parsed.inserted).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "land", label: "Land acquisition", amount: 58_750_000 }),
      expect.objectContaining({ category: "hard", label: "Hard costs", amount: 286_400_000 }),
      expect.objectContaining({ category: "soft", label: "Soft costs", amount: 48_900_000 }),
      expect.objectContaining({ category: "contingency", label: "Contingency", amount: 21_600_000 }),
      expect.objectContaining({ category: "financing_interest", label: "Financing costs / interest reserve", amount: 31_250_000 }),
    ]));
    expect(parsed.inserted.some((row) => row.label === "Total Development Cost")).toBe(false);

    const mapped = parsed.inserted.map((row) => mapBudgetRowToAssumption(row, { name: "Rivergate_Construction_Budget.xlsx" })).filter(Boolean);
    const grouped = groupAndResolve(mapped as any);
    const num = (key: string) => grouped.get(key)?.value_numeric ?? null;

    expect(num("land_cost")).toBe(58_750_000);
    expect(num("hard_costs")).toBe(286_400_000);
    expect(num("soft_costs")).toBe(48_900_000);
    expect(num("contingency")).toBe(21_600_000);
    expect(num("financing_costs")).toBe(31_250_000);
  });

  test("full Rivergate text plus structured rows extracts revenue without fabricating lease-up", async () => {
    const names = [
      "Rivergate_Appraisal_Valuation_Memo.pdf",
      "Rivergate_Construction_Budget.xlsx",
      "Rivergate_Environmental_Tax_Addendum.pdf",
      "Rivergate_Lender_Term_Sheet.pdf",
      "Rivergate_Market_Study.pdf",
      "Rivergate_Rate_Lock_Addendum.pdf",
      "Rivergate_Rent_Roll.xlsx",
      "Rivergate_Sponsor_Investment_Summary.pdf",
    ];
    const candidates = [];
    const structured = [];
    for (const name of names) {
      const buffer = await readArrayBuffer(path.join(fixtureDir, name));
      const text = await extractFileText(name, name.endsWith(".pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer);
      candidates.push(...extractCandidates(name, text));
      if (name === "Rivergate_Rent_Roll.xlsx") {
        structured.push(...parseRentRollWorkbook(buffer).inserted.flatMap((row) => mapRevenueProgramRowToAssumptions(row, { name })));
      }
    }

    const grouped = groupAndResolve([...mapCandidates(candidates), ...structured]);
    const num = (key: string) => grouped.get(key)?.value_numeric ?? null;

    expect(num("residential_units")).toBe(620);
    expect(num("residential_rent_monthly")).toBe(3850);
    expect(num("residential_occupancy")).toBe(95);
    expect(num("retail_sf")).toBe(36000);
    expect(num("retail_rent_psf")).toBe(68);
    expect(num("retail_occupancy")).toBe(92);
    expect(num("office_sf")).toBe(120000);
    expect(num("office_rent_psf")).toBe(55);
    expect(num("office_occupancy")).toBe(90);
    expect(num("land_cost")).toBe(58_750_000);
    expect(num("hard_costs")).toBe(286_400_000);
    expect(num("soft_costs")).toBe(48_900_000);
    expect(num("contingency")).toBe(21_600_000);
    expect(num("financing_costs")).toBe(31_250_000);
    expect(num("debt_amount")).toBe(276_800_000);
    expect(num("equity_amount")).toBe(184_600_000);
    expect(grouped.has("lease_up_months")).toBe(false);
  }, 30_000);
});
