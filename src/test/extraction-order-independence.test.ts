import { describe, expect, test } from "vitest";
import {
  auditResolvedAssumptions,
  groupAndResolve,
  type MappedCandidate,
} from "@/lib/assumption-mapping";

function candidate(overrides: Partial<MappedCandidate>): MappedCandidate {
  return {
    field_key: "exit_cap_rate",
    value_numeric: 5.25,
    value_text: null,
    unit: "%",
    confidence: 90,
    source_doc_name: "A.pdf",
    source_text: "Exit cap rate 5.25%",
    source_location: "p1",
    matched_alias: "exit cap rate",
    via: "alias",
    candidate_role: "scalar_assumption",
    ...overrides,
  };
}

function resolvedShape(candidates: MappedCandidate[]) {
  const grouped = groupAndResolve(candidates);
  return Array.from(grouped.values())
    .sort((a, b) => a.field_key.localeCompare(b.field_key))
    .map((row) => ({
      field_key: row.field_key,
      status: row.status,
      value_numeric: row.value_numeric,
      winner_source: row.winner.source_doc_name,
      member_sources: row.members.map((m) => m.source_doc_name),
      distinct: row.distinct,
      conflict_values: row.conflict_values,
    }));
}

function auditShape(candidates: MappedCandidate[]) {
  return auditResolvedAssumptions(groupAndResolve(candidates));
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) =>
    permutations(items.filter((_, i) => i !== index)).map((tail) => [item, ...tail]),
  );
}

describe("extraction merge determinism", () => {
  test("candidate/document order does not change resolved assumptions on confidence ties", () => {
    const candidates = [
      candidate({ source_doc_name: "Sponsor.pdf", source_location: "p3" }),
      candidate({ source_doc_name: "Lender.pdf", source_location: "p2" }),
      candidate({
        field_key: "interest_rate",
        value_numeric: 6.25,
        unit: "%",
        source_doc_name: "TermSheet.pdf",
        source_text: "All-in interest rate 6.25%",
        matched_alias: "interest rate",
      }),
      candidate({
        field_key: "interest_rate",
        value_numeric: 6.5,
        unit: "%",
        source_doc_name: "RateLock.pdf",
        source_text: "Interest rate 6.50%",
        matched_alias: "interest rate",
      }),
    ];
    const baseline = resolvedShape(candidates);

    for (const shuffled of permutations(candidates)) {
      expect(resolvedShape(shuffled)).toEqual(baseline);
    }
  });

  test("resolution audit is stable and explains confidence/value/source tie breaks", () => {
    const candidates = [
      candidate({ source_doc_name: "Sponsor.pdf", source_location: "p3" }),
      candidate({ source_doc_name: "Lender.pdf", source_location: "p2" }),
      candidate({ source_doc_name: "Appraisal.pdf", source_location: "p1", confidence: 88 }),
    ];
    const baseline = auditShape(candidates);

    expect(baseline[0].winner_source).toBe("Lender.pdf");
    expect(baseline[0].winner_reason).toContain("confidence 90");
    expect(baseline[0].winner_reason).toContain("value 5.25");
    expect(baseline[0].winner_reason).toContain("source Lender.pdf");
    expect(baseline[0].members.filter((m) => m.selected)).toHaveLength(1);

    for (const shuffled of permutations(candidates)) {
      expect(auditShape(shuffled)).toEqual(baseline);
    }
  });
});
