// Portfolio aggregation: produces the institutional decision view across all
// deals in one call: pipeline stage, Investment Score, Confidence Score, risk
// rating and recommendation per deal, computed server-side from the same
// deterministic engine outputs the deal page uses.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildDecision,
  pipelineStageFor,
  type PipelineStage,
  type DecisionSummary,
  type OutputRow,
  type AssumptionRow,
} from "./decision";
import type { ComparisonDeal } from "./reports/comparison-model";
import type { DecisionHistoryRow } from "./reports/portfolio-analytics";
import { isMissingRelation } from "./db-compat";
import type { Database } from "@/integrations/supabase/types";

type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];

export function portfolioOutputsAreCurrent(freshness: string | null | undefined): boolean {
  return freshness === "current";
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  run: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await run(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

// The financial_outputs / assumptions columns `inputs` and `conflict_values`
// are stored as untyped `Json` in the DB schema, but the deterministic decision
// layer reads them through the narrower structured shapes on OutputRow /
// AssumptionRow. These map the selected rows to those shapes (the structured
// JSON overlaps Json, so this is a type-only narrowing: values are unchanged and
// the decision layer reads every field defensively).
type SelectedOutputRow = {
  project_id: string;
  scenario_key: string;
  metric_key: string;
  metric_label: string | null;
  value_numeric: number | null;
  unit: string | null;
  formula_text: string | null;
  inputs: Database["public"]["Tables"]["financial_outputs"]["Row"]["inputs"];
};
type SelectedAssumptionRow = Pick<
  Database["public"]["Tables"]["assumptions"]["Row"],
  | "project_id"
  | "field_key"
  | "field_label"
  | "category"
  | "value_numeric"
  | "value_text"
  | "unit"
  | "status"
  | "source_document_id"
  | "source_text"
  | "source_location"
  | "confidence_score"
  | "conflict_values"
>;
const toOutputRow = (r: SelectedOutputRow): OutputRow => ({
  ...r,
  inputs: r.inputs as OutputRow["inputs"],
});
const toAssumptionRow = (r: SelectedAssumptionRow): AssumptionRow => ({
  ...r,
  conflict_values: r.conflict_values as AssumptionRow["conflict_values"],
});

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
  underwritingFreshness?: "current" | "stale" | "blocked" | "pending";
};

function capitalFor(project: ProjectRow, base: Record<string, number>): number {
  if (base.total_project_cost) return base.total_project_cost;
  const acq = Number(project.acquisition_cost || 0);
  const con = Number(project.construction_cost || 0);
  if (acq + con > 0) return acq + con;
  return Number(project.revenue_forecast || 0);
}

// What the deal is waiting on: surfaced in the Investment Queue.
function nextActionFor(stage: PipelineStage, dec: DecisionSummary): string | null {
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
    if (error) throw new Error(error.message);
    if (!projects?.length) return [];

    const ids = projects.map((p) => p.id);
    const [outputsResult, assumptionsResult, decisionsResult, docsResult] = await Promise.all([
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
        .in("project_id", ids)
        .in("status", ["approved", "modified", "default_accepted", "calculated"])
        .eq("dual_control_pending", false),
      context.supabase
        .from("decision_logs")
        .select("project_id,decision,created_at")
        .in("project_id", ids)
        .order("created_at", { ascending: false }),
      context.supabase.from("documents").select("project_id").in("project_id", ids),
    ]);
    for (const [label, result] of [
      ["financial outputs", outputsResult],
      ["assumptions", assumptionsResult],
      ["decision history", decisionsResult],
      ["documents", docsResult],
    ] as const) {
      if (result.error)
        throw new Error(`Portfolio failed loading ${label}: ${result.error.message}`);
    }
    const outputs = outputsResult.data;
    const assumptions = assumptionsResult.data;
    const decisions = decisionsResult.data;
    const docs = docsResult.data;
    const { getUnderwritingRunStateForContext } = await import("./underwriting.server");
    const runStates = await mapWithConcurrency(ids, 6, (project_id) =>
      getUnderwritingRunStateForContext({ data: { project_id }, context }),
    );
    const freshnessByProject = new Map(
      runStates.map((state) => [state.project_id, state.freshness] as const),
    );

    const byProject = <T extends { project_id: string | null }>(rows: T[] | null) => {
      const m = new Map<string | null, T[]>();
      for (const r of rows ?? []) {
        const arr = m.get(r.project_id);
        if (arr) arr.push(r);
        else m.set(r.project_id, [r]);
      }
      return m;
    };
    const outMap = byProject(outputs);
    const asmMap = byProject(assumptions);
    const decMap = byProject(decisions);
    const docMap = byProject(docs);

    return projects.map((p) => {
      const o = outMap.get(p.id) ?? [];
      const a = asmMap.get(p.id) ?? [];
      const d = decMap.get(p.id) ?? [];
      const docCount = (docMap.get(p.id) ?? []).length;
      const underwritingFreshness = (freshnessByProject.get(p.id) ?? "pending") as NonNullable<
        DealSummary["underwritingFreshness"]
      >;
      const outputsAreCurrent = portfolioOutputsAreCurrent(underwritingFreshness);
      const dec = buildDecision(
        (outputsAreCurrent ? o : []).map(toOutputRow),
        a.map(toAssumptionRow),
      );
      const recommendation = outputsAreCurrent ? dec.recommendation : "RETURN_TO_UNDERWRITING";
      const decisionForStage = { ...dec, recommendation };
      const stage = pipelineStageFor({
        status: p.status,
        docCount,
        hasUnderwriting: outputsAreCurrent && dec.hasUnderwriting,
        decisions: d,
      });
      const topRisk =
        !outputsAreCurrent && underwritingFreshness === "stale"
          ? "Underwriting is stale; re-run before relying on this decision."
          : (dec.findings?.risks?.[0]?.title ?? dec.findings?.weaknesses?.[0]?.title ?? null);
      return {
        id: p.id,
        name: p.name,
        location: p.location ?? null,
        type: p.type,
        status: p.status,
        stage,
        capital: capitalFor(p, dec.norm.base),
        recommendation,
        recommendationLabel: outputsAreCurrent ? dec.recommendationLabel : "Return to Underwriting",
        investmentScore: outputsAreCurrent ? dec.investmentScore : null,
        confidenceScore: dec.confidenceScore,
        riskRating: dec.riskRating,
        hasUnderwriting: outputsAreCurrent && dec.hasUnderwriting,
        topRisk,
        nextAction: nextActionFor(stage, decisionForStage),
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
        irr: outputsAreCurrent ? (dec.norm.base.irr_estimate ?? null) : null,
        dscr: outputsAreCurrent ? (dec.norm.base.dscr ?? null) : null,
        underwritingFreshness,
      };
    });
  });

// Side-by-side comparison for a chosen set of deals. Reuses the SAME
// deterministic decision layer as the portfolio + deal page: no metric is
// recomputed here, only selected from norm.base / norm.worstStress / findings.
export const compareDeals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1).max(6) }).parse(d))
  .handler(async ({ data, context }): Promise<ComparisonDeal[]> => {
    const ids = data.ids;
    const { data: projects, error } = await context.supabase
      .from("projects")
      .select("*")
      .in("id", ids);
    if (error) throw new Error(error.message);
    if (!projects?.length) return [];

    const [outputsResult, assumptionsResult] = await Promise.all([
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
        .in("project_id", ids)
        .in("status", ["approved", "modified", "default_accepted", "calculated"])
        .eq("dual_control_pending", false),
    ]);
    if (outputsResult.error)
      throw new Error(
        `Deal comparison failed loading financial outputs: ${outputsResult.error.message}`,
      );
    if (assumptionsResult.error)
      throw new Error(
        `Deal comparison failed loading assumptions: ${assumptionsResult.error.message}`,
      );
    const outputs = outputsResult.data;
    const assumptions = assumptionsResult.data;
    const { getUnderwritingRunStateForContext } = await import("./underwriting.server");
    const runStates = await mapWithConcurrency(ids, 6, (project_id) =>
      getUnderwritingRunStateForContext({ data: { project_id }, context }),
    );
    const currentProjects = new Set(
      runStates.filter((state) => state.freshness === "current").map((state) => state.project_id),
    );

    const out = new Map<string, SelectedOutputRow[]>();
    const asm = new Map<string, SelectedAssumptionRow[]>();
    for (const r of outputs ?? [])
      (out.get(r.project_id) ?? out.set(r.project_id, []).get(r.project_id)!).push(r);
    for (const r of assumptions ?? [])
      (asm.get(r.project_id) ?? asm.set(r.project_id, []).get(r.project_id)!).push(r);

    // Preserve the requested order so the grid is stable.
    const byId = new Map(projects.map((p) => [p.id, p]));
    return ids
      .map((id) => byId.get(id))
      .filter((p): p is ProjectRow => Boolean(p))
      .map((p) => {
        const outputsAreCurrent = currentProjects.has(p.id);
        const o = outputsAreCurrent ? (out.get(p.id) ?? []) : [];
        const a = asm.get(p.id) ?? [];
        const dec = buildDecision(o.map(toOutputRow), a.map(toAssumptionRow));
        const findings = dec.findings;
        const keyFindings = [
          ...(findings?.criticalFindings ?? []),
          ...(findings?.highPriorityFindings ?? []),
        ]
          .slice(0, 3)
          .map((f) => f.title);
        const dataGaps = a.filter(
          (x) => x.status === "missing" || x.status === "conflicting",
        ).length;
        return {
          id: p.id,
          name: p.name,
          type: p.type,
          location: p.location ?? null,
          hasUnderwriting: outputsAreCurrent && dec.hasUnderwriting,
          recommendation: outputsAreCurrent ? dec.recommendation : "RETURN_TO_UNDERWRITING",
          recommendationLabel: outputsAreCurrent
            ? dec.recommendationLabel
            : "Return to Underwriting",
          riskRating: dec.riskRating,
          investmentScore: outputsAreCurrent ? dec.investmentScore : null,
          confidenceScore: dec.confidenceScore,
          capital: capitalFor(p, dec.norm.base),
          irr: outputsAreCurrent ? (dec.norm.base.irr_estimate ?? null) : null,
          equityMultiple: outputsAreCurrent ? (dec.norm.base.equity_multiple ?? null) : null,
          dscr: outputsAreCurrent ? (dec.norm.base.dscr ?? null) : null,
          yieldOnCost: outputsAreCurrent ? (dec.norm.base.yield_on_cost ?? null) : null,
          exitCap: outputsAreCurrent ? (dec.norm.base.exit_cap_rate_pct ?? null) : null,
          worstStressDscr: outputsAreCurrent ? (dec.norm.worstStress.dscr ?? null) : null,
          worstStressEm: outputsAreCurrent ? (dec.norm.worstStress.equity_multiple ?? null) : null,
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
    return (data ?? []).map((d) => ({
      project_id: d.project_id,
      deal_name: d.projects?.name ?? "Not available",
      decision: d.decision,
      rationale: d.rationale ?? null,
      conditions: d.conditions ?? null,
      user_name: d.user_name ?? null,
      created_at: d.created_at,
    }));
  });
