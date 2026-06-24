// Harbour Centre extraction pipeline: proves the deterministic pipeline turns
// the synthetic demo documents into the verified assumption set: real text out
// of every file, candidates for every Harbour field, canonical mappings, the
// documented exit-cap conflict, and a readiness gate that stays blocked until
// the conflict is resolved and the genuinely-absent defaults are accepted.

import { beforeAll, describe, expect, test } from "vitest";
import { buildHarbourDemoFiles } from "@/lib/harbour-demo-files.server";
import { extractFileText } from "@/lib/document-text.server";
import { extractCandidates, type Candidate } from "@/lib/assumption-candidates.server";
import { mapCandidates, groupAndResolve, mapCandidateToKey } from "@/lib/assumption-mapping";
import { REQUIRED_KEYS } from "@/lib/assumption-taxonomy";

type RenderedDoc = { name: string; file_type: string; text: string };

let rendered: RenderedDoc[] = [];
let allCandidates: Candidate[] = [];

beforeAll(async () => {
  const files = await buildHarbourDemoFiles();
  rendered = [];
  allCandidates = [];
  for (const f of files) {
    const ab = f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength);
    const text = await extractFileText(f.name, f.file_type, ab as ArrayBuffer);
    rendered.push({ name: f.name, file_type: f.file_type, text });
    allCandidates.push(...extractCandidates(f.name, text));
  }
}, 30_000);

const hasCurrency = (v: number) => allCandidates.some((c) => c.kind === "currency" && Math.round(c.value_numeric ?? -1) === v);
const hasPercent = (v: number) => allCandidates.some((c) => c.kind === "percent" && Math.abs((c.value_numeric ?? -1) - v) < 1e-6);
const hasRent = (v: number, unit: string) => allCandidates.some((c) => c.kind === "rent" && c.unit === unit && Math.round(c.value_numeric ?? -1) === v);
const hasSf = (v: number) => allCandidates.some((c) => c.kind === "sf" && Math.round(c.value_numeric ?? -1) === v);
const hasUnits = (v: number) => allCandidates.some((c) => c.kind === "units" && Math.round(c.value_numeric ?? -1) === v);
const hasDuration = (v: number, unit: string) => allCandidates.some((c) => c.kind === "duration" && c.unit === unit && Math.round(c.value_numeric ?? -1) === v);
const hasRatio = (v: number) => allCandidates.some((c) => c.kind === "ratio" && Math.abs((c.value_numeric ?? -1) - v) < 1e-6);

describe("Harbour Centre extraction pipeline", () => {
  // ---- Test A: storage / text extraction ----
  test("every demo document yields non-empty text", () => {
    expect(rendered.length).toBe(6);
    for (const doc of rendered) {
      expect(doc.text.length, `${doc.name} text_length`).toBeGreaterThan(0);
    }
  });

  // ---- Test B: candidate extraction ----
  test("candidates are extracted for every Harbour field", () => {
    expect(allCandidates.length).toBeGreaterThan(0);
    // Budget
    expect(hasCurrency(34_500_000)).toBe(true); // land
    expect(hasCurrency(162_000_000)).toBe(true); // hard
    expect(hasCurrency(27_500_000)).toBe(true); // soft
    expect(hasCurrency(18_000_000)).toBe(true); // financing
    expect(hasCurrency(8_000_000)).toBe(true); // contingency
    // Capital stack
    expect(hasCurrency(162_500_000)).toBe(true); // loan
    expect(hasCurrency(50_000_000)).toBe(true); // equity
    expect(hasPercent(6.25)).toBe(true); // interest
    expect(hasDuration(30, "yr")).toBe(true); // amortization
    expect(hasRatio(1.2)).toBe(true); // min dscr
    expect(hasPercent(93)).toBe(true); // lender stabilization
    // Revenue
    expect(hasUnits(220)).toBe(true);
    expect(hasRent(3050, "$/mo")).toBe(true);
    expect(hasSf(18_000)).toBe(true);
    expect(hasRent(42, "$/SF")).toBe(true);
    expect(hasSf(32_000)).toBe(true);
    expect(hasRent(36, "$/SF")).toBe(true);
    expect(hasPercent(96)).toBe(true);
    expect(hasPercent(92)).toBe(true);
    expect(hasPercent(85)).toBe(true);
    expect(hasPercent(3)).toBe(true); // rent growth
    // Exit cap conflict candidates
    expect(hasPercent(4.75)).toBe(true);
    expect(hasPercent(5.25)).toBe(true);
  });

  // ---- Test C: mapping to canonical keys ----
  test("the mapper produces canonical field_keys with correct values", () => {
    const grouped = groupAndResolve(mapCandidates(allCandidates));
    const num = (key: string) => grouped.get(key)?.value_numeric ?? null;

    expect(num("land_cost")).toBe(34_500_000);
    expect(num("hard_costs")).toBe(162_000_000);
    expect(num("soft_costs")).toBe(27_500_000);
    expect(num("financing_costs")).toBe(18_000_000);
    expect(num("contingency")).toBe(8_000_000);
    expect(num("debt_amount")).toBe(162_500_000);
    expect(num("equity_amount")).toBe(50_000_000);
    expect(num("interest_rate")).toBe(6.25);
    expect(num("amortization_years")).toBe(30);
    expect(num("min_dscr")).toBe(1.2);
    expect(num("lender_stabilized_occupancy")).toBe(93);
    expect(num("rent_growth")).toBe(3);
    expect(num("residential_units")).toBe(220);
    expect(num("residential_rent_monthly")).toBe(3050);
    expect(num("retail_sf")).toBe(18_000);
    expect(num("retail_rent_psf")).toBe(42);
    expect(num("office_sf")).toBe(32_000);
    expect(num("office_rent_psf")).toBe(36);
    expect(num("residential_occupancy")).toBe(96);
    expect(num("retail_occupancy")).toBe(92);
    expect(num("office_occupancy")).toBe(85);
  });

  // ---- Test D: conflict preservation ----
  test("exit cap is conflicting with 4.75 (broker) and 5.25 (lender)", () => {
    const grouped = groupAndResolve(mapCandidates(allCandidates));
    const cap = grouped.get("exit_cap_rate");
    expect(cap).toBeDefined();
    expect(cap!.status).toBe("conflicting");
    expect(cap!.value_numeric).toBeNull();
    const values = (cap!.conflict_values ?? []).map((c) => c.value).sort();
    expect(values).toEqual([4.75, 5.25]);
    const sources = (cap!.conflict_values ?? []).map((c) => c.source);
    expect(sources).toContain("Harbour_Centre_Broker_Opinion.pdf");
    expect(sources).toContain("Harbour_Centre_Lender_Term_Sheet.pdf");
  });

  // ---- Test E: readiness stays blocked until resolved ----
  test("underwriting is blocked until exit cap is resolved and defaults accepted", () => {
    const grouped = groupAndResolve(mapCandidates(allCandidates));

    // Exit cap conflict blocks readiness.
    expect(grouped.get("exit_cap_rate")?.status).toBe("conflicting");

    // Genuinely-absent defaultable keys are NOT extracted (remain missing).
    expect(grouped.has("opex_ratio")).toBe(false);
    expect(grouped.has("hold_period_years")).toBe(false);
    expect(grouped.has("disposition_cost_pct")).toBe(false);

    // All other required keys are present and unconflicted; stabilized occupancy
    // is satisfied by the three component occupancies.
    const componentOccupancyPresent = ["residential_occupancy", "retail_occupancy", "office_occupancy"]
      .every((k) => grouped.get(k)?.status === "extracted");
    expect(componentOccupancyPresent).toBe(true);

    for (const key of REQUIRED_KEYS) {
      if (key === "exit_cap_rate") continue; // conflicting by design
      if (key === "stabilized_occupancy") {
        expect(componentOccupancyPresent).toBe(true);
        continue;
      }
      expect(grouped.get(key)?.status, `${key} should be extracted`).toBe("extracted");
    }
  });

  // ---- Guard: no value maps to the wrong unit family ----
  test("unit/kind guard holds: interest rate and loan amount never collide", () => {
    // 6.25% (percent) must map to interest_rate, never debt_amount (a $ field).
    const interest = allCandidates.find((c) => c.kind === "percent" && c.value_numeric === 6.25)!;
    expect(mapCandidateToKey(interest)?.field_key).toBe("interest_rate");
    // $162,500,000 (currency) must map to debt_amount.
    const loan = allCandidates.find((c) => c.kind === "currency" && c.value_numeric === 162_500_000)!;
    expect(mapCandidateToKey(loan)?.field_key).toBe("debt_amount");
  });
});
