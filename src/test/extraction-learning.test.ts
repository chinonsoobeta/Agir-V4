import { describe, test, expect } from "vitest";
import {
  documentFingerprint,
  deriveAliasFromCorrection,
  buildTemplateEntries,
  applyTemplate,
  normalizeLabel,
  sourceLabelFromText,
} from "@/lib/extraction-learning";
import { mapCandidates } from "@/lib/assumption-mapping";
import type { Candidate } from "@/lib/assumption-candidates.server";

const cand = (over: Partial<Candidate> & Pick<Candidate, "kind" | "label_hint">): Candidate => ({
  value_numeric: 0,
  value_text: "",
  unit: "",
  context: "",
  doc_name: "doc",
  source_location: null,
  ...over,
});

describe("WS2 2D document fingerprint", () => {
  test("is stable, order-independent, and value-independent", () => {
    const a = documentFingerprint(["Land Cost", "Hard Costs", "Exit Cap Rate"]);
    const b = documentFingerprint(["exit cap rate", "  hard   costs ", "LAND COST"]);
    expect(a).toBe(b);
    expect(a).toMatch(/^fp1_[0-9a-f]{8}$/);
  });

  test("returns null when there is too little structure to be distinctive", () => {
    expect(documentFingerprint(["only", "two"])).toBeNull();
  });
});

describe("WS2 2D learned aliases", () => {
  test("a correction normalizes into a learned alias; unknown keys and tiny labels are rejected", () => {
    expect(deriveAliasFromCorrection("debt_amount", "Senior Facility ")).toEqual({
      field_key: "debt_amount",
      alias_text: "senior facility",
    });
    expect(deriveAliasFromCorrection("not_a_key", "Senior Facility")).toBeNull();
    expect(deriveAliasFromCorrection("debt_amount", "ab")).toBeNull();
  });

  test("an empty learned set leaves mapping byte-identical (a novel label stays unmapped)", () => {
    const c = cand({
      kind: "currency",
      value_numeric: 120_000_000,
      value_text: "$120,000,000",
      unit: "$",
      label_hint: "acme facility draw",
    });
    expect(mapCandidates([c])).toEqual(mapCandidates([c], []));
    expect(mapCandidates([c]).some((m) => m.field_key === "debt_amount")).toBe(false);
  });

  test("a learned alias makes a previously unmapped label resolve deterministically", () => {
    const c = cand({
      kind: "currency",
      value_numeric: 120_000_000,
      value_text: "$120,000,000",
      unit: "$",
      label_hint: "acme facility draw",
    });
    const learned = [deriveAliasFromCorrection("debt_amount", "Acme Facility Draw")!];
    const mapped = mapCandidates([c], learned);
    expect(mapped.find((m) => m.field_key === "debt_amount")?.value_numeric).toBe(120_000_000);
  });
});

describe("WS2 2D counterparty templates", () => {
  test("buildTemplateEntries normalizes, dedupes, and drops unknown keys", () => {
    const entries = buildTemplateEntries("fp1_x", [
      { field_key: "debt_amount", label: "Senior Facility" },
      { field_key: "not_a_key", label: "Bogus" },
      { field_key: "debt_amount", label: "senior facility" }, // duplicate after normalize
    ]);
    expect(entries).toEqual([{ fingerprint: "fp1_x", label: "senior facility", field_key: "debt_amount" }]);
  });

  test("applyTemplate auto-maps a candidate by its label, taking the value from the token", () => {
    const c = cand({
      kind: "percent",
      value_numeric: 5.25,
      value_text: "5.25%",
      unit: "%",
      label_hint: "Reversion Yield",
    });
    // The label is not a static alias, so it does not map today.
    expect(mapCandidates([c]).some((m) => m.field_key === "exit_cap_rate")).toBe(false);
    const template = [{ fingerprint: "fp1_x", label: normalizeLabel("Reversion Yield"), field_key: "exit_cap_rate" }];
    const mapped = applyTemplate([c], template);
    expect(mapped.find((m) => m.field_key === "exit_cap_rate")?.value_numeric).toBe(5.25);
  });

  test("applyTemplate refuses a unit/kind mismatch (a percent token never fills a dollar key)", () => {
    const c = cand({ kind: "percent", value_numeric: 5, value_text: "5%", unit: "%", label_hint: "weird debt label" });
    const template = [{ fingerprint: "fp1_x", label: normalizeLabel("weird debt label"), field_key: "debt_amount" }];
    expect(applyTemplate([c], template)).toEqual([]);
  });
});

describe("WS2 2D source label recovery", () => {
  test("recovers the structured line-item label and ignores loose context", () => {
    expect(sourceLabelFromText("Category=Costs | Line Item=Land acquisition | Amount=$34,500,000")).toBe(
      "Land acquisition",
    );
    expect(sourceLabelFromText("Category=Hard | Amount=$120,000,000")).toBe("Hard");
    expect(sourceLabelFromText("Senior facility of $120,000,000 at closing per the term sheet")).toBeNull();
    expect(sourceLabelFromText(null)).toBeNull();
  });
});
