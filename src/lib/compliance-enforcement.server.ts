import { emitOperationalMetric } from "./observability.server";

export type ComplianceRunType = "retention" | "deletion" | "residency" | "dr_drill";
export type ComplianceEnforcementRun = {
  workspaceId: string | null;
  runType: ComplianceRunType;
  status: "passed" | "failed" | "dry_run";
  summary: string;
  evidence: Record<string, unknown>;
};

async function recordRun(
  supabase: any,
  run: ComplianceEnforcementRun,
  runBy = "system",
): Promise<void> {
  const { error } = await supabase.from("compliance_enforcement_runs").insert({
    workspace_id: run.workspaceId,
    run_type: run.runType,
    status: run.status,
    summary: run.summary,
    evidence: run.evidence,
    run_by: runBy,
  });
  if (error && error.code !== "42P01") throw new Error(error.message);
  emitOperationalMetric("compliance.enforcement_run", 1, {
    runType: run.runType,
    status: run.status,
    workspaceId: run.workspaceId,
  });
}

export async function runRetentionEnforcement(
  supabase: any,
  opts: { dryRun?: boolean; runBy?: string } = {},
): Promise<ComplianceEnforcementRun[]> {
  const { data: settings, error } = await supabase
    .from("workspace_settings")
    .select("workspace_id, audit_log_retention_days, data_residency_region");
  if (error) throw new Error(error.message);

  const runs: ComplianceEnforcementRun[] = [];
  for (const row of settings ?? []) {
    const retentionDays = Number(row.audit_log_retention_days ?? 2555);
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const auditCount = await supabase
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", row.workspace_id)
      .lt("created_at", cutoff);
    if (auditCount.error) throw new Error(auditCount.error.message);
    const staleAuditRows = auditCount.count ?? 0;
    const run: ComplianceEnforcementRun = {
      workspaceId: row.workspace_id,
      runType: "retention",
      status: opts.dryRun ? "dry_run" : staleAuditRows === 0 ? "passed" : "failed",
      summary:
        staleAuditRows === 0
          ? `No audit rows exceed the ${retentionDays}-day retention policy.`
          : `${staleAuditRows} audit rows exceed the ${retentionDays}-day retention policy.`,
      evidence: {
        cutoff,
        retentionDays,
        staleAuditRows,
        dataResidencyRegion: row.data_residency_region ?? null,
        action: opts.dryRun ? "reported_only" : "manual_review_required",
      },
    };
    await recordRun(supabase, run, opts.runBy);
    runs.push(run);
  }
  return runs;
}

export async function runDeletionRequestEnforcement(
  supabase: any,
  opts: { dryRun?: boolean; runBy?: string } = {},
): Promise<ComplianceEnforcementRun> {
  const { data, error } = await supabase
    .from("data_governance_requests")
    .select("id, workspace_id, due_at")
    .eq("request_type", "deletion")
    .in("status", ["open", "in_review"])
    .lt("due_at", new Date().toISOString());
  if (error) throw new Error(error.message);
  const overdue = data ?? [];
  const run: ComplianceEnforcementRun = {
    workspaceId: null,
    runType: "deletion",
    status: opts.dryRun ? "dry_run" : overdue.length === 0 ? "passed" : "failed",
    summary:
      overdue.length === 0
        ? "No overdue deletion requests."
        : `${overdue.length} deletion requests are overdue.`,
    evidence: {
      overdueRequestIds: overdue.map((request: { id: string }) => request.id),
      action: opts.dryRun ? "reported_only" : "operator_follow_up_required",
    },
  };
  await recordRun(supabase, run, opts.runBy);
  return run;
}
