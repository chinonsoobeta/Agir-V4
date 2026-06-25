// Equity draw timing (additive, off by default).
//
// Today every dollar of equity is committed in a single outflow at t=0. That is
// the CONSERVATIVE convention: committing capital at the earliest possible date
// maximizes the time it is exposed and therefore produces the LOWEST levered
// IRR. A real construction deal draws equity over the build period, which defers
// part of the outflow and raises IRR.
//
// This module turns a single committed-equity figure into a TIMED contribution
// vector. With no draw schedule it returns the single t=0 lump sum, so a deal
// with none of the new inputs is byte-identical to today. When an analyst
// supplies a positive draw period the equity is contributed straight-line at the
// start of each month across that period.
//
// The equity MULTIPLE is a money multiple and stays intentionally timing-free;
// only the IRR vector (and the waterfall, which shares this vector) is affected.

export type EquityContribution = { t: number; amount: number };

export type EquityDrawConvention = "upfront" | "straight_line";

// Build the timed equity contribution vector. `amount` is NEGATIVE (an outflow)
// so it can be concatenated directly into an IRR cash-flow vector.
//
// drawMonths <= 0 (the default) => a single lump sum at t=0 (today's behavior).
// drawMonths > 0 => `drawMonths` equal monthly contributions, the first at t=0
// and the last at (drawMonths-1)/12 years.
export function buildEquityContributions(equity: number, drawMonths: number): EquityContribution[] {
  const total = Number.isFinite(equity) ? equity : 0;
  const months = Math.max(0, Math.round(drawMonths));
  if (total <= 0 || months <= 1) {
    return [{ t: 0, amount: -total }];
  }
  const perMonth = total / months;
  return Array.from({ length: months }, (_, m) => ({ t: m / 12, amount: -perMonth }));
}

// Human-readable description of the draw convention for formula_text.
export function equityDrawConventionText(drawMonths: number): string {
  const months = Math.max(0, Math.round(drawMonths));
  return months > 1
    ? `equity drawn straight-line over ${months} months (first draw at t=0)`
    : "equity committed as a single outflow at t=0 (conservative default)";
}
