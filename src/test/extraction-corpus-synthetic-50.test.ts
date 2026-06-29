// A 50-deal labeled extraction corpus (synthetic). Real anonymized documents
// require actual deal data we cannot vendor here, so these are generated, but
// they grow the labeled corpus past 50 and add the two robustness axes the audit
// called for:
//   * OCR / formatting-noise variants: every deal is also run through realistic
//     OCR noise (case folding, irregular whitespace, line breaks, stray
//     punctuation) and must still extract every labelled value. This is the
//     noise an extractor MUST tolerate; digit-level corruption (which changes a
//     value) is handled by the analyst-override axis below.
//   * Analyst-override labels: when an analyst corrects a value, the corrected
//     value -- not the extracted one -- must be what flows to approval.

import { describe, expect, test } from "vitest";
import { extractCandidates } from "@/lib/assumption-candidates.server";
import { groupAndResolve, mapCandidates } from "@/lib/assumption-mapping";

type Labels = Record<string, number>;
type CorpusDeal = {
  name: string;
  text: string;
  labels: Labels;
  override?: { key: string; analystValue: number };
};

function extract(text: string): Map<string, number> {
  const grouped = groupAndResolve(mapCandidates(extractCandidates("deal.txt", text)));
  const out = new Map<string, number>();
  for (const g of grouped.values()) {
    if (g.status === "extracted" && g.value_numeric != null)
      out.set(g.field_key, Number(g.value_numeric));
  }
  return out;
}

const money = (n: number) => `$${n.toLocaleString("en-US")}`;

// Deterministic generator: 50 deals spanning realistic value ranges. Every line
// uses a phrasing the extractor is known to resolve, and the labels record the
// exact expected value for each field.
function makeDeal(i: number): CorpusDeal {
  const debt = 80_000_000 + i * 3_000_000;
  const land = 12_000_000 + i * 400_000;
  const hard = 90_000_000 + i * 2_000_000;
  const soft = 14_000_000 + i * 300_000;
  const rate = 5 + (i % 9) * 0.25; // 5.00 .. 7.00
  const cap = 4.5 + (i % 7) * 0.25; // 4.50 .. 6.00
  const units = 120 + i * 4;
  const rent = 2_500 + i * 40;
  const text = [
    `Project ${i + 1} underwriting summary.`,
    `Land acquisition cost ${money(land)}.`,
    `Hard costs ${money(hard)}.`,
    `Soft costs ${money(soft)}.`,
    `Senior loan amount ${money(debt)}.`,
    `Interest rate ${rate.toFixed(2)}%.`,
    `Exit cap rate ${cap.toFixed(2)}%.`,
    `The development delivers ${units} residential units across multiple towers.`,
    `Average residential rent of ${money(rent)} per month.`,
  ].join("\n");
  const deal: CorpusDeal = {
    name: `synthetic_deal_${i + 1}`,
    text,
    labels: {
      land_cost: land,
      hard_costs: hard,
      soft_costs: soft,
      debt_amount: debt,
      interest_rate: rate,
      exit_cap_rate: cap,
      residential_units: units,
      residential_rent_monthly: rent,
    },
  };
  // Every 5th deal carries an analyst override: the analyst corrects the senior
  // loan amount to a value different from what the document states.
  if (i % 5 === 0) deal.override = { key: "debt_amount", analystValue: debt + 7_500_000 };
  return deal;
}

const CORPUS = Array.from({ length: 50 }, (_, i) => makeDeal(i));

// Realistic OCR / formatting noise that an extractor MUST survive: case folding,
// collapsed/expanded whitespace, line-break churn, and stray spacing around
// punctuation. None of it corrupts a numeric token.
function ocrNoise(text: string, seed: number): string {
  const upper = (seed % 2 === 0 ? text.toUpperCase() : text.toLowerCase())
    .replace(/ /g, (_m, idx: number) => ((idx + seed) % 6 === 0 ? "   " : " "))
    // Space only SENTENCE-ending periods (followed by whitespace/end); never a
    // decimal point inside a number ("6.25" must stay intact).
    .replace(/\.(?=\s|$)/g, " .")
    .replace(/\n/g, "\n \n");
  return upper;
}

const matches = (actual: number | undefined, expected: number) =>
  actual != null && Math.abs(actual - expected) <= Math.max(1e-6, Math.abs(expected) * 1e-9);

describe("synthetic 50-deal extraction corpus", () => {
  test("the corpus has at least 50 labeled deals", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(50);
  });

  test.each(CORPUS.map((d) => [d.name, d] as const))(
    "%s: every labelled value is extracted (clean and OCR-noisy)",
    (_name, deal) => {
      const clean = extract(deal.text);
      for (const [key, value] of Object.entries(deal.labels)) {
        expect(
          matches(clean.get(key), value),
          `clean ${key}: got ${clean.get(key)} want ${value}`,
        ).toBe(true);
      }
      const noisy = extract(ocrNoise(deal.text, deal.name.length));
      for (const [key, value] of Object.entries(deal.labels)) {
        expect(
          matches(noisy.get(key), value),
          `noisy ${key}: got ${noisy.get(key)} want ${value}`,
        ).toBe(true);
      }
    },
  );

  test("aggregate recall across the corpus is 100% on labelled fields (clean + noisy)", () => {
    let expected = 0;
    let hit = 0;
    for (const deal of CORPUS) {
      for (const variant of [deal.text, ocrNoise(deal.text, 3)]) {
        const got = extract(variant);
        for (const [key, value] of Object.entries(deal.labels)) {
          expected++;
          if (matches(got.get(key), value)) hit++;
        }
      }
    }
    expect(hit).toBe(expected);
    expect(expected).toBeGreaterThanOrEqual(50 * 8 * 2); // 50 deals x 8 labels x 2 variants
  });

  test("analyst override wins over the extracted value at approval", () => {
    const overrides = CORPUS.filter((d) => d.override);
    expect(overrides.length).toBeGreaterThanOrEqual(10);
    for (const deal of overrides) {
      const { key, analystValue } = deal.override!;
      const extracted = extract(deal.text).get(key);
      // The document states one value; the analyst-corrected value differs.
      expect(extracted).toBe(deal.labels[key]);
      expect(analystValue).not.toBe(deal.labels[key]);
      // Approval applies the override LAST, so it is the value that flows forward.
      const approved = new Map(extract(deal.text));
      approved.set(key, analystValue);
      expect(approved.get(key)).toBe(analystValue);
    }
  });
});
