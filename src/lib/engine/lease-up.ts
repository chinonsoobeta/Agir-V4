// Lease-up absorption curve (Workstream 1D, additive and OFF by default).
//
// The base engine is deliberately conservative: it books NO operating income
// during construction + lease-up and switches on the FULL stabilized cash flow
// only once the asset is stabilized. In reality an asset earns partial income
// WHILE it leases up. This module credits that partial income via a linear
// absorption ramp (0 -> stabilized across the lease-up window) and returns the
// IRR of the absorption-adjusted equity vector. It NEVER changes the base
// outputs: it is a separate, opt-in figure. Pure.

import { xirr } from "./metrics";

export type TimedFlow = { t: number; amount: number };

// Income earned during the lease-up window under a linear 0 -> stabilized ramp:
// the average annualized cash flow is half the stabilized level, applied over
// the lease-up duration in years. A non-positive stabilized cash flow or zero
// lease-up window contributes nothing.
export function leaseUpAbsorptionIncome(stabilizedLeveredCf: number, leaseUpMonths: number): number {
  const years = Math.max(0, leaseUpMonths) / 12;
  if (years <= 0 || stabilizedLeveredCf <= 0) return 0;
  return stabilizedLeveredCf * years * 0.5;
}

// IRR of the equity vector after crediting lease-up absorption income as a
// single flow at the midpoint of the lease-up window (which falls AFTER
// construction and BEFORE stabilized operations, so it never overlaps the
// stabilized distributions). With no lease-up window this equals the base IRR.
export function leaseUpAdjustedIrr(args: {
  equityContributions: TimedFlow[];
  distributionFlows: TimedFlow[];
  stabilizedLeveredCf: number;
  constructionMonths: number;
  leaseUpMonths: number;
}): number {
  const { equityContributions, distributionFlows, stabilizedLeveredCf, constructionMonths, leaseUpMonths } = args;
  const income = leaseUpAbsorptionIncome(stabilizedLeveredCf, leaseUpMonths);
  if (income <= 0) return xirr([...equityContributions, ...distributionFlows]);
  const midLeaseUp = constructionMonths / 12 + leaseUpMonths / 12 / 2;
  return xirr([...equityContributions, { t: midLeaseUp, amount: income }, ...distributionFlows]);
}
