// Engine-input plausibility boundary (Tier 2 hardening).
//
// Defense-in-depth against the units/scale failure class: even if extraction and
// the mapper let an unusual magnitude through (for example a 45% interest rate),
// this gate flags it for analyst review without blocking a legitimately
// stressed or distressed deal (a 12% exit cap, an 80% occupancy, a 15% rate all
// pass).
//
// Split policy:
// - impossible values are hard blockers in computeReadiness() before assembly.
// - unusual but possible stressed values stay warnings here for analyst review.

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
    Number.isFinite(input.interestRatePct) &&
      input.interestRatePct > 40 &&
      input.interestRatePct <= 100,
    "interestRatePct",
    input.interestRatePct,
    "Interest rate above 40%: unusual but possible; verify units and source.",
  );
  flag(
    Number.isFinite(input.exitCapRatePct) &&
      input.exitCapRatePct > 20 &&
      input.exitCapRatePct <= 100,
    "exitCapRatePct",
    input.exitCapRatePct,
    "Exit cap rate above 20%: unusual but possible; verify units and source.",
  );
  flag(
    input.rentGrowthPct < -20 || input.rentGrowthPct > 20,
    "rentGrowthPct",
    input.rentGrowthPct,
    "Rent growth outside -20% to 20%: check for a units/scale slip.",
  );
  flag(
    input.expenseGrowthPct < -20 || input.expenseGrowthPct > 20,
    "expenseGrowthPct",
    input.expenseGrowthPct,
    "Expense growth outside -20% to 20%: check for a units/scale slip.",
  );

  if (input.mezzanine) {
    flag(
      input.mezzanine.ratePct > 40 && input.mezzanine.ratePct <= 100,
      "mezzanine.ratePct",
      input.mezzanine.ratePct,
      "Mezzanine rate above 40%: unusual but possible; verify units and source.",
    );
  }

  if (input.refinance) {
    flag(
      input.refinance.ratePct > 40 && input.refinance.ratePct <= 100,
      "refinance.ratePct",
      input.refinance.ratePct,
      "Refinance rate above 40%: unusual but possible; verify units and source.",
    );
  }

  if (input.waterfall) {
    const wf = input.waterfall;
    flag(
      Math.abs(wf.lpEquityPct + wf.gpEquityPct - 100) > 0.01,
      "waterfall.equitySplit",
      wf.lpEquityPct + wf.gpEquityPct,
      "LP + GP equity shares do not sum to 100%.",
    );
    flag(
      wf.preferredReturnPct < 0 || wf.preferredReturnPct > 50,
      "waterfall.preferredReturnPct",
      wf.preferredReturnPct,
      "Preferred return outside 0-50%: check for a units/scale slip.",
    );
    wf.tiers.forEach((tier, i) => {
      flag(
        tier.gpPct < 0 || tier.gpPct > 100,
        `waterfall.tiers[${i}].gpPct`,
        tier.gpPct,
        `Promote tier ${i + 1} GP share outside 0-100%.`,
      );
    });
  }

  return out;
}
