import { describe, expect, test } from "vitest";
import {
  isRegisteredReconciliationCheck,
  RECONCILIATION_CHECKS,
  runReconciliationChecks,
} from "@/lib/engine";

const cleanContext = {
  tdc: 100,
  equity: 40,
  loan: 60,
  noi: 10,
  amortizingAnnualDebtService: 5,
  minDscr: 1.2,
  minAllInDscr: 1.1,
  allInDscr: 1.25,
  minDebtYield: 8,
  debtYieldPct: 16,
  lenderStabilizedOccupancyPct: 90,
  componentOccupancies: [{ unitType: "Retail", occupancyPct: 92 }],
  statedLtcPct: 60,
  statedTotalProjectCost: 100,
  budgetSum: 100,
  unitCounts: [100, 100],
};

describe("reconciliation check registry", () => {
  test("every emitted reconciliation flag is registered", () => {
    const flags = [
      ...runReconciliationChecks({ ...cleanContext, equity: 10 }),
      ...runReconciliationChecks({ ...cleanContext, statedLtcPct: 20 }),
      ...runReconciliationChecks({ ...cleanContext, noi: 1 }),
      ...runReconciliationChecks({ ...cleanContext, allInDscr: 1.0 }),
      ...runReconciliationChecks({ ...cleanContext, debtYieldPct: 7.5 }),
      ...runReconciliationChecks({
        ...cleanContext,
        componentOccupancies: [{ unitType: "Retail", occupancyPct: 85 }],
      }),
      ...runReconciliationChecks({ ...cleanContext, budgetSum: 130 }),
      ...runReconciliationChecks({ ...cleanContext, unitCounts: [100, 101] }),
    ];

    expect(RECONCILIATION_CHECKS.map((def) => def.key)).toContain("all_in_dscr_covenant");
    expect(flags.length).toBeGreaterThan(0);
    for (const flag of flags) {
      expect(isRegisteredReconciliationCheck(flag.check_key), flag.check_key).toBe(true);
    }
  });
});
