// Standard mortgage math. Debt service follows the extracted terms:
// amortizing payment when amortYears is set, interest-only during ioMonths.

export function annualDebtService(loanAmount: number, annualRatePct: number, amortYears: number) {
  if (loanAmount <= 0) return 0;
  const rate = annualRatePct / 100;
  if (rate <= 0) return amortYears > 0 ? loanAmount / amortYears : 0;
  const months = Math.max(1, Math.round(amortYears * 12));
  const monthlyRate = rate / 12;
  const payment = loanAmount * (monthlyRate / (1 - Math.pow(1 + monthlyRate, -months)));
  return payment * 12;
}

export function interestOnlyDebtService(loanAmount: number, annualRatePct: number) {
  return loanAmount * (annualRatePct / 100);
}

// Outstanding balance after `elapsedMonths`, honoring an initial interest-only
// period. During IO months the balance is unchanged; afterwards it follows the
// standard amortization schedule over amortYears. The monthly primitive used by
// both the annual payoff (loanBalanceAfterYears) and the monthly spine
// (schedule.ts), so the two can never drift apart.
export function loanBalanceAfterMonths(
  loanAmount: number,
  annualRatePct: number,
  amortYears: number,
  ioMonths: number,
  elapsedMonths: number,
) {
  if (loanAmount <= 0) return 0;
  const months = Math.max(0, Math.round(elapsedMonths));
  const amortizingMonths = Math.max(0, months - Math.max(0, Math.round(ioMonths)));
  if (amortizingMonths === 0 || amortYears <= 0) return loanAmount;
  const rate = annualRatePct / 100;
  if (rate <= 0) {
    const principalPerMonth = loanAmount / (amortYears * 12);
    return Math.max(0, loanAmount - principalPerMonth * amortizingMonths);
  }
  const monthlyRate = rate / 12;
  const totalMonths = Math.max(1, Math.round(amortYears * 12));
  const payment = loanAmount * (monthlyRate / (1 - Math.pow(1 + monthlyRate, -totalMonths)));
  const n = Math.min(amortizingMonths, totalMonths);
  const growth = Math.pow(1 + monthlyRate, n);
  return Math.max(0, loanAmount * growth - payment * ((growth - 1) / monthlyRate));
}

// Outstanding balance after `years` (delegates to the monthly primitive so the
// annual and monthly paths share one amortization formula). Byte-identical to
// the prior standalone implementation.
export function loanBalanceAfterYears(
  loanAmount: number,
  annualRatePct: number,
  amortYears: number,
  ioMonths: number,
  years: number,
) {
  return loanBalanceAfterMonths(
    loanAmount,
    annualRatePct,
    amortYears,
    ioMonths,
    Math.round(years * 12),
  );
}

// Year-end balance schedule from year 1 through `holdYears` (for payoff at exit
// and provenance drill-down).
export function loanBalanceSchedule(
  loanAmount: number,
  annualRatePct: number,
  amortYears: number,
  ioMonths: number,
  holdYears: number,
) {
  const years = Math.max(1, Math.round(holdYears));
  return Array.from({ length: years }, (_, i) =>
    loanBalanceAfterYears(loanAmount, annualRatePct, amortYears, ioMonths, i + 1),
  );
}
