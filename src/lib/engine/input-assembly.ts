// THE ONE ARCHITECTURAL LAW: the underwriting engine reads from exactly one
// place -- a typed EngineInput assembled here from rows whose status is
// 'approved' or 'default_accepted'. No LLM output can become an engine input
// because nothing in this module (or anything it calls) invokes a model, and
// every value it consumes is a persisted row with provenance.
//
// Readiness is fail-closed: if any required key is missing or conflicting,
// assembly is BLOCKED and the engine never runs. There is no "best effort".

import type { RevenueUnitInput, UnderwritingInput } from "./types";

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

export type BudgetCategory = "land" | "hard" | "soft" | "contingency" | "financing_interest" | "other";

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
  defaultable: string[]; // subset of missing fillable from DEFAULTS via "Accept defaults"
};

function readableScalar(rows: ScalarInputRow[], key: string): ScalarInputRow | undefined {
  return rows.find((r) => r.key === key && ENGINE_READABLE_STATUSES.includes(r.status) && r.value_numeric != null);
}

export function computeReadiness(rows: ProjectInputRows): Readiness {
  const missing: string[] = [];
  const conflicting: string[] = [];

  for (const category of REQUIRED_BUDGET_CATEGORIES) {
    const lines = rows.budget.filter((b) => b.category === category);
    if (lines.some((b) => b.status === "conflicting")) conflicting.push(`budget:${category}`);
    else if (!lines.some((b) => ENGINE_READABLE_STATUSES.includes(b.status))) missing.push(`budget:${category}`);
  }

  for (const key of REQUIRED_SCALAR_KEYS) {
    const all = rows.scalars.filter((r) => r.key === key);
    if (all.some((r) => r.status === "conflicting")) conflicting.push(key);
    else if (!readableScalar(rows.scalars, key)) missing.push(key);
  }

  // A component is usable only when it is engine-readable AND complete
  // (count/SF and rent both present): a partial row never silently feeds
  // a zero into the engine.
  const readableComponents = rows.revenue.filter(
    (r) => ENGINE_READABLE_STATUSES.includes(r.status) && Number(r.unit_count) > 0 && Number(r.rent) > 0,
  );
  if (rows.revenue.some((r) => r.status === "conflicting")) conflicting.push("revenue_program");
  else if (readableComponents.length === 0) missing.push("revenue_program");

  // Stabilized occupancy is required per revenue component (own occupancy_pct
  // or an approved project-level stabilized_occupancy_pct fallback).
  const projectOcc = readableScalar(rows.scalars, "stabilized_occupancy_pct");
  for (const component of readableComponents) {
    if (component.occupancy_pct == null && !projectOcc) {
      missing.push(`occupancy:${component.unit_type}`);
    }
  }

  const defaultable = missing.filter((k) => DEFAULTS[k] != null);
  return {
    status: missing.length === 0 && conflicting.length === 0 ? "ready" : "blocked",
    missing,
    conflicting,
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
export function deriveCalculatedTdc(rows: BudgetLineRow[]): { value: number; formula_text: string } | null {
  const readable = rows.filter((b) => ENGINE_READABLE_STATUSES.includes(b.status));
  const sums = new Map<BudgetCategory, number>();
  for (const line of readable) sums.set(line.category, (sums.get(line.category) ?? 0) + Number(line.amount));
  if (!REQUIRED_BUDGET_CATEGORIES.every((c) => sums.has(c))) return null;
  const parts = REQUIRED_BUDGET_CATEGORIES.map((c) => sums.get(c) ?? 0);
  const other = sums.get("other") ?? 0;
  const total = parts.reduce((a, b) => a + b, 0) + other;
  const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n));
  const formula = `total_project_cost = land ${fmt(parts[0])} + hard ${fmt(parts[1])} + soft ${fmt(parts[2])} + contingency ${fmt(parts[3])} + financing ${fmt(parts[4])}${other ? ` + other ${fmt(other)}` : ""} = ${fmt(total)}`;
  return { value: total, formula_text: formula };
}

export class UnderwritingBlockedError extends Error {
  readiness: Readiness;
  constructor(readiness: Readiness) {
    super(
      `Underwriting is blocked. Missing: ${readiness.missing.join(", ") || "none"}. Conflicting: ${readiness.conflicting.join(", ") || "none"}.`,
    );
    this.name = "UnderwritingBlockedError";
    this.readiness = readiness;
  }
}

// The single loader-side assembly. Throws (fail-closed) when blocked.
export function assembleEngineInput(rows: ProjectInputRows): UnderwritingInput {
  const readiness = computeReadiness(rows);
  if (readiness.status !== "ready") throw new UnderwritingBlockedError(readiness);

  const budgetSum = (category: BudgetCategory) =>
    rows.budget
      .filter((b) => b.category === category && ENGINE_READABLE_STATUSES.includes(b.status))
      .reduce((sum, b) => sum + Number(b.amount), 0);

  const scalar = (key: string): number | null => readableScalar(rows.scalars, key)?.value_numeric ?? null;
  const required = (key: string): number => {
    const v = scalar(key);
    if (v == null) throw new UnderwritingBlockedError(readiness); // unreachable when ready
    return v;
  };
  const optionalZero = (key: string): number => {
    if (!ABSENT_MEANS_ZERO.has(key)) throw new Error(`Key ${key} is not an absent-means-zero input.`);
    return scalar(key) ?? 0;
  };

  const projectOcc = scalar("stabilized_occupancy_pct");
  const revenueProgram: RevenueUnitInput[] = rows.revenue
    .filter((r) => ENGINE_READABLE_STATUSES.includes(r.status) && Number(r.unit_count) > 0 && Number(r.rent) > 0)
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
  if (tier1Gp != null) tiers.push({ hurdlePct: scalar("promote_tier1_hurdle_pct"), gpPct: tier1Gp });
  if (tier2Gp != null) tiers.push({ hurdlePct: scalar("promote_tier2_hurdle_pct"), gpPct: tier2Gp });
  const hasWaterfall = preferredReturnPct > 0 || tiers.some((t) => t.gpPct > 0) || lpEquityPct != null || gpEquityPct != null;
  const resolvedLp = lpEquityPct != null ? lpEquityPct : gpEquityPct != null ? 100 - gpEquityPct : 100;
  const resolvedGp = gpEquityPct != null ? gpEquityPct : lpEquityPct != null ? 100 - lpEquityPct : 0;
  const waterfall = hasWaterfall
    ? {
        lpEquityPct: resolvedLp,
        gpEquityPct: resolvedGp,
        preferredReturnPct,
        gpCatchUpPct: scalar("gp_catch_up_pct") ?? 0,
        tiers,
      }
    : null;

  return {
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
    stabilizedOccupancyPct: projectOcc ?? 0,
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
  };
}
