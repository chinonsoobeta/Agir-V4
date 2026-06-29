export type Cents = number & { readonly __brand: "Cents" };

export function toCents(value: number): Cents {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0 as Cents;
  return Math.round(n * 100) as Cents;
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

export function roundMoney(value: number): number {
  return fromCents(toCents(value));
}

export function splitCents(totalCents: number, shares: number[]): number[] {
  const total = Math.round(totalCents);
  if (!shares.length || total === 0) return shares.map(() => 0);
  const raw = shares.map((share) => total * share);
  const floors = raw.map((value) => Math.trunc(value));
  let remainder = total - floors.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, frac: Math.abs(value - Math.trunc(value)) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (const { index } of order) {
    if (remainder === 0) break;
    floors[index] += remainder > 0 ? 1 : -1;
    remainder += remainder > 0 ? -1 : 1;
  }
  return floors;
}

export function splitMoney(amount: number, shares: number[]): number[] {
  return splitCents(toCents(amount), shares).map(fromCents);
}

export function compoundMoney(amount: number, rate: number, periods: number): number {
  return roundMoney(amount * Math.pow(1 + rate, periods));
}
