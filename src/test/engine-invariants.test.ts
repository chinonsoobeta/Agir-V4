// Tier 1 hardening: property-based engine invariants + a cross-model
// (monthly vs annual) consistency matrix.
//
// The engine is pure and deterministic, so it is ideal for property testing:
// instead of a handful of fixtures we assert relationships that MUST hold for
// any sensible deal. These catch the "two code paths compute the same number
// differently" class (e.g. the refinance monthly-vs-annual debt-service bug)
// without waiting for a hand-built fixture to happen to exercise it.
//
// A fixed seed keeps a green CI run reproducible; fast-check prints the failing
// counterexample + seed when a property breaks.

import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { applyStress, runUnderwriting, STRESS_PRESETS, type UnderwritingInput } from "@/lib/engine";

const SEED = 0x5eed;
const NUM_RUNS = 300;

// Relative+absolute tolerance: the identities below are single arithmetic steps,
// so they hold to machine precision; the slack only absorbs float noise at large
// (hundreds-of-millions) magnitudes and is far tighter than any real bug.
function approx(a: number, b: number, relEps = 1e-7, absEps = 1e-2): boolean {
  return Math.abs(a - b) <= Math.max(absEps, Math.abs(b) * relEps);
}

const finite = (n: number | undefined) => typeof n === "number" && Number.isFinite(n);

// A sensible-deal generator over realistic institutional ranges.
const arbInput = (): fc.Arbitrary<UnderwritingInput> =>
  fc
    .record({
      land: fc.double({ min: 1_000_000, max: 100_000_000, noNaN: true }),
      hard: fc.double({ min: 1_000_000, max: 400_000_000, noNaN: true }),
      soft: fc.double({ min: 0, max: 80_000_000, noNaN: true }),
      contingency: fc.double({ min: 0, max: 40_000_000, noNaN: true }),
      unitCount: fc.integer({ min: 10, max: 2_000 }),
      rent: fc.double({ min: 800, max: 12_000, noNaN: true }),
      constructionMonths: fc.integer({ min: 0, max: 36 }),
      leaseUpMonths: fc.integer({ min: 0, max: 36 }),
      stabilizedOccupancyPct: fc.double({ min: 60, max: 100, noNaN: true }),
      expenseRatioPct: fc.double({ min: 5, max: 70, noNaN: true }),
      exitCapRatePct: fc.double({ min: 3, max: 12, noNaN: true }),
      loanAmount: fc.double({ min: 0, max: 350_000_000, noNaN: true }),
      interestRatePct: fc.double({ min: 1, max: 15, noNaN: true }),
      amortYears: fc.integer({ min: 10, max: 40 }),
      ioMonths: fc.integer({ min: 0, max: 60 }),
      sellingCostsPct: fc.double({ min: 0, max: 5, noNaN: true }),
      holdYears: fc.integer({ min: 1, max: 10 }),
      rentGrowthPct: fc.double({ min: 0, max: 8, noNaN: true }),
      expenseGrowthPct: fc.double({ min: 0, max: 6, noNaN: true }),
    })
    .map((r) => ({
      budget: { land: r.land, hard: r.hard, soft: r.soft, contingency: r.contingency },
      revenueProgram: [
        { unitType: "Residential", unitCount: r.unitCount, rent: r.rent, rentBasis: "per_unit" },
      ],
      constructionMonths: r.constructionMonths,
      leaseUpMonths: r.leaseUpMonths,
      stabilizedOccupancyPct: r.stabilizedOccupancyPct,
      expenseRatioPct: r.expenseRatioPct,
      otherIncomeAnnual: 0,
      exitCapRatePct: r.exitCapRatePct,
      loanAmount: r.loanAmount,
      interestRatePct: r.interestRatePct,
      amortYears: r.amortYears,
      ioMonths: r.ioMonths,
      avgOutstandingFactor: 0.5,
      sellingCostsPct: r.sellingCostsPct,
      holdYears: r.holdYears,
      equityAmount: null,
      rentGrowthPct: r.rentGrowthPct,
      expenseGrowthPct: r.expenseGrowthPct,
    }));

describe("engine invariants (property-based)", () => {
  test("core accounting identities hold for any sensible deal", () => {
    fc.assert(
      fc.property(arbInput(), (input) => {
        const v = runUnderwriting(input).values;
        // Every headline figure resolves to a finite number.
        for (const n of [v.tdc, v.gpr, v.egi, v.opex, v.noi, v.exitValue, v.totalDebt, v.ltcPct]) {
          expect(finite(n)).toBe(true);
        }
        // NOI = EGI - OpEx, and OpEx = EGI x expense ratio.
        expect(approx(v.noi, v.egi - v.opex)).toBe(true);
        expect(approx(v.opex, v.egi * (input.expenseRatioPct / 100))).toBe(true);
        // Sources = Uses: required equity + total debt = TDC.
        expect(approx(v.requiredEquity + v.totalDebt, v.tdc)).toBe(true);
        // Exit value = NOI / exit cap.
        expect(approx(v.exitValue, v.noi / (input.exitCapRatePct / 100))).toBe(true);
        // Effective occupancy cannot exceed 100% (other income is zero here).
        expect(v.effectiveOccupancyPct).toBeLessThanOrEqual(100 + 1e-6);
        expect(v.egi).toBeGreaterThanOrEqual(-1e-6);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  test("LTC is non-decreasing in senior loan size", () => {
    fc.assert(
      fc.property(
        arbInput(),
        fc.double({ min: 0, max: 100_000_000, noNaN: true }),
        (input, extra) => {
          const base = runUnderwriting(input).values.ltcPct;
          const more = runUnderwriting({ ...input, loanAmount: input.loanAmount + extra }).values
            .ltcPct;
          expect(more).toBeGreaterThanOrEqual(base - 1e-6);
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  test("DSCR is non-increasing in the interest rate", () => {
    fc.assert(
      fc.property(
        arbInput().filter((i) => i.loanAmount > 1_000_000),
        fc.double({ min: 0.25, max: 5, noNaN: true }),
        (input, bump) => {
          const rate = Math.min(20, input.interestRatePct + bump);
          const base = runUnderwriting(input).values.dscr;
          const higher = runUnderwriting({ ...input, interestRatePct: rate }).values.dscr;
          expect(higher).toBeLessThanOrEqual(base + 1e-6);
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  test("exit value is non-increasing in the exit cap rate", () => {
    fc.assert(
      fc.property(arbInput(), fc.double({ min: 0.1, max: 8, noNaN: true }), (input, bump) => {
        const cap = Math.min(20, input.exitCapRatePct + bump);
        const base = runUnderwriting(input).values.exitValue;
        const higher = runUnderwriting({ ...input, exitCapRatePct: cap }).values.exitValue;
        expect(higher).toBeLessThanOrEqual(base + 1e-3);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  test("NOI is non-increasing in the expense ratio", () => {
    fc.assert(
      fc.property(arbInput(), fc.double({ min: 0.5, max: 25, noNaN: true }), (input, bump) => {
        const er = Math.min(95, input.expenseRatioPct + bump);
        const base = runUnderwriting(input).values.noi;
        const higher = runUnderwriting({ ...input, expenseRatioPct: er }).values.noi;
        expect(higher).toBeLessThanOrEqual(base + 1e-3);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  test("combined downside stress never improves NOI or development profit", () => {
    const combined = STRESS_PRESETS.find((p) => p.key === "combined")!;
    fc.assert(
      fc.property(arbInput(), (input) => {
        const base = runUnderwriting(input).values;
        const stressed = runUnderwriting(applyStress(input, combined)).values;
        expect(stressed.noi).toBeLessThanOrEqual(base.noi + 1e-3);
        expect(stressed.developmentProfit).toBeLessThanOrEqual(base.developmentProfit + 1e-3);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });
});

// ---- Cross-model consistency: the monthly spine must roll up to the annual
// backbone for every deal archetype, not just one fixture. The engine emits a
// per-concept reconciliation array with a documented tolerance verdict; we
// assert every row passes across the archetype matrix. This is exactly where the
// refinance debt-service divergence hid.

function devDeal(overrides: Partial<UnderwritingInput> = {}): UnderwritingInput {
  return {
    budget: { land: 5_000_000, hard: 20_000_000, soft: 3_000_000, contingency: 1_000_000 },
    revenueProgram: [
      { unitType: "Residential", unitCount: 120, rent: 3_000, rentBasis: "per_unit" },
      { unitType: "Retail", unitCount: 1, avgSf: 10_000, rent: 40, rentBasis: "per_sf" },
    ],
    constructionMonths: 12,
    leaseUpMonths: 12,
    stabilizedOccupancyPct: 95,
    expenseRatioPct: 35,
    otherIncomeAnnual: 250_000,
    exitCapRatePct: 5,
    loanAmount: 18_000_000,
    interestRatePct: 6,
    amortYears: 30,
    ioMonths: 24,
    avgOutstandingFactor: 0.5,
    sellingCostsPct: 2,
    holdYears: 5,
    equityAmount: 11_000_000,
    rentGrowthPct: 3,
    expenseGrowthPct: 2,
    monthlyModel: true,
    ...overrides,
  };
}

const ARCHETYPES: Array<{ name: string; deal: UnderwritingInput }> = [
  { name: "amortizing senior, stabilized", deal: devDeal({ ioMonths: 0 }) },
  { name: "interest-only senior", deal: devDeal({ ioMonths: 60 }) },
  { name: "s-curve construction draws", deal: devDeal({ constructionDrawCurve: "s_curve" }) },
  { name: "lease-up absorption curve", deal: devDeal({ leaseUpCurve: true }) },
  {
    name: "mezzanine tranche",
    deal: devDeal({ mezzanine: { amount: 3_000_000, ratePct: 11, amortYears: 30, ioMonths: 24 } }),
  },
  {
    name: "refinance mid-hold",
    deal: devDeal({
      holdYears: 7,
      refinance: { month: 36, ltvPct: 65, ratePct: 5.5, amortYears: 30, ioMonths: 0 },
    }),
  },
  { name: "equity drawn over construction", deal: devDeal({ equityDrawMonths: 12 }) },
  {
    name: "all precision features combined",
    deal: devDeal({
      holdYears: 7,
      constructionDrawCurve: "s_curve",
      leaseUpCurve: true,
      equityDrawMonths: 12,
      mezzanine: { amount: 3_000_000, ratePct: 11, amortYears: 30, ioMonths: 24 },
      refinance: { month: 36, ltvPct: 65, ratePct: 5.5, amortYears: 30, ioMonths: 0 },
    }),
  },
];

describe("cross-model consistency: monthly spine rolls up to the annual backbone", () => {
  for (const { name, deal } of ARCHETYPES) {
    test(`every reconciliation row is within tolerance: ${name}`, () => {
      const out = runUnderwriting(deal);
      expect(out.schedule).toBeDefined();
      const recon = out.schedule!.reconciliation;
      expect(recon.length).toBeGreaterThan(0);
      const failing = recon.filter((r) => !r.withinTolerance);
      expect(
        failing,
        `out-of-tolerance: ${failing.map((f) => `${f.key} annual=${f.annual} rolled=${f.rolledUp} diff=${f.diff}`).join("; ")}`,
      ).toEqual([]);
    });
  }
});
