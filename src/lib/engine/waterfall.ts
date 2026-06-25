import { xirr } from "./metrics";
import type { PromoteTierInput, WaterfallInput } from "./types";

export type TimedCashFlow = { t: number; amount: number };

export type WaterfallResult = {
  lpCashFlows: TimedCashFlow[];
  gpCashFlows: TimedCashFlow[];
  lpIrrPct: number;
  lpEquityMultiple: number;
  gpIrrPct: number;
  gpEquityMultiple: number;
  gpPromote: number;
  enabled: boolean;
};

const EPSILON = 0.000001;

function addFlow(flows: TimedCashFlow[], t: number, amount: number) {
  if (Math.abs(amount) <= EPSILON) return;
  const existing = flows.find((flow) => Math.abs(flow.t - t) <= EPSILON);
  if (existing) existing.amount += amount;
  else flows.push({ t, amount });
}

function positiveDistributions(flows: TimedCashFlow[]) {
  return flows.reduce((sum, flow) => sum + Math.max(0, flow.amount), 0);
}

function contributedCapital(flows: TimedCashFlow[]) {
  return flows.reduce((sum, flow) => sum + Math.max(0, -flow.amount), 0);
}

function multiple(flows: TimedCashFlow[]) {
  const contributions = contributedCapital(flows);
  return contributions > 0 ? positiveDistributions(flows) / contributions : 0;
}

function sortedTiers(tiers: PromoteTierInput[]) {
  return [...tiers]
    .filter(
      (tier) =>
        Number.isFinite(tier.hurdleRatePct) &&
        tier.hurdleRatePct >= 0 &&
        Number.isFinite(tier.gpSplitPct) &&
        tier.gpSplitPct >= 0 &&
        tier.gpSplitPct <= 100,
    )
    .sort((a, b) => a.hurdleRatePct - b.hurdleRatePct)
    .slice(0, 2);
}

function amountToReachIrr(flows: TimedCashFlow[], t: number, targetPct: number) {
  if (!flows.some((flow) => flow.amount < 0)) return 0;
  if (xirr(flows) >= targetPct) return 0;
  let low = 0;
  let high = Math.max(1, contributedCapital(flows));
  const irrWith = (amount: number) => xirr([...flows, { t, amount }]);
  while ((!Number.isFinite(irrWith(high)) || irrWith(high) < targetPct) && high < 1e15) high *= 2;
  if (high >= 1e15 && (!Number.isFinite(irrWith(high)) || irrWith(high) < targetPct)) {
    return Number.POSITIVE_INFINITY;
  }
  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2;
    const value = irrWith(mid);
    if (!Number.isFinite(value) || value < targetPct) low = mid;
    else high = mid;
  }
  return high;
}

function allocateBySplit(
  amount: number,
  gpSplitPct: number,
  t: number,
  lpFlows: TimedCashFlow[],
  gpFlows: TimedCashFlow[],
) {
  const gp = amount * (gpSplitPct / 100);
  const lp = amount - gp;
  addFlow(lpFlows, t, lp);
  addFlow(gpFlows, t, gp);
  return { lp, gp };
}

function accruePreferredReturn(
  outstandingLpCapital: number,
  accruedPref: number,
  ratePct: number,
  elapsedYears: number,
) {
  if (elapsedYears <= 0 || ratePct <= 0 || outstandingLpCapital <= 0) return accruedPref;
  return (
    (outstandingLpCapital + accruedPref) * Math.pow(1 + ratePct / 100, elapsedYears) -
    outstandingLpCapital
  );
}

export function runEuropeanWaterfall(
  dealCashFlows: TimedCashFlow[],
  waterfall: WaterfallInput | null | undefined,
): WaterfallResult {
  const ordered = [...dealCashFlows].sort((a, b) => a.t - b.t);
  const enabled = Boolean(
    waterfall &&
    waterfall.lpEquityPct > 0 &&
    waterfall.lpEquityPct < 100 &&
    (waterfall.preferredReturnPct > 0 || waterfall.promoteTiers.length > 0),
  );

  if (!enabled || !waterfall) {
    const dealIrr = xirr(ordered);
    return {
      lpCashFlows: ordered,
      gpCashFlows: [],
      lpIrrPct: dealIrr,
      lpEquityMultiple: multiple(ordered),
      gpIrrPct: Number.NaN,
      gpEquityMultiple: 0,
      gpPromote: 0,
      enabled: false,
    };
  }

  const lpPct = waterfall.lpEquityPct / 100;
  const gpPct = 1 - lpPct;
  const tiers = sortedTiers(waterfall.promoteTiers);
  const firstPromoteSplit = tiers[0]?.gpSplitPct ?? gpPct * 100;
  const lpFlows: TimedCashFlow[] = [];
  const gpFlows: TimedCashFlow[] = [];
  let outstandingLpCapital = 0;
  let outstandingGpCapital = 0;
  let accruedPref = 0;
  let lastTime = ordered[0]?.t ?? 0;
  let distributedProfit = 0;
  let gpProfit = 0;

  for (const flow of ordered) {
    const elapsed = Math.max(0, flow.t - lastTime);
    accruedPref = accruePreferredReturn(
      outstandingLpCapital,
      accruedPref,
      waterfall.preferredReturnPct,
      elapsed,
    );
    lastTime = flow.t;

    if (flow.amount < 0) {
      const contribution = -flow.amount;
      const lpContribution = contribution * lpPct;
      const gpContribution = contribution - lpContribution;
      outstandingLpCapital += lpContribution;
      outstandingGpCapital += gpContribution;
      addFlow(lpFlows, flow.t, -lpContribution);
      addFlow(gpFlows, flow.t, -gpContribution);
      continue;
    }

    let remaining = flow.amount;
    if (remaining <= EPSILON) continue;

    const totalOutstanding = outstandingLpCapital + outstandingGpCapital;
    if (totalOutstanding > EPSILON) {
      const capitalReturn = Math.min(remaining, totalOutstanding);
      const lpReturn = capitalReturn * (outstandingLpCapital / totalOutstanding);
      const gpReturn = capitalReturn - lpReturn;
      addFlow(lpFlows, flow.t, lpReturn);
      addFlow(gpFlows, flow.t, gpReturn);
      outstandingLpCapital -= lpReturn;
      outstandingGpCapital -= gpReturn;
      remaining -= capitalReturn;
    }

    if (remaining > EPSILON && accruedPref > EPSILON) {
      const prefPayment = Math.min(remaining, accruedPref);
      addFlow(lpFlows, flow.t, prefPayment);
      accruedPref -= prefPayment;
      distributedProfit += prefPayment;
      remaining -= prefPayment;
    }

    if (remaining > EPSILON && waterfall.gpCatchUp && firstPromoteSplit > 0) {
      const targetGpShare = firstPromoteSplit / 100;
      const catchUpNeeded =
        targetGpShare >= 1
          ? remaining
          : Math.max(0, (targetGpShare * distributedProfit - gpProfit) / (1 - targetGpShare));
      const catchUp = Math.min(remaining, catchUpNeeded);
      addFlow(gpFlows, flow.t, catchUp);
      gpProfit += catchUp;
      distributedProfit += catchUp;
      remaining -= catchUp;
    }

    for (let tierIndex = 0; remaining > EPSILON; tierIndex++) {
      const tier = tiers[Math.min(tierIndex, Math.max(0, tiers.length - 1))];
      const gpSplitPct = tier?.gpSplitPct ?? gpPct * 100;
      const nextTier = tiers[tierIndex + 1];
      if (!nextTier) {
        const allocated = allocateBySplit(remaining, gpSplitPct, flow.t, lpFlows, gpFlows);
        gpProfit += allocated.gp;
        distributedProfit += remaining;
        remaining = 0;
        break;
      }

      const lpNeeded = amountToReachIrr(lpFlows, flow.t, nextTier.hurdleRatePct);
      const lpShare = 1 - gpSplitPct / 100;
      const tierCapacity = lpShare > 0 ? lpNeeded / lpShare : 0;
      const tierAmount = Math.min(remaining, tierCapacity);
      const allocated = allocateBySplit(tierAmount, gpSplitPct, flow.t, lpFlows, gpFlows);
      gpProfit += allocated.gp;
      distributedProfit += tierAmount;
      remaining -= tierAmount;
      if (!Number.isFinite(tierCapacity) || tierAmount + EPSILON < tierCapacity) break;
    }
  }

  const totalDealProfit = positiveDistributions(ordered) - contributedCapital(ordered);
  const baseGpProfit = Math.max(0, totalDealProfit * gpPct);
  return {
    lpCashFlows: lpFlows,
    gpCashFlows: gpFlows,
    lpIrrPct: xirr(lpFlows),
    lpEquityMultiple: multiple(lpFlows),
    gpIrrPct: xirr(gpFlows),
    gpEquityMultiple: multiple(gpFlows),
    gpPromote: Math.max(0, gpProfit - baseGpProfit),
    enabled: true,
  };
}
