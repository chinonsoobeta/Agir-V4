// Stress scenarios are engine re-runs: runUnderwriting(baseInput + overrides).
// Every stress cell is a real number from a real run -- nothing is synthesized.

import type { UnderwritingInput } from "./types";

export type StressPreset = {
  key: string;
  label: string;
  revenueDeltaPct?: number;
  costDeltaPct?: number;
  capRateDeltaBps?: number;
  rateDeltaBps?: number;
  // Occupancy slippage (percentage POINTS, applied to every component) and
  // operating-expense-ratio inflation (percentage POINTS): the two shocks that
  // most often sink a lease-up-heavy development and that a rent-only revenue
  // haircut cannot express.
  occupancyDeltaPts?: number;
  expenseRatioDeltaPts?: number;
};

export const STRESS_PRESETS: StressPreset[] = [
  { key: "cap_expansion", label: "Cap Expansion (+75 bps)", capRateDeltaBps: 75 },
  { key: "cost_overrun", label: "Cost Overrun (+10%)", costDeltaPct: 10 },
  { key: "rate_shock", label: "Rate Shock (+150 bps)", rateDeltaBps: 150 },
  { key: "revenue_down", label: "Revenue Downside (-10%)", revenueDeltaPct: -10 },
  { key: "occupancy_down", label: "Occupancy Downside (-500 bps)", occupancyDeltaPts: -5 },
  {
    key: "expense_inflation",
    label: "Expense Inflation (+500 bps ratio)",
    expenseRatioDeltaPts: 5,
  },
  {
    // The true downside: every shock at once, including the occupancy and
    // expense slippage that the verdict's stress gate reads from this preset.
    key: "combined",
    label: "Combined Stress",
    capRateDeltaBps: 75,
    costDeltaPct: 10,
    rateDeltaBps: 150,
    revenueDeltaPct: -10,
    occupancyDeltaPts: -5,
    expenseRatioDeltaPts: 5,
  },
];

export function applyStress(input: UnderwritingInput, preset: StressPreset): UnderwritingInput {
  const revenueMultiplier = 1 + (preset.revenueDeltaPct ?? 0) / 100;
  const costMultiplier = 1 + (preset.costDeltaPct ?? 0) / 100;
  const occupancyDeltaPts = preset.occupancyDeltaPts ?? 0;
  const expenseRatioDeltaPts = preset.expenseRatioDeltaPts ?? 0;
  const rateDeltaPts = (preset.rateDeltaBps ?? 0) / 100;
  return {
    ...input,
    budget: {
      ...input.budget,
      land: input.budget.land * costMultiplier,
      hard: input.budget.hard * costMultiplier,
      soft: input.budget.soft * costMultiplier,
      contingency: input.budget.contingency * costMultiplier,
      financingInterest:
        input.budget.financingInterest == null
          ? undefined
          : input.budget.financingInterest * costMultiplier,
      other: input.budget.other == null ? undefined : input.budget.other * costMultiplier,
    },
    revenueProgram: input.revenueProgram.map((row) => ({
      ...row,
      rent: row.rent * revenueMultiplier,
      occupancyPct:
        row.occupancyPct == null
          ? row.occupancyPct
          : Math.max(0, row.occupancyPct + occupancyDeltaPts),
    })),
    otherIncomeAnnual: input.otherIncomeAnnual * revenueMultiplier,
    stabilizedOccupancyPct: Math.max(0, input.stabilizedOccupancyPct + occupancyDeltaPts),
    expenseRatioPct: Math.max(0, input.expenseRatioPct + expenseRatioDeltaPts),
    exitCapRatePct: input.exitCapRatePct + (preset.capRateDeltaBps ?? 0) / 100,
    // A rate shock hits the whole debt stack, not just the senior: mezzanine
    // and refinance coupons reprice too, otherwise stressed all-in DSCR (and
    // the verdict's combined-stress gate) is understated on every mezz/refi deal.
    interestRatePct: input.interestRatePct + rateDeltaPts,
    mezzanine:
      input.mezzanine == null
        ? input.mezzanine
        : { ...input.mezzanine, ratePct: input.mezzanine.ratePct + rateDeltaPts },
    refinance:
      input.refinance == null
        ? input.refinance
        : { ...input.refinance, ratePct: input.refinance.ratePct + rateDeltaPts },
  };
}
