// Portfolio aggregation: produces the institutional decision view across all
// deals in one call: pipeline stage, Investment Score, Confidence Score, risk
// rating and recommendation per deal, computed server-side from the same
// deterministic engine outputs the deal page uses.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildDecision, pipelineStageFor, type PipelineStage } from "./decision";
import type { ComparisonDeal } from "./reports/comparison-model";
import type { DecisionHistoryRow } from "./reports/portfolio-analytics";
import { isMissingRelation } from "./db-compat";

export type DealSummary = {
  id: string;
  name: string;
  location: string | null;
  type: string;
  status: string;
  stage: PipelineStage;
  capital: number;
  recommendation: string;
  recommendationLabel: string;
  investmentScore: number | null;
  confidenceScore: number;
  riskRating: string;
  hasUnderwriting: boolean;
  topRisk: string | null;
  nextAction: string | null;
  decisionCount: number;
  docCount: number;
  startDate: string | null;
  targetCloseDate: string | null;
  updatedAt: string;
  source: string | null;
  probability: number;
  irr: number | null;
  dscr: number | null;
};

function capitalFor(project: any, base: Record<string, number>): number {
  if (base.total_project_cost) return base.total_project_cost;
  const acq = Number(project.acquisition_cost || 0);
  const con = Number(project.construction_cost || 0);
  if (acq + con > 0) return acq + con;
  return Number(project.revenue_forecast || 0);
}

// What the deal is waiting on: surfaced in the Investment Queue.
function nextActionFor(stage: PipelineStage, dec: any): string | null {
  switch (stage) {
    case "Screening":
      return "Begin Document Review";
    case "Document Review":
      return "Awaiting Document Review";
    case "Underwriting":
      return "Complete Underwriting";
    case "Investment Committee":
      return dec.recommendation === "REJECT"
        ? "Return to Underwriting"
        : dec.recommendation === "APPROVE_WITH_CONDITIONS"
          ? "Approve with Conditions"
          : dec.recommendation === "RETURN_TO_UNDERWRITING"
            ? "Return to Underwriting"
            : "Present to Committee";
    default:
      return null;
  }
}

export const listPortfolio = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DealSummary[]> => {
    const { data: projects, error } = await context.supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });
    // If table doesn't exist (schema not migrated), return empty array instead of error
    if (error && error.message?.includes("Could not find the table")) return [];
    if (error) throw new Error(error.message);
    if (!projects?.length) return [];

    const ids = projects.map((p: any) => p.id);
    const [{ data: outputs }, { data: assumptions }, { data: decisions }, { data: docs }] =
      await Promise.all([
        context.supabase
          .from("financial_outputs")
          .select(
            "project_id,scenario_key,metric_key,metric_label,value_numeric,unit,formula_text,inputs",
          )
          .in("project_id", ids),
        context.supabase
          .from("assumptions")
          .select(
            "project_id,field_key,field_label,category,value_numeric,value_text,unit,status,source_document_id,source_text,source_location,confidence_score,conflict_values",
          )
          .in("project_id", ids),
        context.supabase
          .from("decision_logs")
          .select("project_id,decision,created_at")
          .in("project_id", ids)
          .order("created_at", { ascending: false }),
        context.supabase.from("documents").select("project_id").in("project_id", ids),
      ]);

    const byProject = <T extends { project_id: string }>(rows: T[] | null) => {
      const m = new Map<string, T[]>();
      for (const r of rows ?? []) {
        const arr = m.get(r.project_id);
        if (arr) arr.push(r);
        else m.set(r.project_id, [r]);
      }
      return m;
    };
    const outMap = byProject(outputs as any);
    const asmMap = byProject(assumptions as any);
    const decMap = byProject(decisions as any);
    const docMap = byProject(docs as any);

    return projects.map((p: any) => {
      const o = outMap.get(p.id) ?? [];
      const a = asmMap.get(p.id) ?? [];
      const d = decMap.get(p.id) ?? [];
      const docCount = (docMap.get(p.id) ?? []).length;
      const dec = buildDecision(o as any, a as any);
      const stage = pipelineStageFor({
        status: p.status,
        docCount,
        hasUnderwriting: dec.hasUnderwriting,
        decisions: d as any,
      });
      const topRisk =
        dec.findings?.risks?.[0]?.title ?? dec.findings?.weaknesses?.[0]?.title ?? null;
      return {
        id: p.id,
        name: p.name,
        location: p.location ?? null,
        type: p.type,
        status: p.status,
        stage,
        capital: capitalFor(p, dec.norm.base),
        recommendation: dec.recommendation,
        recommendationLabel: dec.recommendationLabel,
        investmentScore: dec.investmentScore,
        confidenceScore: dec.confidenceScore,
        riskRating: dec.riskRating,
        hasUnderwriting: dec.hasUnderwriting,
        topRisk,
        nextAction: nextActionFor(stage, dec),
        decisionCount: d.length,
        docCount,
        startDate: p.start_date ?? null,
        targetCloseDate: p.target_close_date ?? p.completion_date ?? null,
        updatedAt: p.updated_at,
        source: p.source ?? null,
        probability: Number(
          p.probability ??
            (stage === "Approved"
              ? 100
              : stage === "Investment Committee"
                ? 75
                : stage === "Underwriting"
                  ? 50
                  : 25),
        ),
        irr: dec.norm.base.irr_estimate ?? null,
        dscr: dec.norm.base.dscr ?? null,
      };
    });
  });

// Side-by-side comparison for a chosen set of deals. Reuses the SAME
// deterministic decision layer as the portfolio + deal page: no metric is
// recomputed here, only selected from norm.base / norm.worstStress / findings.
export const compareDeals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ ids: z.array(z.string().uuid()).min(1).max(6) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<ComparisonDeal[]> => {
    const ids = data.ids;
    const { data: projects, error } = await context.supabase
      .from("projects")
      .select("*")
      .in("id", ids);
    if (error) throw new Error(error.message);
    if (!projects?.length) return [];

    const [{ data: outputs }, { data: assumptions }] = await Promise.all([
      context.supabase
        .from("financial_outputs")
        .select(
          "project_id,scenario_key,metric_key,metric_label,value_numeric,unit,formula_text,inputs",
        )
        .in("project_id", ids),
      context.supabase
        .from("assumptions")
        .select(
          "project_id,field_key,field_label,category,value_numeric,value_text,unit,status,source_document_id,source_text,source_location,confidence_score,conflict_values",
        )
        .in("project_id", ids),
    ]);

    const out = new Map<string, any[]>();
    const asm = new Map<string, any[]>();
    for (const r of (outputs ?? []) as any[])
      (out.get(r.project_id) ?? out.set(r.project_id, []).get(r.project_id)!).push(r);
    for (const r of (assumptions ?? []) as any[])
      (asm.get(r.project_id) ?? asm.set(r.project_id, []).get(r.project_id)!).push(r);

    // Preserve the requested order so the grid is stable.
    const byId = new Map(projects.map((p: any) => [p.id, p]));
    return ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((p: any) => {
        const o = out.get(p.id) ?? [];
        const a = asm.get(p.id) ?? [];
        const dec = buildDecision(o as any, a as any);
        const findings = dec.findings;
        const keyFindings = [
          ...(findings?.criticalFindings ?? []),
          ...(findings?.highPriorityFindings ?? []),
        ]
          .slice(0, 3)
          .map((f: any) => f.title);
        const dataGaps = a.filter(
          (x) => x.status === "missing" || x.status === "conflicting",
        ).length;
        return {
          id: p.id,
          name: p.name,
          type: p.type,
          location: p.location ?? null,
          hasUnderwriting: dec.hasUnderwriting,
          recommendation: dec.recommendation,
          recommendationLabel: dec.recommendationLabel,
          riskRating: dec.riskRating,
          investmentScore: dec.investmentScore,
          confidenceScore: dec.confidenceScore,
          capital: capitalFor(p, dec.norm.base),
          irr: dec.norm.base.irr_estimate ?? null,
          equityMultiple: dec.norm.base.equity_multiple ?? null,
          dscr: dec.norm.base.dscr ?? null,
          yieldOnCost: dec.norm.base.yield_on_cost ?? null,
          exitCap: dec.norm.base.exit_cap_rate_pct ?? null,
          worstStressDscr: dec.norm.worstStress.dscr ?? null,
          worstStressEm: dec.norm.worstStress.equity_multiple ?? null,
          keyFindings,
          dataGaps,
          targetClose: p.target_close_date ?? p.completion_date ?? null,
        };
      });
  });

// Recorded IC decisions across all deals: feeds the Decision History report.
export const listDecisionHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DecisionHistoryRow[]> => {
    const { data, error } = await context.supabase
      .from("decision_logs")
      .select("project_id,decision,rationale,conditions,user_name,created_at,projects(name)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (isMissingRelation(error)) return [];
    if (error) throw new Error(error.message);
    return (data ?? []).map((d: any) => ({
      project_id: d.project_id,
      deal_name: d.projects?.name ?? "Not available",
      decision: d.decision,
      rationale: d.rationale ?? null,
      conditions: d.conditions ?? null,
      user_name: d.user_name ?? null,
      created_at: d.created_at,
    }));
  });
