// LP/GP distribution waterfall and promote (additive, off by default).
//
// This is a deterministic, European (whole-life, back-end) waterfall computed
// over the deal's levered equity cash flows. It splits those flows between a
// limited partner (LP) and a general partner (GP) through an ordered set of
// tiers:
//
//   1. Return of capital + preferred return  (paid pari-passu by capital share)
//   2. Optional GP catch-up
//   3. Residual carry split across one or two return hurdles, with a promote
//
// The math is pure and hand-computable. Each return hurdle is represented as an
// accreting balance: a party's contributed capital grown at the hurdle rate. A
// distribution retires the lowest outstanding balance first (return of capital +
// preferred), then flows into the carry tiers. Because every distribution and
// contribution moves all balances by the same dollar amount and only the
// accretion rate differs, the balances stay ordered (pref <= tier1 <= tier2),
// which makes the band a distribution falls into unambiguous.
//
// GUARANTEES
//  - With no promote configured the waterfall is inactive: the LP holds the
//    entire deal and LP returns are byte-identical to the deal-level levered
//    returns, with GP promote = 0. This preserves backward compatibility.
//  - No number is invented: every LP/GP figure is a pure function of the
//    approved equity split, preferred rate, promote tiers, and the engine's own
//    levered cash-flow vector.

import { xirr } from "./metrics";

export type PromoteTier = {
  // Upper return/IRR hurdle (annual %, compounded) bounding this carry tier. The
  // open (top) tier omits it. A finite hurdle means "split this way until the LP
  // has achieved hurdlePct, then move to the next tier".
  hurdlePct?: number | null;
  // GP's share of distributions inside this tier (the carried interest), 0..100.
  gpPct: number;
};

export type WaterfallConfig = {
  lpEquityPct: number; // LP share of contributed equity, 0..100
  gpEquityPct: number; // GP share of contributed equity, 0..100
  preferredReturnPct: number; // annual compounded preferred return hurdle
  gpCatchUpPct: number; // GP share during catch-up, 0..100 (0 = no catch-up)
  tiers: PromoteTier[]; // residual carry tiers above the preferred return
};

export type WaterfallEvent = { t: number; amount: number }; // amount<0 contribution, >0 distribution

export type PartyResult = {
  flows: WaterfallEvent[];
  contributed: number;
  distributed: number;
};

export type WaterfallResult = {
  active: boolean;
  lp: PartyResult;
  gp: PartyResult;
  // GP distributions in excess of a pari-passu split by equity ownership: the
  // carried interest ("the promote"). Zero when no promote is configured.
  gpPromote: number;
  // Preferred return dollars paid to the LP (excludes return of capital).
  lpPreferredPaid: number;
  formulaText: string;
};

const sumNeg = (events: WaterfallEvent[]) =>
  events.reduce((s, e) => s + (e.amount < 0 ? -e.amount : 0), 0);
const sumPos = (events: WaterfallEvent[]) =>
  events.reduce((s, e) => s + (e.amount > 0 ? e.amount : 0), 0);
const clampPct = (n: number) => Math.min(100, Math.max(0, Number.isFinite(n) ? n : 0));

// A promote is configured when any carry tier hands the GP a positive share or a
// positive preferred return is set. With neither, the LP holds the whole deal
// and the split (even a GP co-invest) just scales pari-passu, so LP returns equal
// the deal returns and there is nothing to promote.
export function isWaterfallActive(cfg: WaterfallConfig): boolean {
  const hasPromote = cfg.tiers.some((t) => clampPct(t.gpPct) > 0);
  return hasPromote || cfg.preferredReturnPct > 0;
}

// Equity multiple: a timing-free money multiple. Zero when no capital was
// contributed (a multiple on a zero basis is not defined).
export function equityMultiple(contributed: number, distributed: number): number {
  return contributed > 0 ? Math.max(0, distributed / contributed) : 0;
}

type Stop = { rate: number | null; balance: number; lp: number; gp: number };

export function runWaterfall(events: WaterfallEvent[], cfg: WaterfallConfig): WaterfallResult {
  const sumShare = cfg.lpEquityPct + cfg.gpEquityPct;
  const sLP = sumShare > 0 ? cfg.lpEquityPct / sumShare : 1;
  const sGP = sumShare > 0 ? cfg.gpEquityPct / sumShare : 0;
  const sorted = [...events].sort((a, b) => a.t - b.t);

  if (!isWaterfallActive(cfg)) {
    // Inactive: the LP holds the entire deal. Returning the events verbatim
    // guarantees LP returns are byte-identical to the deal-level returns.
    return {
      active: false,
      lp: {
        flows: sorted.map((e) => ({ ...e })),
        contributed: sumNeg(sorted),
        distributed: sumPos(sorted),
      },
      gp: { flows: [], contributed: 0, distributed: 0 },
      gpPromote: 0,
      lpPreferredPaid: 0,
      formulaText:
        "No promote configured: the LP holds the entire deal; LP returns equal the deal-level levered returns and the GP promote is zero.",
    };
  }

  const prefRate = Math.max(0, cfg.preferredReturnPct) / 100;
  const cpct = clampPct(cfg.gpCatchUpPct) / 100;

  // Normalize carry tiers; ensure a single open (top) tier closes the stack.
  const rawTiers = cfg.tiers.length ? cfg.tiers : [{ hurdlePct: null, gpPct: sGP * 100 }];
  const carryTiers = rawTiers
    .map((t) => ({
      rate: t.hurdlePct == null ? null : Math.max(0, t.hurdlePct) / 100,
      gp: clampPct(t.gpPct) / 100,
      lp: 1 - clampPct(t.gpPct) / 100,
    }))
    .sort((a, b) => (a.rate == null ? 1 : b.rate == null ? -1 : a.rate - b.rate));
  if (carryTiers.length === 0 || carryTiers[carryTiers.length - 1].rate != null) {
    const last = carryTiers[carryTiers.length - 1] ?? { lp: sLP, gp: sGP };
    carryTiers.push({ rate: null, lp: last.lp, gp: last.gp });
  }
  const firstCarryGp = carryTiers[0].gp;

  // Stop[0] is the preferred-return band (returns capital + pref, pari-passu).
  // The remaining stops are the carry bands in ascending hurdle order.
  const stops: Stop[] = [
    { rate: prefRate, balance: 0, lp: sLP, gp: sGP },
    ...carryTiers.map((t) => ({ rate: t.rate, balance: 0, lp: t.lp, gp: t.gp })),
  ];

  const lpFlows: WaterfallEvent[] = [];
  const gpFlows: WaterfallEvent[] = [];
  let lpDist = 0;
  let gpDist = 0;
  let lpCapital = 0;
  let lpTier0Receipts = 0; // LP receipts in the preferred band (capital + pref)
  let gpCatchUpReceipts = 0;
  let prevT = sorted.length ? sorted[0].t : 0;

  const pay = (amount: number, lpShare: number, gpShare: number) => {
    if (amount <= 0) return;
    const lpAmt = amount * lpShare;
    const gpAmt = amount * gpShare;
    if (lpAmt !== 0) lpFlows.push({ t: prevT, amount: lpAmt });
    if (gpAmt !== 0) gpFlows.push({ t: prevT, amount: gpAmt });
    lpDist += lpAmt;
    gpDist += gpAmt;
    // Every distributed dollar counts toward each return hurdle.
    for (const s of stops) s.balance -= amount;
  };

  for (const event of sorted) {
    const dt = event.t - prevT;
    if (dt > 0)
      for (const s of stops)
        if (s.rate != null && s.rate > 0) s.balance *= Math.pow(1 + s.rate, dt);
    prevT = event.t;

    if (event.amount < 0) {
      const c = -event.amount;
      for (const s of stops) s.balance += c; // contributed capital seeds every hurdle balance
      lpFlows.push({ t: event.t, amount: -c * sLP });
      gpFlows.push({ t: event.t, amount: -c * sGP });
      lpCapital += c * sLP;
      continue;
    }

    let remaining = event.amount;
    // 1. Preferred band: return of capital + preferred return, pari-passu.
    const pref = stops[0];
    if (pref.balance > 1e-6 && remaining > 1e-9) {
      const a = Math.min(remaining, pref.balance);
      lpTier0Receipts += a * sLP;
      pay(a, sLP, sGP);
      remaining -= a;
    }
    // 2. GP catch-up (optional): GP receives cpct of distributions until its
    // carry equals the first carry tier's share of the LP's preferred return.
    if (
      pref.balance <= 1e-6 &&
      cpct > 0 &&
      firstCarryGp > 0 &&
      firstCarryGp < 1 &&
      remaining > 1e-9
    ) {
      const lpPrefPaid = Math.max(0, lpTier0Receipts - lpCapital);
      const target = (firstCarryGp / (1 - firstCarryGp)) * lpPrefPaid;
      const need = target - gpCatchUpReceipts;
      if (need > 1e-6) {
        const bandSize = need / cpct;
        const a = Math.min(remaining, bandSize);
        gpCatchUpReceipts += a * cpct;
        pay(a, 1 - cpct, cpct);
        remaining -= a;
      }
    }
    // 3. Carry tiers: each finite-hurdle tier is bounded by its accreting
    // balance; the open top tier consumes the remainder.
    for (let i = 1; i < stops.length && remaining > 1e-9; i++) {
      const s = stops[i];
      if (s.rate == null) {
        pay(remaining, s.lp, s.gp);
        remaining = 0;
      } else if (s.balance > 1e-6) {
        const a = Math.min(remaining, s.balance);
        pay(a, s.lp, s.gp);
        remaining -= a;
      }
    }
    // Numerical remainder (all finite balances retired but no open tier reached
    // due to rounding): hand it to the last tier's split.
    if (remaining > 1e-9) {
      const last = stops[stops.length - 1];
      pay(remaining, last.lp, last.gp);
    }
  }

  const lpContributed = sumNeg(lpFlows);
  const gpContributed = sumNeg(gpFlows);
  const totalDistributed = lpDist + gpDist;
  const gpPromote = Math.max(0, gpDist - sGP * totalDistributed);
  const lpPreferredPaid = Math.max(0, lpTier0Receipts - lpCapital);

  const tierText = carryTiers
    .map(
      (t) =>
        `${Math.round(t.lp * 100)}/${Math.round(t.gp * 100)} LP/GP${t.rate == null ? "" : ` to ${(t.rate * 100).toFixed(1)}%`}`,
    )
    .join(", then ");
  const formulaText =
    `European waterfall over levered equity (${(sLP * 100).toFixed(0)}/${(sGP * 100).toFixed(0)} LP/GP capital): ` +
    `return of capital + ${(prefRate * 100).toFixed(1)}% preferred${cpct > 0 ? `, ${(cpct * 100).toFixed(0)}% GP catch-up` : ""}, ` +
    `then carry ${tierText}. GP promote = GP distributions less a pari-passu split.`;

  return {
    active: true,
    lp: { flows: lpFlows, contributed: lpContributed, distributed: lpDist },
    gp: { flows: gpFlows, contributed: gpContributed, distributed: gpDist },
    gpPromote,
    lpPreferredPaid,
    formulaText,
  };
}
