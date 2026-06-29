import { describe, expect, test } from "vitest";
import { allowedValueForUnit, validatePersistedAssumptionUnits } from "@/lib/unit-contracts";
import {
  runReconciliationChecks,
  verifyNumericProvenance,
  type ReconciliationContext,
} from "@/lib/engine";

const covenantContext: ReconciliationContext = {
  tdc: 100_000_000,
  equity: 40_000_000,
  loan: 60_000_000,
  noi: 4_500_000,
  amortizingAnnualDebtService: 4_000_000,
  minDscr: 1.2,
  minAllInDscr: 1.15,
  allInDscr: 1.05,
  minDebtYield: 8.5,
  debtYieldPct: 8.0,
};

describe("mutation sentinels for financial guardrails", () => {
  test("covenant comparison direction mutants are killed", () => {
    const flags = runReconciliationChecks(covenantContext);

    expect(flags.some((flag) => flag.check_key === "covenant_feasibility")).toBe(true);
    expect(flags.some((flag) => flag.check_key === "all_in_dscr_covenant")).toBe(true);
    expect(flags.some((flag) => flag.check_key === "debt_yield_covenant")).toBe(true);
  });

  test("unit-scale mutants cannot validate wrong units", () => {
    expect(
      validatePersistedAssumptionUnits([{ field_key: "retail_rent_psf", unit: "$" }]),
    ).toHaveLength(1);
    expect(allowedValueForUnit(42, "$/mo")).toBeNull();
    expect(allowedValueForUnit(42, "$/SF")).toBe(42);
  });

  test("provenance unit-gate mutants are killed", () => {
    const allowed = [{ value: 5.25, unit: "$" as const }];

    expect(verifyNumericProvenance("Fee $5.25", allowed).pass).toBe(true);
    expect(verifyNumericProvenance("Exit cap 5.25%", allowed).pass).toBe(false);
  });
});
