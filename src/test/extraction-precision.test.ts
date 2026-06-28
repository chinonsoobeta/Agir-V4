// Precision guards for the free-text candidate mapper. These lock in fixes that
// keep a value from landing on the wrong assumption key (a far more dangerous
// failure than missing it, since a confidently-wrong number flows to the engine).

import { describe, expect, test } from "vitest";
import { extractCandidates } from "@/lib/assumption-candidates.server";
import { groupAndResolve, mapCandidates } from "@/lib/assumption-mapping";

function extractedValues(text: string): Map<string, number | string | null> {
  const grouped = groupAndResolve(mapCandidates(extractCandidates("doc.txt", text)));
  const out = new Map<string, number | string | null>();
  for (const g of grouped.values()) {
    if (g.status === "extracted") out.set(g.field_key, g.value_numeric ?? g.value_text);
  }
  return out;
}

describe("rent denomination is honoured ($/SF vs $/month)", () => {
  test("a per-SF rent never lands on the monthly residential rent field", () => {
    // Regression: "$36 PSF" (a $/SF rent) used to map to residential_rent_monthly
    // via the generic "asking rent" alias - a wrong field and a ~100x magnitude
    // error. It must not populate the monthly field.
    const values = extractedValues("Office asking rent $36 PSF");
    expect(values.get("residential_rent_monthly")).toBeUndefined();
  });

  test("a labelled per-SF rent maps to the matching $/SF field", () => {
    const values = extractedValues("Retail rent $42 PSF");
    expect(values.get("retail_rent_psf")).toBe(42);
    expect(values.get("residential_rent_monthly")).toBeUndefined();
  });

  test("a monthly per-unit rent maps to the monthly field, not a $/SF field", () => {
    const values = extractedValues("Average residential rent of $3,050 per month");
    expect(values.get("residential_rent_monthly")).toBe(3050);
    expect(values.get("retail_rent_psf")).toBeUndefined();
    expect(values.get("office_rent_psf")).toBeUndefined();
  });

  test("a monthly rent labelled retail does not contaminate a $/SF retail field", () => {
    const values = extractedValues("Retail rent $3,050 per month");
    expect(values.get("retail_rent_psf")).toBeUndefined();
  });
});

describe("unit-count prose recall (descriptor between the number and the noun)", () => {
  test("'220 residential units' is extracted and classified", () => {
    const values = extractedValues(
      "The development includes 220 residential units across five towers.",
    );
    expect(values.get("residential_units")).toBe(220);
  });

  test("a left-side type label still classifies via token matching", () => {
    const values = extractedValues("Residential: 220 units");
    expect(values.get("residential_units")).toBe(220);
  });

  test("a bare unit count with no type is not force-fit to a typed key", () => {
    // We would rather miss than guess the unit type from "220 units" alone.
    const values = extractedValues("Total 220 units");
    expect(values.get("residential_units")).toBeUndefined();
  });
});

describe("token-subset alias matching (non-contiguous labels)", () => {
  test("'office asking rent' classifies to office_rent_psf, not residential", () => {
    const values = extractedValues("Office asking rent $36 PSF");
    expect(values.get("office_rent_psf")).toBe(36);
    expect(values.get("residential_rent_monthly")).toBeUndefined();
  });
});

describe("percent ranges collapse to a single midpoint estimate", () => {
  test("an exit cap rate range maps to its midpoint, not a blocking conflict", () => {
    const grouped = groupAndResolve(
      mapCandidates(extractCandidates("doc.txt", "Exit cap rate range 5.0% - 5.5%")),
    );
    const row = grouped.get("exit_cap_rate");
    expect(row?.status).toBe("extracted");
    expect(row?.value_numeric).toBe(5.25);
  });

  test("an interest-rate range stated with 'to' also collapses to the midpoint", () => {
    const values = extractedValues("All-in interest rate 5.5% to 6.0%");
    expect(values.get("interest_rate")).toBe(5.75);
  });

  test("an occupancy range with a hyphen collapses to the midpoint", () => {
    const values = extractedValues("Stabilized occupancy 92%-95%");
    expect(values.get("stabilized_occupancy")).toBe(93.5);
  });
});
