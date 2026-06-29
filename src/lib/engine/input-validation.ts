// Engine-input plausibility boundary (Tier 2 hardening).
//
// Defense-in-depth against the units/scale failure class: even if extraction and
// the mapper let an implausible magnitude through (a rate read as 600%, an
// occupancy of 9,400%, a negative cost from a sign slip), this gate flags it
// BEFORE the number drives a metric. Bounds are deliberately WIDE -- they catch
// scale slips and impossibilities, never a legitimately stressed or distressed
// deal (a 12% exit cap, an 80% occupancy, a 15% rate all pass).
//
// This is a WARNING surface, not a hard block: readiness already fails closed on
// missing/conflicting inputs; this surfaces "present but implausible" for analyst
// review without refusing to compute.

import type { UnderwritingInput } from "./types";

export type InputViolation = {
  field: string;
  value: number;
  message: string;
};

export function validateEngineInput(input: UnderwritingInput): InputViolation[] {
  const out: InputViolation[] = [];
  const flag = (bad: boolean, field: string, value: number, message: string) => {
    if (bad) out.push({ field, value, message });
  };

  flag(
    !Number.isFinite(input.interestRatePct) ||
      input.interestRatePct < 0 ||
      input.interestRatePct > 40,
    "interestRatePct",
    input.interestRatePct,
    "Interest rate outside 0-40%: check for a units/scale slip.",
  );
  flag(
    !Number.isFinite(input.exitCapRatePct) ||
      input.exitCapRatePct <= 0 ||
      input.exitCapRatePct > 20,
    "exitCapRatePct",
    input.exitCapRatePct,
    "Exit cap rate outside 0-20%: check for a units/scale slip.",
  );
  flag(
    !Number.isFinite(input.expenseRatioPct) ||
      input.expenseRatioPct < 0 ||
      input.expenseRatioPct > 100,
    "expenseRatioPct",
    input.expenseRatioPct,
    "Operating expense ratio outside 0-100%.",
  );
  flag(
    !Number.isFinite(input.stabilizedOccupancyPct) ||
      input.stabilizedOccupancyPct < 0 ||
      input.stabilizedOccupancyPct > 100,
    "stabilizedOccupancyPct",
    input.stabilizedOccupancyPct,
    "Stabilized occupancy outside 0-100%.",
  );
  flag(input.loanAmount < 0, "loanAmount", input.loanAmount, "Senior loan amount is negative.");
  flag(input.holdYears <= 0, "holdYears", input.holdYears, "Hold period must be positive.");
  flag(
    input.amortYears <= 0,
    "amortYears",
    input.amortYears,
    "Amortization period must be positive.",
  );
  flag(
    input.sellingCostsPct < 0 || input.sellingCostsPct > 100,
    "sellingCostsPct",
    input.sellingCostsPct,
    "Selling costs outside 0-100%.",
  );

  for (const [k, v] of Object.entries(input.budget) as Array<[string, number | undefined]>) {
    if (v != null && v < 0) {
      flag(true, `budget.${k}`, v, `Budget ${k} is negative: check for a sign/scale slip.`);
    }
  }

  input.revenueProgram.forEach((row, i) => {
    flag(
      row.rent <= 0,
      `revenueProgram[${i}].rent`,
      row.rent,
      `${row.unitType} rent must be positive.`,
    );
    flag(
      row.unitCount <= 0,
      `revenueProgram[${i}].unitCount`,
      row.unitCount,
      `${row.unitType} unit count must be positive.`,
    );
    if (row.occupancyPct != null) {
      flag(
        row.occupancyPct < 0 || row.occupancyPct > 100,
        `revenueProgram[${i}].occupancyPct`,
        row.occupancyPct,
        `${row.unitType} occupancy outside 0-100%.`,
      );
    }
  });

  if (input.mezzanine) {
    flag(
      input.mezzanine.amount < 0,
      "mezzanine.amount",
      input.mezzanine.amount,
      "Mezzanine amount is negative.",
    );
    flag(
      input.mezzanine.ratePct < 0 || input.mezzanine.ratePct > 40,
      "mezzanine.ratePct",
      input.mezzanine.ratePct,
      "Mezzanine rate outside 0-40%: check for a units/scale slip.",
    );
  }

  return out;
}
