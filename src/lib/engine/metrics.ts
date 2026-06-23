export function irr(cashFlows: number[]) {
  if (cashFlows.length < 2) return Number.NaN;
  const hasPositive = cashFlows.some((v) => v > 0);
  const hasNegative = cashFlows.some((v) => v < 0);
  if (!hasPositive || !hasNegative) return Number.NaN;

  const npv = (rate: number) => cashFlows.reduce((sum, cf, i) => sum + cf / Math.pow(1 + rate, i), 0);
  const derivative = (rate: number) =>
    cashFlows.reduce((sum, cf, i) => (i === 0 ? sum : sum - (i * cf) / Math.pow(1 + rate, i + 1)), 0);

  let guess = 0.12;
  for (let i = 0; i < 50; i++) {
    const value = npv(guess);
    const slope = derivative(guess);
    if (!Number.isFinite(value) || !Number.isFinite(slope) || Math.abs(slope) < 1e-10) break;
    const next = guess - value / slope;
    if (next <= -0.999 || !Number.isFinite(next)) break;
    if (Math.abs(next - guess) < 1e-8) return next * 100;
    guess = next;
  }

  let low = -0.99;
  let high = 10;
  let fLow = npv(low);
  let fHigh = npv(high);
  while (Math.sign(fLow) === Math.sign(fHigh) && high < 1_000_000) {
    high *= 2;
    fHigh = npv(high);
  }
  if (Math.sign(fLow) === Math.sign(fHigh)) {
    // No sign change was bracketed. The only root may sit at the -99% lower
    // bound (a near-total loss that recovers a sliver of equity): return it
    // when NPV there is ~0. Otherwise the flows truly have no finite IRR
    // (e.g. a loss exceeding 100%).
    return Math.abs(fLow) < 1e-6 ? low * 100 : Number.NaN;
  }

  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-6) return mid * 100;
    if (Math.sign(fMid) === Math.sign(fLow)) {
      low = mid;
      fLow = fMid;
    } else {
      high = mid;
    }
  }
  return ((low + high) / 2) * 100;
}

export function pct(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : (numerator / denominator) * 100;
}

