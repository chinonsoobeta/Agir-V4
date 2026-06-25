// Multi-tranche debt (additive, off by default).
//
// The engine has always modeled a single senior loan. This module generalizes
// the capital stack to an ordered list of debt tranches (senior first, then
// mezzanine, then any further tranches) while guaranteeing that a deal with only
// a senior loan produces exactly today's numbers.
//
// Every tranche is priced with the SAME standard mortgage math already used for
// the senior loan (debt.ts), so adding a mezzanine tranche cannot change how the
// senior loan amortizes. Aggregations (total debt, annual debt service, loan
// payoff at exit, interest carry) are simple sums over the tranches.

import { annualDebtService, interestOnlyDebtService, loanBalanceAfterYears } from "./debt";

export type DebtTranche = {
  // Stable identifier ("senior", "mezzanine", ...). Used in formula_text only.
  key: string;
  label: string;
  amount: number;
  ratePct: number;
  amortYears: number;
  ioMonths: number;
};

export type DebtStack = {
  tranches: DebtTranche[];
  totalDebt: number;
  // Senior-only figures (the headline coverage reference, unchanged from today).
  seniorAmount: number;
  seniorAnnualDebtService: number;
  seniorInterestOnlyDebtService: number;
  // All-in figures across every tranche.
  annualDebtService: number;
  interestOnlyDebtService: number;
};

// The senior loan is always tranche 0. Subordinate tranches (mezzanine, etc.)
// are appended only when present, so `tranches` has length 1 for a senior-only
// deal and the aggregations below collapse to the senior numbers.
// Headline annual debt service for a tranche: the amortizing payment when an
// amortization term exists, otherwise interest-only. Mirrors the senior loan's
// existing convention so a senior-only stack reproduces today's numbers exactly.
function trancheAnnualDebtService(t: DebtTranche): number {
  return t.amortYears > 0
    ? annualDebtService(t.amount, t.ratePct, t.amortYears)
    : interestOnlyDebtService(t.amount, t.ratePct);
}

export function buildDebtStack(senior: DebtTranche, subordinate: DebtTranche[]): DebtStack {
  const tranches = [senior, ...subordinate.filter((t) => t.amount > 0)];
  const seniorAds = trancheAnnualDebtService(senior);
  const seniorIo = interestOnlyDebtService(senior.amount, senior.ratePct);
  const annualDs = tranches.reduce((sum, t) => sum + trancheAnnualDebtService(t), 0);
  const ioDs = tranches.reduce((sum, t) => sum + interestOnlyDebtService(t.amount, t.ratePct), 0);
  return {
    tranches,
    totalDebt: tranches.reduce((sum, t) => sum + t.amount, 0),
    seniorAmount: senior.amount,
    seniorAnnualDebtService: seniorAds,
    seniorInterestOnlyDebtService: seniorIo,
    annualDebtService: annualDs,
    interestOnlyDebtService: ioDs,
  };
}

// Debt service actually DUE in hold-year `year` (1-indexed) for one tranche:
// interest-only during its IO period, the amortizing payment afterwards, blended
// across the year that straddles conversion. Mirrors proforma's senior logic so
// every tranche is treated identically.
export function trancheDebtServiceForYear(t: DebtTranche, year: number): number {
  if (t.amount <= 0) return 0;
  const io = interestOnlyDebtService(t.amount, t.ratePct);
  if (t.amortYears <= 0) return io;
  const amort = annualDebtService(t.amount, t.ratePct, t.amortYears);
  const monthlyIo = io / 12;
  const monthlyAmort = amort / 12;
  const ioMonthsInYear = Math.min(12, Math.max(0, t.ioMonths - (year - 1) * 12));
  return ioMonthsInYear * monthlyIo + (12 - ioMonthsInYear) * monthlyAmort;
}

// Total debt service due across all tranches in hold-year `year`.
export function stackDebtServiceForYear(stack: DebtStack, year: number): number {
  return stack.tranches.reduce((sum, t) => sum + trancheDebtServiceForYear(t, year), 0);
}

// Total outstanding balance across all tranches after `years` (the payoff at
// exit). Each tranche honors its own IO period and amortization term.
export function stackPayoffAfterYears(stack: DebtStack, years: number): number {
  return stack.tranches.reduce(
    (sum, t) => sum + loanBalanceAfterYears(t.amount, t.ratePct, t.amortYears, t.ioMonths, years),
    0,
  );
}

// Interest carried during the construction + lease-up window, summed across
// tranches. Used only when the financing line is computed rather than pinned to
// an extracted figure, so a senior-only deal keeps its existing interest reserve.
export function stackInterestCarry(stack: DebtStack, monthsOutstanding: number, avgOutstandingFactor: number): number {
  const years = monthsOutstanding / 12;
  return stack.tranches.reduce((sum, t) => sum + t.amount * (t.ratePct / 100) * years * avgOutstandingFactor, 0);
}
