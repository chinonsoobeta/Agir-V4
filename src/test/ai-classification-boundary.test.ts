// Tier 2 hardening: lock the AI classifier boundary against adversarial model
// output. The platform guarantees the optional AI pass can ONLY assign a
// regex-extracted candidate to a canonical key -- it can never invent a value,
// override an authoritative mapping, or reach a key/index it should not. The
// logic now lives in a pure function so the guarantee is tested directly rather
// than only enforced by code structure.

import { describe, expect, test } from "vitest";
import { applyAiClassifications, type AiClassification } from "@/lib/assumptions.functions";
import type { Candidate } from "@/lib/assumption-candidates.server";

function cand(overrides: Partial<Candidate> = {}): Candidate {
  return {
    kind: "currency",
    value_numeric: 34_500_000,
    value_text: "$34.5M",
    unit: "$",
    context: "Land acquisition cost $34,500,000",
    doc_name: "om.pdf",
    label_hint: "land acquisition",
    source_location: "char 12",
    ...overrides,
  };
}

const cls = (o: Partial<AiClassification> & { field_key: string }): AiClassification => ({
  candidate_index: 0,
  confidence_score: 80,
  ...o,
});

describe("AI classification boundary", () => {
  test("a valid classification assigns the candidate's own value to the key", () => {
    const out = applyAiClassifications([cls({ field_key: "land_cost" })], [cand()], new Set());
    expect(out).toHaveLength(1);
    // The value is the candidate's regex token, never anything the model supplies.
    expect(out[0].value_numeric).toBe(34_500_000);
    expect(out[0].field_key).toBe("land_cost");
    expect(out[0].matched_alias).toBe("(ai)");
    expect(out[0].confidence).toBe(80);
  });

  test("the value always comes from the candidate, even with a wildly confident model", () => {
    const out = applyAiClassifications(
      [cls({ field_key: "hard_costs", confidence_score: 100 })],
      [cand({ value_numeric: 162_000_000, value_text: "$162M" })],
      new Set(),
    );
    expect(out[0].value_numeric).toBe(162_000_000);
  });

  test("it never overrides a key an authoritative stage already resolved", () => {
    const out = applyAiClassifications(
      [cls({ field_key: "land_cost" })],
      [cand()],
      new Set(["land_cost"]),
    );
    expect(out).toEqual([]);
  });

  test("an out-of-range or negative candidate index is dropped", () => {
    expect(
      applyAiClassifications(
        [cls({ field_key: "land_cost", candidate_index: 99 })],
        [cand()],
        new Set(),
      ),
    ).toEqual([]);
    expect(
      applyAiClassifications(
        [cls({ field_key: "land_cost", candidate_index: -1 })],
        [cand()],
        new Set(),
      ),
    ).toEqual([]);
  });

  test("a key outside the taxonomy (or the 'ignore' sentinel) is dropped", () => {
    expect(
      applyAiClassifications([cls({ field_key: "totally_made_up_key" })], [cand()], new Set()),
    ).toEqual([]);
    expect(applyAiClassifications([cls({ field_key: "ignore" })], [cand()], new Set())).toEqual([]);
  });

  test("a numeric key cannot be filled by a candidate that has no numeric value", () => {
    const out = applyAiClassifications(
      [cls({ field_key: "land_cost" })],
      [cand({ value_numeric: null, kind: "date", value_text: "" })],
      new Set(),
    );
    expect(out).toEqual([]);
  });

  test("only the valid classifications survive a mixed adversarial batch", () => {
    const candidates = [
      cand({ value_numeric: 34_500_000 }), // 0: land
      cand({ value_numeric: 162_000_000 }), // 1: hard
    ];
    const out = applyAiClassifications(
      [
        cls({ field_key: "land_cost", candidate_index: 0 }), // valid
        cls({ field_key: "hard_costs", candidate_index: 1 }), // valid
        cls({ field_key: "interest_rate", candidate_index: 5 }), // bad index
        cls({ field_key: "fake_key", candidate_index: 0 }), // not in taxonomy
        cls({ field_key: "exit_cap_rate", candidate_index: 1 }), // authoritative -> blocked below
      ],
      candidates,
      new Set(["exit_cap_rate"]),
    );
    expect(out.map((m) => m.field_key).sort()).toEqual(["hard_costs", "land_cost"]);
    expect(out.map((m) => m.value_numeric).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      34_500_000, 162_000_000,
    ]);
  });
});
