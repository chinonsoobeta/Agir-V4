import { describe, expect, test } from "vitest";
import { verifyNumericProvenance, buildAllowedValues } from "@/lib/engine";

describe("numeric provenance verifier (unit-aware)", () => {
  test("untyped allowed values stay unit-agnostic (backward compatible)", () => {
    const allowed = buildAllowedValues([5.25, 1_000_000]);
    // Against an untyped allowed value a percent and a dollar of the same
    // magnitude both validate -- the original, permissive behavior.
    expect(verifyNumericProvenance("Cap rate 5.25%", allowed).pass).toBe(true);
    expect(verifyNumericProvenance("Value $5.25", allowed).pass).toBe(true);
  });

  test("a $-tagged value does NOT validate a fabricated rate of the same magnitude", () => {
    // 5.25 exists only as a dollar amount; a fabricated "5.25%" must not be
    // waved through by it -- the unit-blind hole the audit flagged.
    const allowed = [
      { value: 5.25, unit: "$" as const },
      { value: -5.25, unit: "$" as const },
    ];
    const report = verifyNumericProvenance("Exit cap 5.25%", allowed);
    expect(report.pass).toBe(false);
    expect(report.orphans.some((o) => o.value === 5.25 && o.unit === "%")).toBe(true);
    // The same magnitude written as a dollar figure still validates.
    expect(verifyNumericProvenance("Fee $5.25", allowed).pass).toBe(true);
  });

  test("a rate validates against a same-unit tagged value", () => {
    const allowed = [{ value: 5.25, unit: "%" as const }];
    expect(verifyNumericProvenance("Exit cap 5.25%", allowed).pass).toBe(true);
  });

  test("a unit-less token validates against any same-magnitude tagged value", () => {
    const allowed = [{ value: 1.42, unit: "x" as const }];
    expect(verifyNumericProvenance("DSCR of 1.42", allowed).pass).toBe(true); // plain token
    expect(verifyNumericProvenance("DSCR of 1.42x", allowed).pass).toBe(true); // x token, same unit
  });
});
