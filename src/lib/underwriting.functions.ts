// Fail-closed underwriting server functions.
//
// THE ONE ARCHITECTURAL LAW: the engine reads from exactly ONE place — the
// typed EngineInput assembled by loadEngineInput() from underwriting_inputs,
// development_budget and revenue_program rows where status ∈
// {approved, default_accepted}. No LLM call exists anywhere in the path from
// button-click to rendered metric, and the engine never receives a value that
// lacks a provenance row.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  assembleEngineInput,
  applyStress,
  computeReadiness,
  computeRiskScore,
  conservativePick,
  deriveCalculatedTdc,
  deriveRiskRegister,
  DEFAULTS,
  runReconciliationChecks,
  runUnderwriting,
  STRESS_PRESETS,
  type EngineOutput,
  type ProjectInputRows,
  type ReconciliationFlag,
  type UnderwritingInput,
} from "./engine";
import { computeInvestmentVerdict } from "./verdict";

// Taxonomy (review queue) → engine key mapping. Conflicting review-queue rows
// are surfaced to readiness through this mapping so a conflicted key blocks
// underwriting even before approval.
import { ENGINE_SCALAR_TO_TAXONOMY, TAXONOMY_TO_ENGINE_SCALAR } from "./taxonomy-engine-map";

const ProjectIdSchema = z.object({ project_id: z.string().uuid() });

// The single loader. Everything the engine sees flows through here.
async function loadProjectRows(supabase: any, projectId: string): Promise<ProjectInputRows> {
  const [{ data: scalars }, { data: budget }, { data: revenue }, { data: conflictingAssumptions }] = await Promise.all([
    supabase.from("underwriting_inputs").select("*").eq("project_id", projectId),
    supabase.from("development_budget").select("*").eq("project_id", projectId),
    supabase.from("revenue_program").select("*").eq("project_id", projectId),
    supabase.from("assumptions").select("field_key,conflict_values,status").eq("project_id", projectId).eq("status", "conflicting"),
  ]);

  const rows: ProjectInputRows = {
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
      rent_basis: r.rent_basis === "per_sf" ? ("per_sf" as const) : ("per_unit" as const),
      occupancy_pct: r.occupancy_pct == null ? null : Number(r.occupancy_pct),
      status: r.status,
    })),
  };

  // Unresolved review-queue conflicts block readiness for their engine key.
  for (const a of conflictingAssumptions ?? []) {
    const engineKey = TAXONOMY_TO_ENGINE_SCALAR[a.field_key];
    if (!engineKey) continue;
    const existing = rows.scalars.find((r) => r.key === engineKey);
    if (existing && (existing.status === "approved" || existing.status === "default_accepted")) continue;
    if (existing) {
      existing.status = "conflicting";
      existing.conflict_values = a.conflict_values ?? existing.conflict_values;
    } else {
      rows.scalars.push({ key: engineKey, value_numeric: null, status: "conflicting", conflict_values: a.conflict_values ?? null });
    }
  }

  return rows;
}

export async function loadEngineInput(supabase: any, projectId: string): Promise<UnderwritingInput> {
  return assembleEngineInput(await loadProjectRows(supabase, projectId));
}

function scalarValue(rows: ProjectInputRows, key: string): number | null {
  const row = rows.scalars.find(
    (r) => r.key === key && (r.status === "approved" || r.status === "default_accepted") && r.value_numeric != null,
  );
  return row?.value_numeric ?? null;
}

function buildReconciliationContext(rows: ProjectInputRows, input: UnderwritingInput, output: EngineOutput) {
  const perUnitCounts = rows.revenue
    .filter((r) => r.rent_basis === "per_unit" && Number(r.unit_count) > 0)
    .map((r) => Number(r.unit_count));
  const statedUnits = scalarValue(rows, "stated_unit_count");
  const budgetSum = rows.budget
    .filter((b) => b.status === "approved" || b.status === "default_accepted")
    .reduce((sum, b) => sum + Number(b.amount), 0);
  const statedTotalRow = rows.scalars.find(
    (r) => r.key === "stated_total_project_cost" && (r.status === "approved" || r.status === "default_accepted"),
  );
  const statedTotalSource = statedTotalRow
    ? [statedTotalRow.source_location, statedTotalRow.source_text].filter(Boolean).join(" — ").slice(0, 240) || null
    : null;
  return {
    tdc: output.values.tdc,
    equity: input.equityAmount ?? 0,
    loan: input.loanAmount,
    noi: output.values.noi,
    amortizingAnnualDebtService: output.values.annualDebtService,
    statedLtcPct: scalarValue(rows, "stated_ltc_pct"),
    minDscr: scalarValue(rows, "min_dscr"),
    lenderStabilizedOccupancyPct: scalarValue(rows, "lender_stabilized_occupancy_pct"),
    componentOccupancies: input.revenueProgram.map((r) => ({
      unitType: r.unitType,
      occupancyPct: r.occupancyPct ?? null,
    })),
    statedTotalProjectCost: scalarValue(rows, "stated_total_project_cost"),
    statedTotalSource,
    budgetSum,
    unitCounts: [...perUnitCounts, ...(statedUnits != null ? [statedUnits] : [])],
  };
}

// ---------- Readiness (fail-closed gate) ----------

export const getUnderwritingReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { project_id: string }) => ProjectIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const rows = await loadProjectRows(context.supabase, data.project_id);
    const readiness = computeReadiness(rows);
    const conflicts = rows.scalars
      .filter((r) => r.status === "conflicting")
      .map((r) => ({ key: r.key, conflict_values: r.conflict_values ?? [] }));
    const defaults = readiness.defaultable.map((key) => ({
      key,
      value: DEFAULTS[key].value,
      label: DEFAULTS[key].label,
    }));
    const defaultedKeys = rows.scalars.filter((r) => r.status === "default_accepted").map((r) => r.key);
    return { ...readiness, conflicts, defaults, defaultedKeys };
  });

// ---------- Defaults are static and consensual ----------

export const acceptDefaults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { project_id: string }) => ProjectIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const rows = await loadProjectRows(context.supabase, data.project_id);
    const readiness = computeReadiness(rows);
    const accepted: string[] = [];
    for (const key of readiness.defaultable) {
      const def = DEFAULTS[key];
      const { error } = await context.supabase.from("underwriting_inputs").upsert(
        {
          project_id: data.project_id,
          owner_id: context.userId,
          key,
          value_numeric: def.value,
          source: "default",
          status: "default_accepted",
          formula_text: `Static default accepted by analyst: ${def.label}`,
          approved_by: context.userId,
          approved_at: new Date().toISOString(),
        },
        { onConflict: "project_id,key" },
      );
      if (error) throw new Error(error.message);
      accepted.push(key);
    }
    await context.supabase.from("audit_logs").insert({
      project_id: data.project_id, owner_id: context.userId, user_id: context.userId,
      entity_type: "underwriting_inputs", entity_id: null, action: "accept_defaults",
      payload: { accepted, defaults: accepted.map((k) => ({ key: k, value: DEFAULTS[k].value })) },
    });
    return { accepted };
  });

// ---------- Deterministic conflict resolution ----------

const ResolveConflictSchema = z.object({
  project_id: z.string().uuid(),
  key: z.string().min(1),
  mode: z.enum(["pick", "conservative"]),
  value: z.number().optional(),
  resolution_note: z.string().max(1000).optional(),
});

export const resolveConflict = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ResolveConflictSchema.parse(d))
  .handler(async ({ data, context }) => {
    const rows = await loadProjectRows(context.supabase, data.project_id);
    const row = rows.scalars.find((r) => r.key === data.key && r.status === "conflicting");
    if (!row) throw new Error(`No conflicting input found for key ${data.key}.`);
    const candidates = (row.conflict_values ?? []).map((c) => Number(c.value)).filter((v) => Number.isFinite(v));
    if (!candidates.length) throw new Error(`Conflict for ${data.key} has no recorded candidate values.`);

    let resolved: number;
    if (data.mode === "conservative") {
      resolved = conservativePick(data.key, candidates);
    } else {
      if (data.value == null) throw new Error("mode=pick requires a value.");
      // Picking is constrained to one of the documented candidates — no code
      // path may average, blend, or invent a third value.
      if (!candidates.some((c) => Math.abs(c - data.value!) < 1e-9)) {
        throw new Error(`Value ${data.value} is not one of the documented candidates (${candidates.join(", ")}).`);
      }
      resolved = data.value;
    }

    const note =
      data.resolution_note ??
      (data.mode === "conservative"
        ? `Resolved via "use conservative": picked ${resolved} from candidates ${candidates.join(" vs ")}.`
        : `Analyst picked ${resolved} from candidates ${candidates.join(" vs ")}.`);

    const { error } = await context.supabase.from("underwriting_inputs").upsert(
      {
        project_id: data.project_id,
        owner_id: context.userId,
        key: data.key,
        value_numeric: resolved,
        source: "analyst",
        status: "approved",
        resolution_note: note,
        conflict_values: row.conflict_values ?? null,
        approved_by: context.userId,
        approved_at: new Date().toISOString(),
      },
      { onConflict: "project_id,key" },
    );
    if (error) throw new Error(error.message);

    // Mirror the resolution into the review queue so both surfaces agree.
    const taxonomyKey = ENGINE_SCALAR_TO_TAXONOMY[data.key];
    if (taxonomyKey) {
      await context.supabase
        .from("assumptions")
        .update({
          value_numeric: resolved, status: "approved",
          approved_by: context.userId, approved_at: new Date().toISOString(),
          ai_reasoning: note,
        })
        .eq("project_id", data.project_id)
        .eq("field_key", taxonomyKey)
        .eq("status", "conflicting");
    }

    await context.supabase.from("audit_logs").insert({
      project_id: data.project_id, owner_id: context.userId, user_id: context.userId,
      entity_type: "underwriting_inputs", entity_id: null, action: "resolve_conflict",
      payload: { key: data.key, mode: data.mode, resolved, candidates, note },
    });
    return { key: data.key, resolved, note };
  });

// ---------- AI-assisted input selection (never invents a value) ----------
//
// "AI selects inputs, the engine computes." The ONLY thing AI may do here is
// choose, from the consensual STATIC defaults in DEFAULTS, which defaultable
// inputs are reasonable to accept on the analyst's behalf so a deal blocked
// solely by defaultable gaps can run. It selects by index from a fixed list —
// it cannot change a value or introduce a number that is not already a
// pre-approved constant. Accepted rows are written as default_accepted with
// provenance and remain fully visible and reversible by the analyst.
async function aiSelectDefaults(ctx: any, projectId: string, defaultable: string[]): Promise<string[]> {
  const keys = defaultable.filter((k) => DEFAULTS[k] != null);
  if (!keys.length) return [];
  const list = keys
    .map((k, i) => `${i}. key=${k} static_default=${DEFAULTS[k].value} (${DEFAULTS[k].label})`)
    .join("\n");
  const { getAgirModel } = await import("./ai-gateway.server");
  const { generateText } = await import("ai");
  const { text } = await generateText({
    model: getAgirModel(),
    temperature: 0,
    system:
      "You are an institutional real estate underwriter deciding which STATIC, pre-approved default assumptions are reasonable to accept for a development pro forma. You may ONLY accept or skip the listed defaults — you cannot change a value or introduce a new one. Accept a default only when its fixed value is a standard, defensible market convention for that missing input.",
    prompt: `Missing defaultable inputs and their fixed default values:\n${list}\n\nReturn ONLY a JSON array of the integer indices you accept (e.g. [0,2]). Return [] to accept none.`,
  });
  const m = text.match(/\[[\s\S]*?\]/);
  let indices: unknown = [];
  try {
    indices = m ? JSON.parse(m[0]) : [];
  } catch {
    indices = [];
  }
  const accepted: string[] = [];
  for (const raw of Array.isArray(indices) ? indices : []) {
    const key = keys[Number(raw)];
    if (!key) continue;
    const def = DEFAULTS[key];
    const { error } = await ctx.supabase.from("underwriting_inputs").upsert(
      {
        project_id: projectId,
        owner_id: ctx.userId,
        key,
        value_numeric: def.value,
        source: "default",
        status: "default_accepted",
        formula_text: `AI accepted the consensual static default: ${def.label}`,
        approved_by: ctx.userId,
        approved_at: new Date().toISOString(),
      },
      { onConflict: "project_id,key" },
    );
    if (error) throw new Error(error.message);
    accepted.push(key);
  }
  if (accepted.length) {
    await ctx.supabase.from("audit_logs").insert({
      project_id: projectId, owner_id: ctx.userId, user_id: ctx.userId,
      entity_type: "underwriting_inputs", entity_id: null, action: "ai_accept_defaults",
      payload: { accepted, defaults: accepted.map((k) => ({ key: k, value: DEFAULTS[k].value })) },
    });
  }
  return accepted;
}

// ---------- The underwriting run (engine math is always deterministic) ----------

export const runFullUnderwriting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { project_id: string; mode?: "ai" | "deterministic" }) =>
    z.object({
      project_id: z.string().uuid(),
      // AI is the default. It only selects inputs (which consensual static
      // defaults to accept); the deterministic engine performs every
      // calculation in BOTH modes. "deterministic" disables the AI step.
      mode: z.enum(["ai", "deterministic"]).default("ai"),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const aiAvailable = Boolean(process.env.ANTHROPIC_API_KEY);
    const wantsAI = data.mode === "ai";
    const useAI = wantsAI && aiAvailable;
    let aiFailureReason: string | null =
      wantsAI && !aiAvailable ? "ANTHROPIC_API_KEY not configured — used the deterministic engine." : null;
    const aiAcceptedDefaults: string[] = [];

    let rows = await loadProjectRows(context.supabase, data.project_id);
    let readiness = computeReadiness(rows);

    // AI input selection: if defaultable gaps are all that block the run, let AI
    // accept the consensual static defaults so the engine can compute. Falls
    // back silently to the deterministic path (analyst's manual "Accept
    // defaults") on any failure.
    if (useAI && readiness.status === "blocked" && readiness.defaultable.length) {
      try {
        const accepted = await aiSelectDefaults(context, data.project_id, readiness.defaultable);
        aiAcceptedDefaults.push(...accepted);
        if (accepted.length) {
          rows = await loadProjectRows(context.supabase, data.project_id);
          readiness = computeReadiness(rows);
        }
      } catch (error) {
        aiFailureReason = `AI input selection failed; fell back to the deterministic engine (${error instanceof Error ? error.message : "unavailable"}).`;
      }
    }
    const analysisMode: "ai" | "deterministic" = useAI && !aiFailureReason ? "ai" : "deterministic";
    const aiMeta = {
      analysis_mode: analysisMode,
      ai_used: analysisMode === "ai",
      ai_note: aiFailureReason,
      ai_accepted_defaults: aiAcceptedDefaults,
    };

    if (readiness.status === "blocked") {
      // Fail closed: zero metrics, zero charts, no partial numbers.
      return { blocked: true as const, readiness, ...aiMeta };
    }

    const input = assembleEngineInput(rows);
    const base = runUnderwriting(input);

    // Derived tier: persist the calculated TDC with its formula so a derivable
    // total is never reported as missing.
    const calculated = deriveCalculatedTdc(rows.budget);
    if (calculated) {
      await context.supabase.from("underwriting_inputs").upsert(
        {
          project_id: data.project_id, owner_id: context.userId,
          key: "total_project_cost", value_numeric: calculated.value,
          source: "analyst", status: "calculated", formula_text: calculated.formula_text,
        },
        { onConflict: "project_id,key" },
      );
    }

    // Reconciliation gates run automatically with every engine run.
    const flags: ReconciliationFlag[] = [
      ...runReconciliationChecks(buildReconciliationContext(rows, input, base)),
      ...base.warnings.map((w) => ({
        check_key: w.key, severity: "warning" as const, message: w.message,
        expected: w.expected, actual: w.actual,
      })),
    ];

    // Scenarios are engine re-runs: base + the five stresses.
    const scenarioOutputs: { key: string; output: EngineOutput }[] = [
      { key: "base", output: base },
      ...STRESS_PRESETS.map((preset) => ({
        key: preset.key,
        output: runUnderwriting(applyStress(input, preset)),
      })),
    ];

    const combined = scenarioOutputs.find((s) => s.key === "combined")!.output;
    const errorFlags = flags.filter((f) => f.severity === "error");
    const verdict = computeInvestmentVerdict({
      equity_multiple: base.values.equityMultiple,
      profit_margin: base.values.profitOnCostPct,
      development_spread: base.values.developmentSpreadBps,
      stress_dscr: combined.values.dscr,
      stress_equity_multiple: combined.values.equityMultiple,
      equity_wipeout: base.equityWipeout,
      error_flag_count: errorFlags.length,
    });
    const riskScore = computeRiskScore(base, flags);
    const risks = deriveRiskRegister(base, flags);

    // Persist everything in one sweep.
    await Promise.all([
      context.supabase.from("financial_outputs").delete().eq("project_id", data.project_id),
      context.supabase.from("cash_flows").delete().eq("project_id", data.project_id),
      context.supabase.from("reconciliation_flags").delete().eq("project_id", data.project_id),
      context.supabase.from("risk_register").delete().eq("project_id", data.project_id),
    ]);

    const outputInserts: any[] = [];
    for (const { key: scenarioKey, output } of scenarioOutputs) {
      for (const metric of output.metrics) {
        outputInserts.push({
          project_id: data.project_id, owner_id: context.userId, scenario_key: scenarioKey,
          metric_key: metric.key, metric_label: metric.label,
          value_numeric: Number.isFinite(metric.value) ? metric.value : null,
          unit: metric.unit, formula_text: metric.formula,
          inputs: { engine_input_keys: Object.keys(input), scenario: scenarioKey },
        });
      }
    }
    outputInserts.push({
      project_id: data.project_id, owner_id: context.userId, scenario_key: "base",
      metric_key: "risk_score", metric_label: "Risk Score", value_numeric: riskScore, unit: "count",
      formula_text: "Fixed thresholds over engine outputs + reconciliation flags (no LLM).",
      inputs: { error_flags: errorFlags.length },
    });
    outputInserts.push({
      project_id: data.project_id, owner_id: context.userId, scenario_key: "base",
      metric_key: "verdict", metric_label: "Deterministic Verdict", value_numeric: null, unit: "count",
      formula_text: `${verdict.code} — ${verdict.gates.filter((g) => !g.pass).length} of ${verdict.gates.length} gates failed${verdict.hardFail ? "; hard fail (equity wipeout or error-severity reconciliation flag)" : ""}`,
      inputs: { code: verdict.code, gates: verdict.gates, hardFail: verdict.hardFail },
    });
    const { error: outErr } = await context.supabase.from("financial_outputs").insert(outputInserts);
    if (outErr) throw new Error(outErr.message);

    const cashFlowInserts = scenarioOutputs.flatMap(({ key: scenarioKey, output }) =>
      output.cashFlows.map((row) => ({
        project_id: data.project_id, owner_id: context.userId, scenario_key: scenarioKey,
        period_year: row.periodYear, line_key: row.lineKey, amount: row.amount,
      })),
    );
    if (cashFlowInserts.length) {
      const { error } = await context.supabase.from("cash_flows").insert(cashFlowInserts);
      if (error) throw new Error(error.message);
    }

    if (flags.length) {
      const { error } = await context.supabase.from("reconciliation_flags").insert(
        flags.map((flag) => ({ project_id: data.project_id, owner_id: context.userId, ...flag })),
      );
      if (error) throw new Error(error.message);
    }

    if (risks.length) {
      await context.supabase.from("risk_register").insert(
        risks.map((risk) => ({ project_id: data.project_id, owner_id: context.userId, ...risk })),
      );
    }

    await context.supabase.from("audit_logs").insert({
      project_id: data.project_id, owner_id: context.userId, user_id: context.userId,
      entity_type: "project", entity_id: data.project_id, action: "run_full_underwriting",
      payload: {
        scenarios: scenarioOutputs.map((s) => s.key),
        verdict: verdict.code, risk_score: riskScore,
        error_flags: errorFlags.length, equity_wipeout: base.equityWipeout,
        analysis_mode: analysisMode, ai_accepted_defaults: aiAcceptedDefaults,
      },
    });

    return {
      blocked: false as const,
      readiness,
      verdict,
      riskScore,
      equityWipeout: base.equityWipeout,
      irrStatus: base.irrStatus,
      flags,
      values: base.values,
      ...aiMeta,
    };
  });

export const listReconciliationFlags = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { project_id: string }) => ProjectIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("reconciliation_flags").select("*").eq("project_id", data.project_id)
      .order("severity", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
