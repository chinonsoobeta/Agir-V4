import { emitOperationalMetric } from "./observability.server";

export type AuditChainVerificationResult = {
  projectId: string;
  workspaceId: string | null;
  valid: boolean;
  reason: string | null;
  total: number;
  headHash: string | null;
};

export async function verifyProjectAuditChain(
  supabase: any,
  project: { id: string; workspace_id: string | null },
  checkedBy = "system",
): Promise<AuditChainVerificationResult> {
  const { data, error } = await supabase.rpc("verify_audit_chain", { p_project: project.id });
  if (error) throw new Error(error.message);
  const payload = data as {
    valid?: boolean;
    reason?: string | null;
    total?: number;
    head_hash?: string | null;
  };
  const result: AuditChainVerificationResult = {
    projectId: project.id,
    workspaceId: project.workspace_id,
    valid: Boolean(payload.valid),
    reason: payload.reason ?? null,
    total: Number(payload.total ?? 0),
    headHash: payload.head_hash ?? null,
  };
  const insert = await supabase.from("audit_chain_verifications").insert({
    workspace_id: result.workspaceId,
    project_id: result.projectId,
    valid: result.valid,
    reason: result.reason,
    total: result.total,
    head_hash: result.headHash,
    checked_by: checkedBy,
  });
  if (insert.error && insert.error.code !== "42P01") throw new Error(insert.error.message);
  emitOperationalMetric("audit_chain.verified", 1, {
    projectId: result.projectId,
    valid: result.valid,
    reason: result.reason,
  });
  return result;
}

export async function verifyAllProjectAuditChains(
  supabase: any,
  checkedBy = "system",
): Promise<AuditChainVerificationResult[]> {
  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, workspace_id")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const results: AuditChainVerificationResult[] = [];
  for (const project of projects ?? []) {
    results.push(await verifyProjectAuditChain(supabase, project, checkedBy));
  }
  return results;
}
