// Regression: the gpr_vs_revenue reconciliation check must compute GPR with the
// SAME unit convention as the underwriting engine. A per_sf row stores ANNUAL
// $/SF (no x12); a per_unit row stores $/unit/MONTH (x12). A prior bug multiplied
// the per_sf branch by 12, overstating commercial GPR 12x and firing spurious
// revenue-mismatch flags on every retail/office/industrial deal.

import { describe, expect, test } from "vitest";
import { computeRevenueGpr } from "@/lib/reconcile.server";
import { componentGpr } from "@/lib/engine";

describe("reconciliation GPR uses the engine's unit convention", () => {
  test("per_sf rent is annual $/SF (no x12); per_unit rent is $/unit/month (x12)", () => {
    // Retail: 18,000 SF @ $42 annual $/SF = $756,000 (NOT $9.07M).
    expect(
      computeRevenueGpr([
        { rent_basis: "per_sf", avg_sf: 18_000, market_rent_monthly: 42, unit_count: 1 },
      ]),
    ).toBe(18_000 * 42);
    // Residential: 220 units @ $2,000/unit/month = $5,280,000 (annualized x12).
    expect(
      computeRevenueGpr([
        { rent_basis: "per_unit", avg_sf: null, market_rent_monthly: 2_000, unit_count: 220 },
      ]),
    ).toBe(220 * 2_000 * 12);
  });

  test("computeRevenueGpr equals the engine's componentGpr for both bases (no drift)", () => {
    expect(
      computeRevenueGpr([
        { rent_basis: "per_sf", avg_sf: 32_000, market_rent_monthly: 36, unit_count: 1 },
      ]),
    ).toBe(
      componentGpr({
        unitType: "Office",
        unitCount: 1,
        avgSf: 32_000,
        rent: 36,
        rentBasis: "per_sf",
      }),
    );
    expect(
      computeRevenueGpr([
        { rent_basis: "per_unit", avg_sf: null, market_rent_monthly: 2_600, unit_count: 50 },
      ]),
    ).toBe(
      componentGpr({
        unitType: "2BR",
        unitCount: 50,
        avgSf: null,
        rent: 2_600,
        rentBasis: "per_unit",
      }),
    );
  });

  test("a mixed-use program sums per-component GPR without 12x-ing the per_sf lines", () => {
    const rows = [
      { rent_basis: "per_unit", avg_sf: null, market_rent_monthly: 2_000, unit_count: 220 },
      { rent_basis: "per_sf", avg_sf: 18_000, market_rent_monthly: 42, unit_count: 1 },
      { rent_basis: "per_sf", avg_sf: 32_000, market_rent_monthly: 36, unit_count: 1 },
    ];
    const expected = 220 * 2_000 * 12 + 18_000 * 42 + 32_000 * 36;
    expect(computeRevenueGpr(rows)).toBe(expected);
  });
});
