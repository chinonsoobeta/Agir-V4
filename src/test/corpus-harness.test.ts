import { describe, expect, it } from "vitest";
import { anonymizeText, residualPii } from "@/lib/corpus/anonymize";
import { scoreExtraction, aggregateScorecards } from "@/lib/corpus/score";

describe("corpus anonymizer", () => {
  it("scrubs PII but preserves financial structure", () => {
    const input =
      "Sponsor Acme Capital LLC (contact jane.doe@acme.com, (415) 555-0172) " +
      "is acquiring the asset for $34,500,000 at a 6.25% rate with 220 units. " +
      "SSN 123-45-6789, EIN 12-3456789, account #998877665544.";
    const { text, replacements } = anonymizeText(input, {
      salt: "test",
      namedEntities: ["Acme Capital LLC"],
    });

    // Financial structure is intact.
    expect(text).toContain("$34,500,000");
    expect(text).toContain("6.25%");
    expect(text).toContain("220 units");

    // PII is gone.
    expect(text).not.toContain("jane.doe@acme.com");
    expect(text).not.toContain("Acme Capital LLC");
    expect(text).not.toContain("123-45-6789");
    expect(text).not.toContain("12-3456789");
    expect(text).not.toContain("998877665544");
    expect(text).toContain("[SSN-REDACTED]");
    expect(text).toContain("[EIN-REDACTED]");

    const kinds = new Set(replacements.map((r) => r.kind));
    expect(kinds).toContain("email");
    expect(kinds).toContain("entity");
    expect(kinds).toContain("ssn");
    expect(kinds).toContain("account");
  });

  it("is deterministic: same input + salt yields identical output", () => {
    const opts = { salt: "s", namedEntities: ["Globex"] };
    const a = anonymizeText("Globex emailed ops@globex.io", opts).text;
    const b = anonymizeText("Globex emailed ops@globex.io", opts).text;
    expect(a).toBe(b);
    // The same entity maps to the same alias across documents.
    const doc2 = anonymizeText("Per Globex, terms apply.", opts).text;
    const alias = a.match(/Entity-[A-Z0-9]{4}/)?.[0];
    expect(alias).toBeTruthy();
    expect(doc2).toContain(alias!);
  });

  it("residualPii flags leftover identifiers and clears clean text", () => {
    expect(residualPii("contact me at a@b.com")).toContain("email");
    expect(residualPii("Net operating income is $1,200,000 at 5.0%")).toEqual([]);
  });
});

describe("extraction scorecard", () => {
  it("scores correct, incorrect, missing, and spurious fields", () => {
    const golden = { land_cost: 34_500_000, rate: 6.25, exit_cap: 5.25, units: 220 };
    const extracted = {
      land_cost: 34_500_000, // exact
      rate: 6.26, // within tolerance? 0.16% -> within 0.5%
      exit_cap: 4.75, // wrong
      sponsor_fee: 1_000_000, // spurious (not in golden)
      // units missing
    };
    const card = scoreExtraction(extracted, golden, { numericTolerance: 0.005 });
    const byKey = Object.fromEntries(card.verdicts.map((v) => [v.key, v.status]));
    expect(byKey.land_cost).toBe("correct");
    expect(byKey.rate).toBe("correct"); // within tolerance
    expect(byKey.exit_cap).toBe("incorrect");
    expect(byKey.units).toBe("missing");
    expect(byKey.sponsor_fee).toBe("spurious");
    expect(card.correct).toBe(2);
    expect(card.missing).toBe(1);
    expect(card.spurious).toBe(1);
    // precision = 2/4 produced; recall = 2/4 expected.
    expect(card.precision).toBe(0.5);
    expect(card.recall).toBe(0.5);
  });

  it("treats matching null values as correct and aggregates micro-averaged", () => {
    const c1 = scoreExtraction({ a: null }, { a: null });
    expect(c1.correct).toBe(1);
    const c2 = scoreExtraction({ a: 1, b: 2 }, { a: 1, b: 3 });
    const agg = aggregateScorecards([c1, c2]);
    expect(agg.correct).toBe(2); // a:null, a:1
    expect(agg.incorrect).toBe(1); // b
    expect(agg.precision).toBeCloseTo(2 / 3, 4);
  });
});
