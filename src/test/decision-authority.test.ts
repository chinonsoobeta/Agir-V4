import { describe, expect, it } from "vitest";
import { buildDecision, type AssumptionRow } from "@/lib/decision";

function assumption(patch: Partial<AssumptionRow>): AssumptionRow {
  return {
    field_key: "market_rent",
    value_numeric: 42,
    confidence_score: 100,
    source_document_id: "source-document",
    source_location: "Rent roll, row 4",
    ...patch,
  };
}

describe("decision assumption authority", () => {
  it.each([
    assumption({ status: "modified", dual_control_pending: true }),
    assumption({ status: "conflicting", dual_control_pending: false }),
    assumption({ status: "rejected", dual_control_pending: false }),
    assumption({ status: "extracted", dual_control_pending: false }),
  ])("excludes non-authoritative review row %#", (row) => {
    expect(buildDecision([], [row]).confidenceScore).toBe(0);
  });

  it("retains reviewed rows that are effective", () => {
    const decision = buildDecision(
      [],
      [
        assumption({ status: "approved", dual_control_pending: false }),
        assumption({ status: "modified", dual_control_pending: null }),
      ],
    );
    expect(decision.confidenceScore).toBeGreaterThan(0);
  });
});
