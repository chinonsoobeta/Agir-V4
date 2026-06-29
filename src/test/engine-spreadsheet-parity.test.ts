// External spreadsheet parity pack: 25 hand-modeled deals whose every headline
// "cell" is recomputed by an INDEPENDENT reference (a second implementation of
// the closed-form underwriting arithmetic a human would put in a spreadsheet)
// and reconciled against runUnderwriting. Differential testing: a future engine
// refactor that silently changes a formula breaks parity even if the golden
// snapshot were re-baselined, and a typo in either side fails to agree.
//
// Scope: stabilized, senior-only deals with an explicit financing-interest line
// (so the interest reserve is deterministic) and the stabilized "year-0" cells
// that are growth/timing-independent. IRR / equity multiple (timing-dependent)
// are covered by the golden snapshots and the property-based invariants.

import { describe, expect, test } from "vitest";
import { runUnderwriting, type RevenueUnitInput, type UnderwritingInput } from "@/lib/engine";

// ---- Independent reference (mirrors the documented closed-form arithmetic) ----

const round2 = (n: number) => Math.round(n * 100) / 100;
const pctOf = (part: number, whole: number) => (whole !== 0 ? (part / whole) * 100 : 0);
const gprOf = (r: RevenueUnitInput) =>
  r.rentBasis === "per_sf" ? r.unitCount * (r.avgSf ?? 0) * r.rent : r.unitCount * r.rent * 12;

// Amortizing annual debt service, with the same cents rounding as engine/debt.ts
// (fromCents(toCents(payment) * 12)), reimplemented independently.
function refAnnualDebtService(loan: number, ratePct: number, amortYears: number): number {
  if (loan <= 0) return 0;
  const rate = ratePct / 100;
  if (rate <= 0) return amortYears > 0 ? round2(loan / amortYears) : 0;
  const months = Math.max(1, Math.round(amortYears * 12));
  const mr = rate / 12;
  const payment = loan * (mr / (1 - Math.pow(1 + mr, -months)));
  return (Math.round(payment * 100) * 12) / 100;
}

function referenceCells(d: UnderwritingInput) {
  const tdcPre =
    d.budget.land + d.budget.hard + d.budget.soft + d.budget.contingency + (d.budget.other ?? 0);
  const tdc = tdcPre + (d.budget.financingInterest ?? 0);
  const gpr = d.revenueProgram.reduce((s, r) => s + gprOf(r), 0);
  const rentEgi = d.revenueProgram.reduce(
    (s, r) => s + gprOf(r) * ((r.occupancyPct ?? d.stabilizedOccupancyPct) / 100),
    0,
  );
  const egi = rentEgi + d.otherIncomeAnnual;
  const opex = egi * (d.expenseRatioPct / 100);
  const noi = egi - opex;
  const exitValue = d.exitCapRatePct > 0 ? noi / (d.exitCapRatePct / 100) : 0;
  const netSale = exitValue * (1 - d.sellingCostsPct / 100);
  const totalDebt = d.loanAmount;
  const dwellingUnits = d.revenueProgram.reduce(
    (s, r) => s + (r.rentBasis === "per_unit" ? r.unitCount : 0),
    0,
  );
  const ads = refAnnualDebtService(d.loanAmount, d.interestRatePct, d.amortYears);
  return {
    tdc,
    gpr,
    egi,
    opex,
    noi,
    exitValue,
    netSaleBeforeDebt: netSale,
    developmentProfit: exitValue - tdc,
    profitOnCostPct: pctOf(exitValue - tdc, tdc),
    yieldOnCostPct: pctOf(noi, tdc),
    requiredEquity: tdc - totalDebt,
    ltcPct: pctOf(totalDebt, tdc),
    debtYieldPct: d.loanAmount > 0 ? pctOf(noi, d.loanAmount) : 0,
    costPerUnit: dwellingUnits ? tdc / dwellingUnits : 0,
    effectiveOccupancyPct: gpr > 0 ? (rentEgi / gpr) * 100 : 0,
    annualDebtService: ads,
    dscr: ads > 0 ? noi / ads : 0,
  };
}

// ---- 25 deterministic hand-modeled deals spanning the input space ----

const REVENUE_SHAPES: RevenueUnitInput[][] = [
  [{ unitType: "Residential", unitCount: 120, rent: 2_800, rentBasis: "per_unit" }],
  [
    {
      unitType: "Residential",
      unitCount: 200,
      rent: 3_100,
      rentBasis: "per_unit",
      occupancyPct: 93,
    },
    {
      unitType: "Retail",
      unitCount: 1,
      avgSf: 14_000,
      rent: 42,
      rentBasis: "per_sf",
      occupancyPct: 88,
    },
  ],
  [
    { unitType: "Residential", unitCount: 80, rent: 2_400, rentBasis: "per_unit" },
    {
      unitType: "Office",
      unitCount: 1,
      avgSf: 90_000,
      rent: 36,
      rentBasis: "per_sf",
      occupancyPct: 90,
    },
    { unitType: "Retail", unitCount: 1, avgSf: 9_000, rent: 50, rentBasis: "per_sf" },
  ],
  [{ unitType: "Office", unitCount: 1, avgSf: 220_000, rent: 41, rentBasis: "per_sf" }],
];

function dealForIndex(i: number): UnderwritingInput {
  const scale = 1 + (i % 5) * 0.4; // 1.0 .. 2.6
  return {
    budget: {
      land: Math.round(7_000_000 * scale),
      hard: Math.round(48_000_000 * scale),
      soft: Math.round(7_500_000 * scale),
      contingency: Math.round(2_000_000 * scale),
      financingInterest: Math.round(2_500_000 * scale),
    },
    revenueProgram: REVENUE_SHAPES[i % REVENUE_SHAPES.length],
    constructionMonths: 12 + (i % 4) * 6,
    leaseUpMonths: 6 + (i % 3) * 6,
    stabilizedOccupancyPct: 90 + (i % 6), // 90..95
    expenseRatioPct: 30 + (i % 5) * 3, // 30..42
    otherIncomeAnnual: (i % 3) * 150_000,
    exitCapRatePct: 4.5 + (i % 7) * 0.25, // 4.5..6.0
    loanAmount: Math.round(40_000_000 * scale),
    interestRatePct: 5 + (i % 5) * 0.5, // 5..7
    amortYears: 25 + (i % 3) * 5, // 25/30/35
    ioMonths: (i % 3) * 12,
    avgOutstandingFactor: 0.55,
    sellingCostsPct: 1 + (i % 4) * 0.5, // 1..2.5
    holdYears: 5 + (i % 4), // 5..8 (does not affect the stabilized cells)
    equityAmount: null,
    rentGrowthPct: i % 4, // exercised but does not affect stabilized cells
    expenseGrowthPct: i % 3,
  };
}

const DEALS = Array.from({ length: 25 }, (_, i) => dealForIndex(i));

const CELLS = [
  "tdc",
  "gpr",
  "egi",
  "opex",
  "noi",
  "exitValue",
  "netSaleBeforeDebt",
  "developmentProfit",
  "profitOnCostPct",
  "yieldOnCostPct",
  "requiredEquity",
  "ltcPct",
  "debtYieldPct",
  "costPerUnit",
  "effectiveOccupancyPct",
  "annualDebtService",
  "dscr",
] as const;

// Identities are exact arithmetic on both sides, so they agree to machine
// precision; the slack only absorbs float reassociation noise and is far tighter
// than any formula bug (which would be off by dollars/percent, not a hundredth).
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-4, Math.abs(b) * 1e-7);

describe("spreadsheet parity pack (25 deals, cell-by-cell vs an independent model)", () => {
  test.each(DEALS.map((deal, i) => [i, deal] as const))(
    "deal %i reconciles every cell",
    (_i, deal) => {
      const v = runUnderwriting(deal).values as Record<string, number>;
      const ref = referenceCells(deal) as Record<string, number>;
      for (const cell of CELLS) {
        expect(close(v[cell], ref[cell]), `${cell}: engine=${v[cell]} reference=${ref[cell]}`).toBe(
          true,
        );
      }
    },
  );
});
