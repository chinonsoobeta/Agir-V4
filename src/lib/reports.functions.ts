// Reports server functions: readiness checks and deterministic report
// generation. Reports are built ONLY from approved/calculated/default-accepted
// inputs and deterministic engine outputs; every generated report runs numeric
// provenance verification and is persisted to generated_reports.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { verifyNumericProvenance } from "./engine";
import { memoReportText } from "./memo-report";
import { REPORT_BY_TYPE, REPORT_TYPES, type ReportType } from "./reports/report-definitions";

const ReportTypeSchema = z.enum([
  "investor_report",
  "lender_package",
  "executive_summary",
  "internal_team_report",
]);

async function countRows(
  supabase: any,
  table: string,
  projectId: string,
  filters?: (q: any) => any,
): Promise<number> {
  let q = supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId);
  if (filters) q = filters(q);
  const { count, error } = await q;
  if (error) throw new Error(`Report readiness failed counting ${table}: ${error.message}`);
  return count ?? 0;
}

export const getReportReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { project_id: string; report_type: ReportType }) =>
    z.object({ project_id: z.string().uuid(), report_type: ReportTypeSchema }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { project_id, report_type } = data;
    const def = REPORT_BY_TYPE[report_type];

    const { data: project, error: pErr } = await context.supabase
      .from("projects")
      .select("id,name,status")
      .eq("id", project_id)
      .maybeSingle();
    if (pErr) throw new Error(`Report readiness failed loading project: ${pErr.message}`);

    const empty = {
      documents: 0,
      assumptions: 0,
      approved_assumptions: 0,
      default_accepted_inputs: 0,
      financial_outputs: 0,
      base_outputs: 0,
      cash_flows: 0,
      reconciliation_errors: 0,
      reconciliation_warnings: 0,
      risks: 0,
      memos: 0,
      decisions: 0,
    };
    if (!project) {
      return {
        project_id,
        report_type,
        ready: false,
        status: "missing_project" as const,
        blocking_reasons: ["No project found."],
        warnings: [],
        counts: empty,
        latest_generated_at: null,
      };
    }

    const { data: outputs, error: oErr } = await context.supabase
      .from("financial_outputs")
      .select("scenario_key,metric_key")
      .eq("project_id", project_id);
    if (oErr) throw new Error(`Report readiness failed loading financial_outputs: ${oErr.message}`);
    const baseOutputs = (outputs ?? []).filter((o: any) => o.scenario_key === "base").length;

    const { data: flags, error: fErr } = await context.supabase
      .from("reconciliation_flags")
      .select("severity,resolved")
      .eq("project_id", project_id);
    if (fErr)
      throw new Error(`Report readiness failed loading reconciliation_flags: ${fErr.message}`);
    const reconErrors = (flags ?? []).filter(
      (f: any) => f.severity === "error" && !f.resolved,
    ).length;
    const reconWarnings = (flags ?? []).filter(
      (f: any) => f.severity === "warning" && !f.resolved,
    ).length;

    const counts = {
      documents: await countRows(context.supabase, "documents", project_id),
      assumptions: await countRows(context.supabase, "assumptions", project_id),
      approved_assumptions: await countRows(context.supabase, "assumptions", project_id, (q) =>
        q.in("status", ["approved", "modified", "calculated", "default_accepted"]),
      ),
      default_accepted_inputs: await countRows(
        context.supabase,
        "underwriting_inputs",
        project_id,
        (q) => q.eq("status", "default_accepted"),
      ),
      financial_outputs: outputs?.length ?? 0,
      base_outputs: baseOutputs,
      cash_flows: await countRows(context.supabase, "cash_flows", project_id),
      reconciliation_errors: reconErrors,
      reconciliation_warnings: reconWarnings,
      risks: await countRows(context.supabase, "risk_register", project_id),
      memos: await countRows(context.supabase, "investment_memos", project_id),
      decisions: await countRows(context.supabase, "decision_logs", project_id),
    };

    const { data: latest } = await context.supabase
      .from("generated_reports")
      .select("generated_at")
      .eq("project_id", project_id)
      .eq("report_type", report_type)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { computeReportStatus } = await import("./reports/report-common");
    const decision = computeReportStatus(def, {
      projectExists: true,
      baseOutputs,
      financialOutputs: counts.financial_outputs,
      reconErrors,
    });

    return {
      project_id,
      report_type,
      ready: decision.ready,
      status: decision.status,
      blocking_reasons: decision.blocking_reasons,
      warnings: decision.warnings,
      counts,
      latest_generated_at: latest?.generated_at ?? null,
      project_name: project.name,
      project_status: project.status,
    };
  });

export const generateReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { project_id: string; report_type: ReportType }) =>
    z.object({ project_id: z.string().uuid(), report_type: ReportTypeSchema }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { enforceRateLimit } = await import("./rate-limit.server");
    await enforceRateLimit(context, "report_generation", {
      metadata: { project_id: data.project_id, report_type: data.report_type },
    });
    const def = REPORT_BY_TYPE[data.report_type];

    const { loadReportData } = await import("./reports/report-data.server");
    const reportData = await loadReportData(context.supabase, data.project_id);
    if (!reportData.project) throw new Error("Project not found.");

    const baseOutputs = reportData.outputs.filter((o: any) => o.scenario_key === "base").length;
    if (def.requiresUnderwriting && baseOutputs === 0) {
      throw new Error("Run deterministic underwriting before generating this report.");
    }

    const { buildReport } = await import("./reports/report-builders");
    const { deriveCore, reportAllowedValues, generationLabel } =
      await import("./reports/report-common");
    const report = buildReport(data.report_type, reportData, { generatedLabel: generationLabel() });

    // Numeric provenance: never blocks; failing reports are saved needs_review.
    const allowed = reportAllowedValues(
      reportData,
      deriveCore(reportData),
      report.derived_values ?? [],
    );
    const provenance = verifyNumericProvenance(memoReportText(report), allowed);
    const generatedAt = new Date().toISOString();
    const { buildReportProvenanceManifest } = await import("./reports/provenance-manifest");
    const provenance_manifest = buildReportProvenanceManifest({
      reportType: data.report_type,
      report,
      provenance,
      generatedAt,
    });
    report.provenance_manifest = provenance_manifest;
    const verification_report = {
      report_type: data.report_type,
      pass: provenance.pass,
      token_count: provenance.tokenCount,
      orphans: provenance.orphans,
      verified_at: new Date().toISOString(),
      manifest: provenance_manifest,
    };
    const status = provenance.pass ? "generated" : "needs_review";

    const { data: row, error: insErr } = await context.supabase
      .from("generated_reports")
      .insert({
        project_id: data.project_id,
        owner_id: context.userId,
        report_type: data.report_type,
        title: report.title,
        status,
        content_json: { ...report, needs_review: !provenance.pass, provenance_manifest },
        verification_report,
        generated_at: generatedAt,
      })
      .select("id")
      .single();
    if (insErr)
      throw new Error(`Report generation failed saving generated_reports: ${insErr.message}`);

    // Activity log is best-effort and must never fail report generation.
    await context.supabase.from("activities").insert({
      project_id: data.project_id,
      user_id: context.userId,
      activity_type: "report_generated",
      description: `Generated ${def.title}${provenance.pass ? " (provenance verified)" : `: NEEDS REVIEW: ${provenance.orphans.length} token(s) lack provenance`}`,
    });

    return {
      generated_report_id: row?.id ?? null,
      report,
      status,
      needs_review: !provenance.pass,
      verification_report,
      generated_at: generatedAt,
    };
  });

export const REPORT_TYPE_LIST = REPORT_TYPES;
