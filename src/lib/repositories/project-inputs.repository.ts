import type { ProjectInputRows } from "@/lib/engine";

export type PersistedScalarInput = ProjectInputRows["scalars"][number];
export type PersistedBudgetInput = ProjectInputRows["budget"][number];
export type PersistedRevenueInput = ProjectInputRows["revenue"][number];
export type ConflictingAssumptionRow = {
  field_key: string;
  conflict_values: Array<{ value: number; source?: string | null }> | null;
  status: "conflicting";
};

export type ProjectInputRepositoryRows = {
  scalars: PersistedScalarInput[];
  budget: PersistedBudgetInput[];
  revenue: PersistedRevenueInput[];
  conflictingAssumptions: ConflictingAssumptionRow[];
};

export async function loadProjectInputRepositoryRows(
  supabase: any,
  projectId: string,
): Promise<ProjectInputRepositoryRows> {
  const [
    { data: scalars, error: scalarError },
    { data: budget, error: budgetError },
    { data: revenue, error: revenueError },
    { data: conflictingAssumptions, error: conflictError },
  ] = await Promise.all([
    supabase.from("underwriting_inputs").select("*").eq("project_id", projectId),
    supabase.from("development_budget").select("*").eq("project_id", projectId),
    supabase.from("revenue_program").select("*").eq("project_id", projectId),
    supabase
      .from("assumptions")
      .select("field_key,conflict_values,status")
      .eq("project_id", projectId)
      .eq("status", "conflicting"),
  ]);
  for (const error of [scalarError, budgetError, revenueError, conflictError]) {
    if (error) throw new Error(error.message);
  }
  return {
    scalars: (scalars ?? []).map((r: any) => ({
      key: r.key,
      value_numeric: r.value_numeric == null ? null : Number(r.value_numeric),
      status: r.status,
      source: r.source,
      source_text: r.source_text ?? null,
      source_location: r.source_location ?? null,
      conflict_values: r.conflict_values ?? null,
    })),
    budget: (budget ?? []).map((r: any) => ({
      category: r.category,
      label: r.label,
      amount: Number(r.amount ?? 0),
      status: r.status,
    })),
    revenue: (revenue ?? []).map((r: any) => ({
      unit_type: r.unit_type,
      unit_count: Number(r.unit_count ?? 0),
      avg_sf: r.avg_sf == null ? null : Number(r.avg_sf),
      rent: Number(r.market_rent_monthly ?? 0),
      rent_basis: r.rent_basis === "per_sf" ? "per_sf" : "per_unit",
      occupancy_pct: r.occupancy_pct == null ? null : Number(r.occupancy_pct),
      status: r.status,
    })),
    conflictingAssumptions: (conflictingAssumptions ?? []).map((row: any) => ({
      field_key: row.field_key,
      status: "conflicting" as const,
      conflict_values: Array.isArray(row.conflict_values)
        ? row.conflict_values
            .map((candidate: any) => ({
              value: Number(candidate.value),
              source: candidate.source ?? null,
            }))
            .filter((candidate: { value: number }) => Number.isFinite(candidate.value))
        : null,
    })),
  };
}
