import { describe, test, expect } from "vitest";
import { triageOrder, selectHighConfidenceTail, highlightSegments, type ReviewRow } from "@/lib/extraction-review";

const row = (over: Partial<ReviewRow> & { id: string }): ReviewRow => ({
  field_key: over.id,
  field_label: over.field_label ?? over.id,
  status: "extracted",
  confidence_score: 90,
  confidence_band: "high",
  ...over,
});

describe("WS2 2A triage order", () => {
  test("conflicts first, then low, then medium; high excluded", () => {
    const rows: ReviewRow[] = [
      row({ id: "hi", confidence_band: "high", confidence_score: 95 }),
      row({ id: "med", confidence_band: "medium", confidence_score: 70 }),
      row({ id: "low", confidence_band: "low", confidence_score: 30 }),
      row({ id: "conflict", status: "conflicting", confidence_band: "low", confidence_score: 0 }),
      row({ id: "approved", status: "approved", confidence_band: "high" }),
      row({ id: "missing", status: "missing", confidence_band: "missing" }),
    ];
    const order = triageOrder(rows).map((r) => r.id);
    expect(order).toEqual(["conflict", "low", "med"]);
  });

  test("within a tier the lowest confidence comes first", () => {
    const rows: ReviewRow[] = [
      row({ id: "low_b", confidence_band: "low", confidence_score: 40, field_label: "B" }),
      row({ id: "low_a", confidence_band: "low", confidence_score: 20, field_label: "A" }),
    ];
    expect(triageOrder(rows).map((r) => r.id)).toEqual(["low_a", "low_b"]);
  });
});

describe("WS2 2A high-confidence tail", () => {
  test("only clean high-confidence extracted rows are bulk-eligible", () => {
    const rows: ReviewRow[] = [
      row({ id: "hi1", confidence_band: "high", status: "extracted" }),
      row({ id: "hi2", confidence_band: "high", status: "extracted" }),
      row({ id: "conflict_hi", confidence_band: "high", status: "conflicting" }),
      row({ id: "med", confidence_band: "medium", status: "extracted" }),
      row({ id: "already", confidence_band: "high", status: "approved" }),
    ];
    expect(selectHighConfidenceTail(rows).sort()).toEqual(["hi1", "hi2"]);
  });
});

describe("WS2 2A source highlight", () => {
  test("marks the full value and escapes regex metacharacters", () => {
    const segs = highlightSegments("Land acquisition cost $34,500,000 per the budget", "$34,500,000");
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(["$34,500,000"]);
    expect(segs.map((s) => s.text).join("")).toBe("Land acquisition cost $34,500,000 per the budget");
  });

  test("falls back to the bare numeric core when the source omits the currency", () => {
    const segs = highlightSegments("Senior loan of 120,000,000 at closing", "$120,000,000");
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(["120,000,000"]);
  });

  test("a percentage value highlights itself, not an unrelated number", () => {
    const segs = highlightSegments("Exit cap 5.25% on stabilized NOI", "5.25%");
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(["5.25%"]);
  });

  test("nothing to highlight returns the text intact", () => {
    expect(highlightSegments("no value here", "")).toEqual([{ text: "no value here", match: false }]);
    expect(highlightSegments("", "$5")).toEqual([]);
  });
});
