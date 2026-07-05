import "@tanstack/react-start/server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { assertDealRunAuditPackageValid, buildDealRunAuditPackage } from "./customer-audit-package";
import {
  getLatestCompletedRunForContext,
  listCashFlowsForRunForContext,
  listFinancialOutputsForRunForContext,
  listReconciliationFlagsForRunForContext,
  listRisksForRunForContext,
} from "./underwriting.server";
import { assertWorkflowPermission } from "./workflow-permissions.server";

type Ctx = { supabase: SupabaseClient<Database>; userId: string };

const INPUT_STATUSES = ["approved", "default_accepted", "calculated"] as const;

const SNAPSHOT_SCALAR_KEYS: Array<[string, string]> = [
  ["construction_months", "constructionMonths"],
  ["lease_up_months", "leaseUpMonths"],
  ["stabilized_occupancy_pct", "stabilizedOccupancyPct"],
  ["expense_ratio_pct", "expenseRatioPct"],
  ["other_income_annual", "otherIncomeAnnual"],
  ["exit_cap_rate_pct", "exitCapRatePct"],
  ["loan_amount", "loanAmount"],
  ["interest_rate_pct", "interestRatePct"],
  ["amort_years", "amortYears"],
  ["io_months", "ioMonths"],
  ["avg_outstanding_factor", "avgOutstandingFactor"],
  ["selling_costs_pct", "sellingCostsPct"],
  ["hold_years", "holdYears"],
  ["equity_amount", "equityAmount"],
  ["rent_growth_pct", "rentGrowthPct"],
  ["expense_growth_pct", "expenseGrowthPct"],
  ["equity_draw_months", "equityDrawMonths"],
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

export function snapshotRowsFromRun(runRow: {
  input_snapshot?: unknown;
  accepted_defaults_used?: unknown;
}) {
  if (!isRecord(runRow.input_snapshot)) return [];
  const acceptedDefaultKeys = new Set(
    Array.isArray(runRow.accepted_defaults_used)
      ? runRow.accepted_defaults_used
          .map((row) => (isRecord(row) && typeof row.key === "string" ? row.key : null))
          .filter((key): key is string => key != null)
      : [],
  );
  const statusFor = (key: string) =>
    acceptedDefaultKeys.has(key) ? "default_accepted" : "run_snapshot";
  const rows: Record<string, unknown>[] = [];

  const budget = runRow.input_snapshot.budget;
  if (isRecord(budget)) {
    for (const [category, value] of Object.entries(budget)) {
      if (value == null) continue;
      const key = `budget:${category === "financingInterest" ? "financing_interest" : category}`;
      rows.push({
        scope: "budget",
        key,
        category,
        amount: value,
        status: statusFor(key),
        source: "underwriting_runs.input_snapshot",
      });
    }
  }

  const revenueProgram = runRow.input_snapshot.revenueProgram;
  if (Array.isArray(revenueProgram)) {
    for (const component of revenueProgram) {
      if (!isRecord(component)) continue;
      const key = `revenue:${component.unitType ?? "component"}`;
      rows.push({
        scope: "revenue",
        key,
        unit_type: component.unitType,
        unit_count: component.unitCount,
        avg_sf: component.avgSf,
        rent: component.rent,
        rent_basis: component.rentBasis,
        occupancy_pct: component.occupancyPct,
        status: statusFor(key),
        source: "underwriting_runs.input_snapshot",
      });
    }
  }

  for (const [key, snapshotKey] of SNAPSHOT_SCALAR_KEYS) {
    const value = runRow.input_snapshot[snapshotKey];
    if (value == null) continue;
    rows.push({
      scope: "scalar",
      key,
      value_numeric: value,
      status: statusFor(key),
      source: "underwriting_runs.input_snapshot",
    });
  }

  return rows;
}

export async function buildDealRunAuditPackageForContext(
  context: Ctx,
  projectId: string,
  runId?: string | null,
) {
  await assertWorkflowPermission(context, projectId, "canExportAuditPackage");
  const run = runId
    ? await context.supabase
        .from("underwriting_runs")
        .select("*")
        .eq("project_id", projectId)
        .eq("id", runId)
        .single()
    : { data: await getLatestCompletedRunForContext({ data: { project_id: projectId }, context }) };
  if ("error" in run && run.error) throw new Error(run.error.message);
  const runRow = run.data;
  if (!runRow) throw new Error("No completed run is available for this deal.");

  const [
    project,
    scalars,
    budget,
    revenue,
    outputs,
    cashFlows,
    flags,
    risks,
    memo,
    decision,
    auditEvents,
  ] = await Promise.all([
    context.supabase.from("projects").select("*").eq("id", projectId).single(),
    context.supabase
      .from("underwriting_inputs")
      .select(
        "key,value_numeric,status,source,source_text,formula_text,resolution_note,conflict_values",
      )
      .eq("project_id", projectId)
      .in("status", [...INPUT_STATUSES]),
    context.supabase
      .from("development_budget")
      .select("category,amount,status,source_text")
      .eq("project_id", projectId)
      .in("status", [...INPUT_STATUSES]),
    context.supabase
      .from("revenue_program")
      .select(
        "unit_type,unit_count,avg_sf,market_rent_monthly,rent_basis,occupancy_pct,status,source_text",
      )
      .eq("project_id", projectId)
      .in("status", [...INPUT_STATUSES]),
    listFinancialOutputsForRunForContext({
      data: { project_id: projectId, run_id: runRow.id },
      context,
    }),
    listCashFlowsForRunForContext({
      data: { project_id: projectId, run_id: runRow.id },
      context,
    }),
    listReconciliationFlagsForRunForContext({
      data: { project_id: projectId, run_id: runRow.id },
      context,
    }),
    listRisksForRunForContext({
      data: { project_id: projectId, run_id: runRow.id },
      context,
    }),
    context.supabase
      .from("investment_memos")
      .select("id,status,run_id,created_at,verification_report")
      .eq("project_id", projectId)
      .eq("run_id", runRow.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    context.supabase
      .from("decision_logs")
      .select("id,decision,run_id,created_at")
      .eq("project_id", projectId)
      .eq("run_id", runRow.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    context.supabase
      .from("audit_logs")
      .select("id,action,entity_type,entity_id,created_at,payload")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  for (const [label, result] of [
    ["project", project],
    ["underwriting_inputs", scalars],
    ["development_budget", budget],
    ["revenue_program", revenue],
    ["investment_memos", memo],
    ["decision_logs", decision],
    ["audit_logs", auditEvents],
  ] as const) {
    if (result.error)
      throw new Error(`Audit package load failed for ${label}: ${result.error.message}`);
  }

  const approvedInputs = [
    ...((scalars.data ?? []) as unknown[]),
    ...((budget.data ?? []) as unknown[]),
    ...((revenue.data ?? []) as unknown[]),
  ];
  const snapshotInputs = snapshotRowsFromRun(runRow);
  const packageApprovedInputs = snapshotInputs.length ? snapshotInputs : approvedInputs;
  const defaultAcceptedInputs = packageApprovedInputs.filter(
    (row) =>
      typeof row === "object" &&
      row != null &&
      (row as { status?: unknown }).status === "default_accepted",
  );
  const staticDefaultsUsed = Array.isArray(runRow.accepted_defaults_used)
    ? runRow.accepted_defaults_used
    : [];

  const pkg = buildDealRunAuditPackage({
    generatedAt: new Date().toISOString(),
    project: project.data as Record<string, unknown>,
    run: {
      id: runRow.id,
      run_number: runRow.run_number,
      run_mode: runRow.run_mode,
      status: runRow.status,
      input_fingerprint: runRow.input_fingerprint,
      output_fingerprint: runRow.output_fingerprint,
      accepted_defaults_used: runRow.accepted_defaults_used,
      conflict_resolutions_used: runRow.conflict_resolutions_used,
    },
    approvedInputs: packageApprovedInputs,
    defaultAcceptedInputs,
    acceptedDefaults: Array.isArray(runRow.accepted_defaults_used)
      ? runRow.accepted_defaults_used
      : [],
    staticDefaultsUsed,
    conflictResolutions: Array.isArray(runRow.conflict_resolutions_used)
      ? runRow.conflict_resolutions_used
      : [],
    outputs,
    cashFlows,
    reconciliationFlags: flags,
    risks,
    memo: memo.data
      ? { id: memo.data.id, status: memo.data.status, run_id: memo.data.run_id }
      : null,
    decision: decision.data
      ? { id: decision.data.id, decision: decision.data.decision, run_id: decision.data.run_id }
      : null,
    auditEvents: (auditEvents.data ?? []).map((event) => ({
      id: event.id,
      action: event.action,
      entity_type: event.entity_type,
      entity_id: event.entity_id,
      created_at: event.created_at,
      payload: event.payload,
    })),
  });
  assertDealRunAuditPackageValid(pkg);
  return pkg;
}
