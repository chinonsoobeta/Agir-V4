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
  // amortYears = 0 is the supported interest-only convention (tranches.ts);
  // only a negative value is impossible.
  flag(input.amortYears < 0, "amortYears", input.amortYears, "Amortization period is negative.");
  flag(
    input.constructionMonths < 0,
    "constructionMonths",
    input.constructionMonths,
    "Construction months is negative.",
  );
  flag(
    input.leaseUpMonths < 0,
    "leaseUpMonths",
    input.leaseUpMonths,
    "Lease-up months is negative.",
  );
  flag(input.ioMonths < 0, "ioMonths", input.ioMonths, "Interest-only months is negative.");
  flag(
    (input.equityAmount ?? 0) < 0,
    "equityAmount",
    input.equityAmount ?? 0,
    "Equity amount is negative.",
  );
  flag(
    (input.equityDrawMonths ?? 0) < 0,
    "equityDrawMonths",
    input.equityDrawMonths ?? 0,
    "Equity draw months is negative.",
  );
  // The only fraction-typed input (0.55 = 55% average outstanding): a
  // percent-style 55 would inflate the computed interest carry ~100x.
  flag(
    input.avgOutstandingFactor != null &&
      (input.avgOutstandingFactor < 0 || input.avgOutstandingFactor > 1),
    "avgOutstandingFactor",
    input.avgOutstandingFactor ?? 0,
    "Average outstanding factor is a FRACTION (0-1), not a percent.",
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
    flag(
      input.mezzanine.amortYears < 0,
      "mezzanine.amortYears",
      input.mezzanine.amortYears,
      "Mezzanine amortization period is negative.",
    );
    flag(
      input.mezzanine.ioMonths < 0,
      "mezzanine.ioMonths",
      input.mezzanine.ioMonths,
      "Mezzanine interest-only months is negative.",
    );
  }

  if (input.refinance) {
    flag(
      input.refinance.ratePct < 0 || input.refinance.ratePct > 40,
      "refinance.ratePct",
      input.refinance.ratePct,
      "Refinance rate outside 0-40%: check for a units/scale slip.",
    );
    flag(
      input.refinance.ltvPct != null &&
        (input.refinance.ltvPct <= 0 || input.refinance.ltvPct > 100),
      "refinance.ltvPct",
      input.refinance.ltvPct ?? 0,
      "Refinance LTV outside 0-100%.",
    );
    flag(
      input.refinance.amortYears < 0,
      "refinance.amortYears",
      input.refinance.amortYears,
      "Refinance amortization period is negative.",
    );
    flag(
      input.refinance.ioMonths < 0,
      "refinance.ioMonths",
      input.refinance.ioMonths,
      "Refinance interest-only months is negative.",
    );
  }

  if (input.waterfall) {
    const wf = input.waterfall;
    flag(
      wf.lpEquityPct < 0 || wf.lpEquityPct > 100,
      "waterfall.lpEquityPct",
      wf.lpEquityPct,
      "LP equity share outside 0-100%.",
    );
    flag(
      wf.gpEquityPct < 0 || wf.gpEquityPct > 100,
      "waterfall.gpEquityPct",
      wf.gpEquityPct,
      "GP equity share outside 0-100%.",
    );
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
    flag(
      wf.gpCatchUpPct < 0 || wf.gpCatchUpPct > 100,
      "waterfall.gpCatchUpPct",
      wf.gpCatchUpPct,
      "GP catch-up outside 0-100%.",
    );
    wf.tiers.forEach((tier, i) => {
      flag(
        tier.gpPct < 0 || tier.gpPct > 100,
        `waterfall.tiers[${i}].gpPct`,
        tier.gpPct,
        `Promote tier ${i + 1} GP share outside 0-100%.`,
      );
      flag(
        tier.hurdlePct != null && tier.hurdlePct < 0,
        `waterfall.tiers[${i}].hurdlePct`,
        tier.hurdlePct ?? 0,
        `Promote tier ${i + 1} hurdle is negative.`,
      );
    });
  }

  return out;
}
