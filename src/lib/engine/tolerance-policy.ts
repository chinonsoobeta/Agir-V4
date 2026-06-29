// Central numeric tolerance policy for deterministic underwriting checks.
//
// Keep tolerances semantic instead of scattering raw epsilons: display
// provenance should tolerate half the displayed precision, cash-flow roll-ups
// should tolerate at least one dollar, and model identity checks should use a
// tight relative epsilon.

export const TOLERANCE_POLICY = {
  moneyAbsoluteDollars: 1,
  modelAbsolute: 1e-6,
  modelRelative: 1e-9,
  invariantAbsolute: 1e-2,
  invariantRelative: 1e-7,
  monotonicAbsolute: 1e-6,
  monotonicMoneyAbsolute: 1e-3,
  irrNpv: 1e-6,
  groupResolutionDecimals: 3,
  ltcPctPoints: 1,
  budgetStatedTotalRelative: 0.005,
} as const;

export function withinModelTolerance(actual: number, expected: number): boolean {
  return (
    Number.isFinite(actual) &&
    Number.isFinite(expected) &&
    Math.abs(actual - expected) <=
      Math.max(TOLERANCE_POLICY.modelAbsolute, Math.abs(expected) * TOLERANCE_POLICY.modelRelative)
  );
}

export function moneyRollupTolerance(annual: number): number {
  return Math.max(
    TOLERANCE_POLICY.moneyAbsoluteDollars,
    Math.abs(annual) * TOLERANCE_POLICY.modelAbsolute,
  );
}

export function provenanceTolerance(value: number, displayedTolerance: number): number {
  return Math.max(displayedTolerance, Math.abs(value) * TOLERANCE_POLICY.modelRelative);
}

export function roundForGrouping(value: number): number {
  const scale = 10 ** TOLERANCE_POLICY.groupResolutionDecimals;
  return Math.round(value * scale) / scale;
}
