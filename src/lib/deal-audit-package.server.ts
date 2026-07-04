import "@tanstack/react-start/server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildDealRunAuditPackage } from "./customer-audit-package";
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
  const defaultAcceptedInputs = approvedInputs.filter(
    (row) =>
      typeof row === "object" &&
      row != null &&
      (row as { status?: unknown }).status === "default_accepted",
  );
  const staticDefaultsUsed = Array.isArray(runRow.accepted_defaults_used)
    ? runRow.accepted_defaults_used
    : [];

  return buildDealRunAuditPackage({
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
    approvedInputs,
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
}
