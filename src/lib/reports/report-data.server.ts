// Loads every table a report can draw on, for one project, in a single pass.
// A failed table query is an ERROR (thrown with a clear message): never a
// silently-empty array: so a report is never built against partial data.

import {
  validatePersistedAssumptionUnits,
  validateFinancialOutputUnits,
  type UnitContractIssue,
} from "../unit-contracts";

export type ReportData = {
  project: Record<string, any> | null;
  documents: Record<string, any>[];
  assumptions: Record<string, any>[];
  assumptionVersions: Record<string, any>[];
  engineInputs: Record<string, any>[];
  budget: Record<string, any>[];
  revenue: Record<string, any>[];
  outputs: Record<string, any>[];
  cashFlows: Record<string, any>[];
  flags: Record<string, any>[];
  risks: Record<string, any>[];
  memos: Record<string, any>[];
  decisions: Record<string, any>[];
  auditLogs: Record<string, any>[];
  scenarios: Record<string, any>[];
  // Unit-contract drift surfaced (non-blocking) at the DB-read / report-build
  // boundary: a persisted assumption whose stored unit no longer matches the
  // taxonomy, or a financial output emitting a non-canonical unit. Empty in the
  // healthy case; a report builder / UI can show it for review.
  unitContractIssues: UnitContractIssue[];
};

export async function loadReportData(supabase: any, projectId: string): Promise<ReportData> {
  const pid = projectId;
  const need = async (label: string, q: any) => {
    const { data, error } = await q;
    if (error) throw new Error(`Report data load failed for ${label}: ${error.message}`);
    return data ?? [];
  };

  const projectRes = await supabase.from("projects").select("*").eq("id", pid).maybeSingle();
  if (projectRes.error)
    throw new Error(`Report data load failed for project: ${projectRes.error.message}`);

  const [
    documents,
    assumptions,
    engineInputs,
    budget,
    revenue,
    outputs,
    cashFlows,
    flags,
    risks,
    memos,
    decisions,
    auditLogs,
    scenarios,
  ] = await Promise.all([
    need(
      "documents",
      supabase
        .from("documents")
        .select("*")
        .eq("project_id", pid)
        .order("upload_date", { ascending: false }),
    ),
    need(
      "assumptions",
      supabase
        .from("assumptions")
        .select("*, documents:source_document_id(name)")
        .eq("project_id", pid)
        .order("category")
        .order("field_label"),
    ),
    need(
      "underwriting_inputs",
      supabase.from("underwriting_inputs").select("*").eq("project_id", pid),
    ),
    need(
      "development_budget",
      supabase.from("development_budget").select("*").eq("project_id", pid),
    ),
    need("revenue_program", supabase.from("revenue_program").select("*").eq("project_id", pid)),
    need("financial_outputs", supabase.from("financial_outputs").select("*").eq("project_id", pid)),
    need("cash_flows", supabase.from("cash_flows").select("*").eq("project_id", pid).limit(800)),
    need(
      "reconciliation_flags",
      supabase.from("reconciliation_flags").select("*").eq("project_id", pid),
    ),
    need(
      "risk_register",
      supabase
        .from("risk_register")
        .select("*")
        .eq("project_id", pid)
        .order("severity", { ascending: false }),
    ),
    need(
      "investment_memos",
      supabase
        .from("investment_memos")
        .select("*")
        .eq("project_id", pid)
        .order("created_at", { ascending: false }),
    ),
    need(
      "decision_logs",
      supabase
        .from("decision_logs")
        .select("*")
        .eq("project_id", pid)
        .order("created_at", { ascending: false }),
    ),
    need(
      "audit_logs",
      supabase
        .from("audit_logs")
        .select("*")
        .eq("project_id", pid)
        .order("created_at", { ascending: false })
        .limit(200),
    ),
    need("scenarios", supabase.from("scenarios").select("*").eq("project_id", pid)),
  ]);

  // assumption_versions is keyed by assumption_id (no project_id), so fetch it
  // for this project's assumptions after they load.
  const assumptionIds = assumptions.map((a: any) => a.id).filter(Boolean);
  const assumptionVersions = assumptionIds.length
    ? await need(
        "assumption_versions",
        supabase.from("assumption_versions").select("*").in("assumption_id", assumptionIds),
      )
    : [];

  // Unit-contract validation at the boundary (non-blocking): only assumptions
  // that actually carry a stored unit are checked (a null unit predates the
  // unit column and is not drift); financial outputs are checked for canonical
  // units. Never throws -- a report still builds, with the issues surfaced.
  const unitContractIssues: UnitContractIssue[] = [
    ...validatePersistedAssumptionUnits(
      (assumptions as any[])
        .filter((a) => typeof a.unit === "string" && a.unit.length > 0)
        .map((a) => ({ field_key: a.field_key, unit: a.unit })),
    ),
    ...validateFinancialOutputUnits(
      (outputs as any[]).map((o) => ({ key: o.metric_key, unit: o.unit })),
    ),
  ];

  return {
    project: projectRes.data ?? null,
    documents,
    assumptions,
    assumptionVersions,
    engineInputs,
    budget,
    revenue,
    outputs,
    cashFlows,
    flags,
    risks,
    memos,
    decisions,
    auditLogs,
    scenarios,
    unitContractIssues,
  };
}
