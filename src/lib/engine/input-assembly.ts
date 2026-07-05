// THE ONE ARCHITECTURAL LAW: the underwriting engine reads from exactly one
// place -- a typed EngineInput assembled here from rows whose status is
// 'approved' or 'default_accepted'. No LLM output can become an engine input
// because nothing in this module (or anything it calls) invokes a model, and
// every value it consumes is a persisted row with provenance.
//
// Readiness is fail-closed: if any required key is missing or conflicting,
// assembly is BLOCKED and the engine never runs. There is no "best effort".

import type { RevenueUnitInput, UnderwritingInput } from "./types";
import { brandUnderwritingInput, type BrandedUnderwritingInput } from "./units";

export type EngineInputStatus =
  | "proposed"
  | "extracted"
  | "conflicting"
  | "approved"
  | "default_accepted"
  | "calculated"
  | "rejected";

export const ENGINE_READABLE_STATUSES: EngineInputStatus[] = ["approved", "default_accepted"];

export type ScalarInputRow = {
  key: string;
  value_numeric: number | null;
  status: EngineInputStatus;
  source?: string | null;
  source_text?: string | null;
  source_location?: string | null;
  conflict_values?: { value: number; source?: string | null }[] | null;
};

export type BudgetCategory =
  | "land"
  | "hard"
  | "soft"
  | "contingency"
  | "financing_interest"
  | "other";

export type BudgetLineRow = {
  category: BudgetCategory;
  label?: string | null;
  amount: number;
  status: EngineInputStatus;
};

export type RevenueComponentRow = {
  unit_type: string;
  unit_count: number;
  avg_sf?: number | null;
  // per_unit: $/unit/month; per_sf: annual $/SF (stored in market_rent_monthly column).
  rent: number;
  rent_basis: "per_unit" | "per_sf";
  occupancy_pct?: number | null;
  status: EngineInputStatus;
};

export type ProjectInputRows = {
  scalars: ScalarInputRow[];
  budget: BudgetLineRow[];
  revenue: RevenueComponentRow[];
};

// Required inputs for a development deal. Underwriting is blocked until every
// one of these is approved or default-accepted.
export const REQUIRED_BUDGET_CATEGORIES: BudgetCategory[] = [
  "land",
  "hard",
  "soft",
  "contingency",
  "financing_interest",
];

export const REQUIRED_SCALAR_KEYS = [
  "loan_amount",
  "interest_rate_pct",
  "amort_years",
  "equity_amount",
  "exit_cap_rate_pct",
  "expense_ratio_pct",
  "hold_years",
  "selling_costs_pct",
] as const;

// Static, consensual defaults. These are NEVER applied silently and NEVER
// LLM-generated: they fill a missing key only via an explicit analyst action
// ("Accept defaults") that writes rows with source='default',
// status='default_accepted'.
export const DEFAULTS: Record<string, { value: number; label: string }> = {
  expense_ratio_pct: { value: 35, label: "Operating expense ratio 35%" },
  selling_costs_pct: { value: 2, label: "Selling costs 2%" },
  hold_years: { value: 5, label: "Hold period 5 years" },
  // NOTE: lease_up_months is an ABSENT_MEANS_ZERO key, so it never appears in
  // readiness.missing and this entry is never offered by "Accept defaults" on
  // the assembled path - an absent lease-up deliberately models 0 months (no
  // silent 12-month assumption). The entry exists for the quick-start
  // calculator (finance.ts), which seeds a sketch deal from these values.
  lease_up_months: { value: 12, label: "Lease-up 12 months" },
};

// Keys whose absence means "zero / not present" rather than "unknown".
// other_income is included only if extracted or default-accepted -- never assumed.
const ABSENT_MEANS_ZERO = new Set([
  "other_income_annual",
  "io_months",
  "rent_growth_pct",
  "expense_growth_pct",
  "construction_months",
  "lease_up_months",
  "avg_outstanding_factor",
]);

export type Readiness = {
  status: "ready" | "blocked";
  missing: string[];
  conflicting: string[];
  impossible: string[];
  defaultable: string[]; // subset of missing fillable from DEFAULTS via "Accept defaults"
};

function readableScalar(rows: ScalarInputRow[], key: string): ScalarInputRow | undefined {
  return rows.find(
    (r) => r.key === key && ENGINE_READABLE_STATUSES.includes(r.status) && r.value_numeric != null,
  );
}

const NON_NEGATIVE_SCALARS = new Set([
  "loan_amount",
  "equity_amount",
  "other_income_annual",
  "mezz_loan_amount",
  "refinance_amount",
  "stated_total_project_cost",
]);

const PERCENT_0_TO_100_SCALARS = new Set([
  "stabilized_occupancy_pct",
  "lender_stabilized_occupancy_pct",
  "expense_ratio_pct",
  "selling_costs_pct",
  "refinance_ltv_pct",
  "lp_equity_pct",
  "gp_equity_pct",
  "preferred_return_pct",
  "gp_catch_up_pct",
  "promote_tier1_gp_pct",
  "promote_tier2_gp_pct",
]);

const RATE_0_TO_100_SCALARS = new Set([
  "interest_rate_pct",
  "mezz_interest_rate_pct",
  "refinance_rate_pct",
]);

const NON_NEGATIVE_PERIOD_SCALARS = new Set([
  "amort_years",
  "io_months",
  "construction_months",
  "lease_up_months",
  "equity_draw_months",
  "mezz_amort_years",
  "mezz_io_months",
  "refinance_month",
  "refinance_amort_years",
  "refinance_io_months",
]);

function impossibleScalarReason(key: string, raw: number | null | undefined): string | null {
  if (raw == null || !Number.isFinite(Number(raw))) return `${key}:not_finite`;
  const value = Number(raw);
  if (NON_NEGATIVE_SCALARS.has(key) && value < 0) return `${key}:negative`;
  if (PERCENT_0_TO_100_SCALARS.has(key) && (value < 0 || value > 100))
    return `${key}:outside_0_100`;
  if (RATE_0_TO_100_SCALARS.has(key) && (value < 0 || value > 100)) return `${key}:outside_0_100`;
  if (key === "exit_cap_rate_pct" && (value <= 0 || value > 100)) return `${key}:outside_0_100`;
  if (key === "hold_years" && value <= 0) return `${key}:not_positive`;
  if (NON_NEGATIVE_PERIOD_SCALARS.has(key) && value < 0) return `${key}:negative_period`;
  if (key === "avg_outstanding_factor" && (value < 0 || value > 1)) return `${key}:outside_0_1`;
  if ((key === "rent_growth_pct" || key === "expense_growth_pct") && value < -100)
    return `${key}:below_negative_100`;
  return null;
}

function pushUnique(target: string[], key: string) {
  if (!target.includes(key)) target.push(key);
}

// Complete = every figure GPR needs is present: count and rent always, and the
// square footage when the rent is quoted per SF.
function isCompleteComponent(r: RevenueComponentRow): boolean {
  return (
    Number(r.unit_count) > 0 &&
    Number(r.rent) > 0 &&
    (r.rent_basis !== "per_sf" || Number(r.avg_sf) > 0)
  );
}

// Effective project occupancy when only component-level occupancies were
// approved: the GPR-weighted average (the same weights componentGpr uses).
function weightedComponentOccupancy(program: RevenueUnitInput[]): number {
  const gprOf = (r: RevenueUnitInput) =>
    r.rentBasis === "per_sf" ? r.unitCount * (r.avgSf ?? 0) * r.rent : r.unitCount * r.rent * 12;
  const totalGpr = program.reduce((sum, r) => sum + gprOf(r), 0);
  if (totalGpr <= 0) return 0;
  return program.reduce((sum, r) => sum + gprOf(r) * (r.occupancyPct ?? 0), 0) / totalGpr;
}

export function computeReadiness(rows: ProjectInputRows): Readiness {
  const missing: string[] = [];
  const conflicting: string[] = [];
  const impossible: string[] = [];
  const pushMissing = (key: string) => pushUnique(missing, key);
  const pushConflicting = (key: string) => pushUnique(conflicting, key);
  const pushImpossible = (key: string) => pushUnique(impossible, key);

  for (const category of REQUIRED_BUDGET_CATEGORIES) {
    const lines = rows.budget.filter((b) => b.category === category);
    if (lines.some((b) => b.status === "conflicting")) pushConflicting(`budget:${category}`);
    else if (lines.some((b) => ENGINE_READABLE_STATUSES.includes(b.status) && Number(b.amount) < 0))
      pushImpossible(`budget:${category}:negative`);
    else if (!lines.some((b) => ENGINE_READABLE_STATUSES.includes(b.status)))
      pushMissing(`budget:${category}`);
  }

  for (const key of REQUIRED_SCALAR_KEYS) {
    const all = rows.scalars.filter((r) => r.key === key);
    if (all.some((r) => r.status === "conflicting")) pushConflicting(key);
    else {
      const readable = readableScalar(rows.scalars, key);
      const reason = impossibleScalarReason(key, readable?.value_numeric);
      if (readable && reason) pushImpossible(reason);
      else if (!readable) pushMissing(key);
    }
  }

  // Optional engine targets still fail closed once they appear in the review
  // queue: an unresolved conflict cannot be silently treated as "absent".
  for (const row of rows.scalars) {
    if (row.status === "conflicting") pushConflicting(row.key);
    if (ENGINE_READABLE_STATUSES.includes(row.status)) {
      const reason = impossibleScalarReason(row.key, row.value_numeric);
      if (reason) pushImpossible(reason);
    }
  }

  // A positive mezzanine amount activates the subordinate-debt tranche. Its
  // coupon is then mandatory; otherwise the engine would model free mezz debt.
  const mezzAmount = readableScalar(rows.scalars, "mezz_loan_amount")?.value_numeric;
  if (mezzAmount != null && mezzAmount > 0) {
    const mezzRateRow = readableScalar(rows.scalars, "mezz_interest_rate_pct");
    if (!mezzRateRow || mezzRateRow.value_numeric == null || mezzRateRow.value_numeric <= 0) {
      pushMissing("mezz_interest_rate_pct");
    }
  }

  // A component is usable only when it is engine-readable AND complete
  // (count/SF and rent both present): a partial row never silently feeds
  // a zero into the engine. For a per-SF rent that includes the square
  // footage - GPR is count x SF x rent, so an approved $/SF rent with no SF
  // would silently contribute $0.
  const engineReadableComponents = rows.revenue.filter((r) =>
    ENGINE_READABLE_STATUSES.includes(r.status),
  );
  for (const r of engineReadableComponents) {
    if (Number(r.unit_count) < 0) pushImpossible(`revenue:${r.unit_type}:negative_units`);
    if (Number(r.rent) < 0) pushImpossible(`revenue:${r.unit_type}:negative_rent`);
    if (r.avg_sf != null && Number(r.avg_sf) < 0)
      pushImpossible(`revenue:${r.unit_type}:negative_sf`);
    if (r.occupancy_pct != null && (Number(r.occupancy_pct) < 0 || Number(r.occupancy_pct) > 100))
      pushImpossible(`revenue:${r.unit_type}:occupancy_outside_0_100`);
  }
  const readableComponents = engineReadableComponents.filter(isCompleteComponent);
  for (const r of engineReadableComponents) {
    if (
      Number(r.unit_count) > 0 &&
      Number(r.rent) > 0 &&
      r.rent_basis === "per_sf" &&
      !(Number(r.avg_sf) > 0)
    ) {
      pushMissing(`sf:${r.unit_type}`);
    }
  }
  if (rows.revenue.some((r) => r.status === "conflicting")) pushConflicting("revenue_program");
  else if (readableComponents.length === 0) pushMissing("revenue_program");

  // Stabilized occupancy is required per revenue component (own occupancy_pct
  // or an approved project-level stabilized_occupancy_pct fallback).
  const projectOcc = readableScalar(rows.scalars, "stabilized_occupancy_pct");
  for (const component of readableComponents) {
    if (component.occupancy_pct == null && projectOcc == null) {
      pushMissing(`occupancy:${component.unit_type}`);
    }
  }

  const defaultable = missing.filter((k) => DEFAULTS[k] != null);
  return {
    status:
      missing.length === 0 && conflicting.length === 0 && impossible.length === 0
        ? "ready"
        : "blocked",
    missing,
    conflicting,
    impossible,
    defaultable,
  };
}

// Deterministic conflict policy: "use conservative" picks, among the candidate
// values, the one producing the LOWER valuation / return. No code path may
// average, blend, or invent a third value.
const CONSERVATIVE_PICKS_MAX = new Set([
  "exit_cap_rate_pct",
  "expense_ratio_pct",
  "interest_rate_pct",
  "selling_costs_pct",
  "vacancy_pct",
  "expense_growth_pct",
  "io_months",
  // Higher equity required = more capital at risk = more conservative.
  "equity_amount",
  // A pricier mezzanine tranche is the more conservative read.
  "mezz_interest_rate_pct",
]);
const CONSERVATIVE_PICKS_MIN = new Set([
  "stabilized_occupancy_pct",
  "rent_growth_pct",
  "other_income_annual",
  // Lower loan proceeds = less supportable debt = more conservative.
  "loan_amount",
  "hold_years",
  "amort_years",
  // Less subordinate debt = less leverage = more conservative.
  "mezz_loan_amount",
]);

export function conservativePick(key: string, values: number[]): number {
  if (!values.length) throw new Error(`conservativePick: no candidate values for ${key}`);
  if (CONSERVATIVE_PICKS_MAX.has(key) || key.startsWith("budget:")) return Math.max(...values);
  if (CONSERVATIVE_PICKS_MIN.has(key) || key.startsWith("occupancy:")) return Math.min(...values);
  // Cost-like keys default to max, income-like to min; unknown keys are
  // treated as income-like (lower value = lower return = conservative).
  return Math.min(...values);
}

// Derived tier: a derivable total is never "missing". Computes
// total_project_cost from approved/default_accepted budget lines.
export function deriveCalculatedTdc(
  rows: BudgetLineRow[],
): { value: number; formula_text: string } | null {
  const readable = rows.filter((b) => ENGINE_READABLE_STATUSES.includes(b.status));
  const sums = new Map<BudgetCategory, number>();
  for (const line of readable)
    sums.set(line.category, (sums.get(line.category) ?? 0) + Number(line.amount));
  if (!REQUIRED_BUDGET_CATEGORIES.every((c) => sums.has(c))) return null;
  const parts = REQUIRED_BUDGET_CATEGORIES.map((c) => sums.get(c) ?? 0);
  const other = sums.get("other") ?? 0;
  const total = parts.reduce((a, b) => a + b, 0) + other;
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n));
  const formula = `total_project_cost = land ${fmt(parts[0])} + hard ${fmt(parts[1])} + soft ${fmt(parts[2])} + contingency ${fmt(parts[3])} + financing ${fmt(parts[4])}${other ? ` + other ${fmt(other)}` : ""} = ${fmt(total)}`;
  return { value: total, formula_text: formula };
}

export class UnderwritingBlockedError extends Error {
  readiness: Readiness;
  constructor(readiness: Readiness) {
    super(
      `Underwriting is blocked. Missing: ${readiness.missing.join(", ") || "none"}. Conflicting: ${readiness.conflicting.join(", ") || "none"}. Impossible: ${readiness.impossible.join(", ") || "none"}.`,
    );
    this.name = "UnderwritingBlockedError";
    this.readiness = readiness;
  }
}

// The single loader-side assembly. Throws (fail-closed) when blocked.
export function assembleEngineInput(rows: ProjectInputRows): BrandedUnderwritingInput {
  const readiness = computeReadiness(rows);
  if (readiness.status !== "ready") throw new UnderwritingBlockedError(readiness);

  const budgetSum = (category: BudgetCategory) =>
    rows.budget
      .filter((b) => b.category === category && ENGINE_READABLE_STATUSES.includes(b.status))
      .reduce((sum, b) => sum + Number(b.amount), 0);

  const scalar = (key: string): number | null =>
    readableScalar(rows.scalars, key)?.value_numeric ?? null;
  const required = (key: string): number => {
    const v = scalar(key);
    if (v == null) throw new UnderwritingBlockedError(readiness); // unreachable when ready
    return v;
  };
  const optionalZero = (key: string): number => {
    if (!ABSENT_MEANS_ZERO.has(key))
      throw new Error(`Key ${key} is not an absent-means-zero input.`);
    return scalar(key) ?? 0;
  };

  const projectOcc = scalar("stabilized_occupancy_pct");
  const revenueProgram: RevenueUnitInput[] = rows.revenue
    .filter((r) => ENGINE_READABLE_STATUSES.includes(r.status) && isCompleteComponent(r))
    .map((r) => ({
      unitType: r.unit_type,
      unitCount: Number(r.unit_count),
      avgSf: r.avg_sf == null ? null : Number(r.avg_sf),
      rent: Number(r.rent),
      rentBasis: r.rent_basis,
      occupancyPct: r.occupancy_pct == null ? (projectOcc ?? null) : Number(r.occupancy_pct),
    }));

  // ---- IC-grade optional extensions (all absent => today's behavior) ----
  // 1B. Mezzanine tranche: present only when a positive mezz loan is approved.
  const mezzAmount = scalar("mezz_loan_amount");
  const mezzanine =
    mezzAmount != null && mezzAmount > 0
      ? {
          amount: mezzAmount,
          ratePct: scalar("mezz_interest_rate_pct") ?? 0,
          amortYears: scalar("mezz_amort_years") ?? 0,
          ioMonths: scalar("mezz_io_months") ?? 0,
        }
      : null;

  // 1C. LP/GP waterfall: assembled only when a promote or preferred return is
  // approved. lp/gp equity shares default to 100/0 (LP holds the whole deal).
  const lpEquityPct = scalar("lp_equity_pct");
  const gpEquityPct = scalar("gp_equity_pct");
  const preferredReturnPct = scalar("preferred_return_pct") ?? 0;
  const tier1Gp = scalar("promote_tier1_gp_pct");
  const tier2Gp = scalar("promote_tier2_gp_pct");
  const tiers: { hurdlePct?: number | null; gpPct: number }[] = [];
  if (tier1Gp != null)
    tiers.push({ hurdlePct: scalar("promote_tier1_hurdle_pct"), gpPct: tier1Gp });
  if (tier2Gp != null)
    tiers.push({ hurdlePct: scalar("promote_tier2_hurdle_pct"), gpPct: tier2Gp });
  const hasWaterfall =
    preferredReturnPct > 0 ||
    tiers.some((t) => t.gpPct > 0) ||
    lpEquityPct != null ||
    gpEquityPct != null;
  const resolvedLp =
    lpEquityPct != null ? lpEquityPct : gpEquityPct != null ? 100 - gpEquityPct : 100;
  const resolvedGp =
    gpEquityPct != null ? gpEquityPct : lpEquityPct != null ? 100 - lpEquityPct : 0;
  const waterfall = hasWaterfall
    ? {
        lpEquityPct: resolvedLp,
        gpEquityPct: resolvedGp,
        preferredReturnPct,
        gpCatchUpPct: scalar("gp_catch_up_pct") ?? 0,
        tiers,
      }
    : null;

  // ---- Monthly cash-flow spine (WS1). All absent => the annual path runs. ----
  // 1C. A refinance is assembled only when a positive refinance month is
  // approved. Rate and amortization default to the senior loan's (a pure
  // rate-and-term takeout) when not separately supplied.
  const refiMonth = scalar("refinance_month");
  const refinance =
    refiMonth != null && refiMonth > 0
      ? {
          month: refiMonth,
          newAmount: scalar("refinance_amount"),
          ltvPct: scalar("refinance_ltv_pct"),
          ratePct: scalar("refinance_rate_pct") ?? required("interest_rate_pct"),
          amortYears: scalar("refinance_amort_years") ?? required("amort_years"),
          ioMonths: scalar("refinance_io_months") ?? 0,
        }
      : null;

  return brandUnderwritingInput({
    budget: {
      land: budgetSum("land"),
      hard: budgetSum("hard"),
      soft: budgetSum("soft"),
      contingency: budgetSum("contingency"),
      financingInterest: budgetSum("financing_interest"),
      other: budgetSum("other") || undefined,
    },
    revenueProgram,
    constructionMonths: optionalZero("construction_months"),
    leaseUpMonths: optionalZero("lease_up_months"),
    // When no project-level occupancy is approved (allowed: readiness then
    // requires every component to carry its own), the scalar is derived as the
    // GPR-weighted average of component occupancies. Fabricating 0% here would
    // not change the annual engine (components win) but corrupts everything
    // that reads the scalar - e.g. the stabilized_occupancy sensitivity driver
    // reports a zero-swing tornado bar and a nonsense breakeven.
    stabilizedOccupancyPct: projectOcc ?? weightedComponentOccupancy(revenueProgram),
    expenseRatioPct: required("expense_ratio_pct"),
    otherIncomeAnnual: optionalZero("other_income_annual"),
    exitCapRatePct: required("exit_cap_rate_pct"),
    loanAmount: required("loan_amount"),
    interestRatePct: required("interest_rate_pct"),
    amortYears: required("amort_years"),
    ioMonths: optionalZero("io_months"),
    avgOutstandingFactor: optionalZero("avg_outstanding_factor"),
    sellingCostsPct: required("selling_costs_pct"),
    holdYears: required("hold_years"),
    equityAmount: required("equity_amount"),
    rentGrowthPct: optionalZero("rent_growth_pct"),
    expenseGrowthPct: optionalZero("expense_growth_pct"),
    equityDrawMonths: scalar("equity_draw_months"),
    mezzanine,
    waterfall,
    // 1D: opt-in lease-up absorption (a positive flag turns it on).
    leaseUpCurve: (scalar("lease_up_curve") ?? 0) > 0,
    // WS1 monthly spine: a positive flag opts the deal into monthly precision.
    monthlyModel: (scalar("monthly_model") ?? 0) > 0,
    constructionDrawCurve: (scalar("construction_s_curve") ?? 0) > 0 ? "s_curve" : "straight_line",
    refinance,
  });
}
