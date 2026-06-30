// Loads every table a report can draw on, for one project, in a single pass.
// A failed table query is an ERROR (thrown with a clear message): never a
// silently-empty array: so a report is never built against partial data.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  validatePersistedAssumptionUnits,
  validateFinancialOutputUnits,
  type UnitContractIssue,
} from "../unit-contracts";

type Tbl<K extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][K]["Row"];

export type ProjectRow = Tbl<"projects">;
export type DocumentRow = Tbl<"documents">;
// assumptions are selected with a joined source-document name.
export type AssumptionRow = Tbl<"assumptions"> & { documents: { name: string } | null };
export type AssumptionVersionRow = Tbl<"assumption_versions">;
export type EngineInputRow = Tbl<"underwriting_inputs">;
export type BudgetRow = Tbl<"development_budget">;
export type RevenueRow = Tbl<"revenue_program">;
export type OutputRow = Tbl<"financial_outputs">;
export type CashFlowRow = Tbl<"cash_flows">;
export type FlagRow = Tbl<"reconciliation_flags">;
export type RiskRow = Tbl<"risk_register">;
export type MemoRow = Tbl<"investment_memos">;
export type DecisionRow = Tbl<"decision_logs">;
export type AuditRow = Tbl<"audit_logs">;
export type ScenarioRow = Tbl<"scenarios">;

export type ReportData = {
  project: ProjectRow | null;
  documents: DocumentRow[];
  assumptions: AssumptionRow[];
  assumptionVersions: AssumptionVersionRow[];
  engineInputs: EngineInputRow[];
  budget: BudgetRow[];
  revenue: RevenueRow[];
  outputs: OutputRow[];
  cashFlows: CashFlowRow[];
  flags: FlagRow[];
  risks: RiskRow[];
  memos: MemoRow[];
  decisions: DecisionRow[];
  auditLogs: AuditRow[];
  scenarios: ScenarioRow[];
  // Unit-contract drift surfaced (non-blocking) at the DB-read / report-build
  // boundary: a persisted assumption whose stored unit no longer matches the
  // taxonomy, or a financial output emitting a non-canonical unit. Empty in the
  // healthy case; a report builder / UI can show it for review.
  unitContractIssues: UnitContractIssue[];
};

export async function loadReportData(
  supabase: SupabaseClient<Database>,
  projectId: string,
): Promise<ReportData> {
  const pid = projectId;
  const need = async (
    label: string,
    q: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  ): Promise<unknown[]> => {
    const { data, error } = await q;
    if (error) throw new Error(`Report data load failed for ${label}: ${error.message}`);
    return (data as unknown[] | null) ?? [];
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
  const assumptionIds = (assumptions as AssumptionRow[]).map((a) => a.id).filter(Boolean);
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
      (assumptions as AssumptionRow[])
        .filter((a) => typeof a.unit === "string" && a.unit.length > 0)
        .map((a) => ({ field_key: a.field_key, unit: a.unit as string })),
    ),
    // validateFinancialOutputUnits inspects units at runtime (isCanonicalUnit
    // accepts unknown); the DB stores unit as a free string|null, so assert it
    // to the validator's canonical-union param shape at this boundary.
    ...validateFinancialOutputUnits(
      (outputs as OutputRow[]).map((o) => ({
        key: o.metric_key,
        unit: o.unit,
      })) as unknown as Parameters<typeof validateFinancialOutputUnits>[0],
    ),
  ];

  return {
    project: projectRes.data ?? null,
    documents: documents as DocumentRow[],
    assumptions: assumptions as AssumptionRow[],
    assumptionVersions: assumptionVersions as AssumptionVersionRow[],
    engineInputs: engineInputs as EngineInputRow[],
    budget: budget as BudgetRow[],
    revenue: revenue as RevenueRow[],
    outputs: outputs as OutputRow[],
    cashFlows: cashFlows as CashFlowRow[],
    flags: flags as FlagRow[],
    risks: risks as RiskRow[],
    memos: memos as MemoRow[],
    decisions: decisions as DecisionRow[],
    auditLogs: auditLogs as AuditRow[],
    scenarios: scenarios as ScenarioRow[],
    unitContractIssues,
  };
}
