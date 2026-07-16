import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { computeInvestmentVerdict } from "./verdict";
import { buildAllowedValues, verifyNumericProvenance, type AllowedValue } from "./engine";
import type { MemoReportContext } from "./memo-report";
import { AI_AUTHORITY_NOTE } from "./ai-authority";
import type { AiGenerationProvenance } from "./ai-gateway.server";
import { isMissingColumn } from "./db-compat";
import { EFFECTIVE_ASSUMPTION_STATUSES, effectiveAssumptions } from "./assumption-authority";

// AI memo prose is opt-in and is never exported until it passes a strict JSON,
// deterministic-verdict, and numeric-provenance gate. The deterministic engine
// remains the authority for every number and recommendation.

export const generateMemo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { project_id: string; generation_mode?: "deterministic" | "ai" }) =>
    z
      .object({
        project_id: z.string().uuid(),
        generation_mode: z.enum(["deterministic", "ai"]).default("deterministic"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { assertWorkflowPermission } = await import("./workflow-permissions.server");
    await assertWorkflowPermission(context, data.project_id, "canGenerateMemo");
    const { data: project, error: projErr } = await context.supabase
      .from("projects")
      .select("*")
      .eq("id", data.project_id)
      .single();
    if (projErr) throw new Error(`Memo generation failed loading project: ${projErr.message}`);
    if (!project) throw new Error("Project not found.");

    // Load every input. A failed table query is an ERROR, never a silent empty
    // array: the memo must never be written against partial data.
    const assumptionsRes = await context.supabase
      .from("assumptions")
      .select(
        "field_key,field_label,value_numeric,value_text,unit,status,confidence_score,source_document_id,source_text,formula_text,approved_by,approved_at,dual_control_pending",
      )
      .eq("project_id", data.project_id)
      .in("status", [...EFFECTIVE_ASSUMPTION_STATUSES]);
    if (assumptionsRes.error)
      throw new Error(
        `Memo generation failed loading assumptions: ${assumptionsRes.error.message}`,
      );

    const engineInputsRes = await context.supabase
      .from("underwriting_inputs")
      .select("key,value_numeric,status,source,formula_text,resolution_note,conflict_values")
      .eq("project_id", data.project_id)
      .in("status", ["approved", "default_accepted", "calculated"]);
    if (engineInputsRes.error)
      throw new Error(
        `Memo generation failed loading underwriting_inputs: ${engineInputsRes.error.message}`,
      );

    const outputsRes = await context.supabase
      .from("financial_outputs")
      .select("scenario_key,metric_key,metric_label,value_numeric,unit,formula_text,inputs")
      .eq("project_id", data.project_id);
    if (outputsRes.error)
      throw new Error(
        `Memo generation failed loading financial_outputs: ${outputsRes.error.message}`,
      );

    const cashFlowsRes = await context.supabase
      .from("cash_flows")
      .select("scenario_key,period_year,line_key,amount")
      .eq("project_id", data.project_id)
      .limit(400);
    if (cashFlowsRes.error)
      throw new Error(`Memo generation failed loading cash_flows: ${cashFlowsRes.error.message}`);

    const flagsRes = await context.supabase
      .from("reconciliation_flags")
      .select("check_key,severity,message,expected,actual,resolved")
      .eq("project_id", data.project_id);
    if (flagsRes.error)
      throw new Error(
        `Memo generation failed loading reconciliation_flags: ${flagsRes.error.message}`,
      );

    const risksRes = await context.supabase
      .from("risk_register")
      .select("title,description,severity")
      .eq("project_id", data.project_id);
    if (risksRes.error)
      throw new Error(`Memo generation failed loading risk_register: ${risksRes.error.message}`);

    const documentsRes = await context.supabase
      .from("documents")
      .select("id,name,category")
      .eq("project_id", data.project_id);
    if (documentsRes.error)
      throw new Error(`Memo generation failed loading documents: ${documentsRes.error.message}`);

    const assumptions = effectiveAssumptions(assumptionsRes.data ?? []);
    const engineInputs = engineInputsRes.data ?? [];
    let outputs = outputsRes.data ?? [];
    let cashFlows = cashFlowsRes.data ?? [];
    let flags = flagsRes.data ?? [];
    let risks = risksRes.data ?? [];
    const documents = documentsRes.data ?? [];

    if (!outputs.length) {
      throw new Error(
        "Run deterministic underwriting before generating a memo: the memo presents engine output, never numbers of its own.",
      );
    }

    const { getUnderwritingRunStateForContext } = await import("./underwriting.server");
    const runState = await getUnderwritingRunStateForContext({ data, context });
    if (runState.freshness === "stale") {
      throw new Error("Outputs stale. Re-run deterministic underwriting before generating a memo.");
    }
    if (runState.freshness === "blocked") {
      throw new Error("Underwriting blocked. Resolve inputs before generating a memo.");
    }
    const memoRun =
      runState.freshness === "current" ? (runState.latest_completed_run as any) : null;
    if (memoRun?.id) {
      const { getLatestCompletedRunOutputsForContext } = await import("./underwriting.server");
      const scoped = await getLatestCompletedRunOutputsForContext({ data, context });
      if (scoped.outputs.length) outputs = scoped.outputs as typeof outputs;
      if (scoped.cash_flows.length) cashFlows = scoped.cash_flows as typeof cashFlows;
      if (scoped.reconciliation_flags.length) flags = scoped.reconciliation_flags as typeof flags;
      if (scoped.risks.length) risks = scoped.risks as typeof risks;
    }

    const outputValue = (scenario: string, key: string): number | null => {
      const raw = outputs.find(
        (row) => row.scenario_key === scenario && row.metric_key === key,
      )?.value_numeric;
      if (raw == null) return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    };
    const requiredOutputValue = (scenario: string, key: string): number => {
      const value = outputValue(scenario, key);
      if (value == null)
        throw new Error(
          `Underwriting output ${scenario}.${key} is missing or invalid. Re-run deterministic underwriting before generating a memo.`,
        );
      return value;
    };
    const errorFlags = flags.filter((f) => f.severity === "error" && !f.resolved);
    const verdict = computeInvestmentVerdict({
      equity_multiple: requiredOutputValue("base", "equity_multiple"),
      profit_margin: requiredOutputValue("base", "profit_margin"),
      development_spread: requiredOutputValue("base", "development_spread"),
      stress_dscr: requiredOutputValue("combined", "dscr"),
      stress_equity_multiple: requiredOutputValue("combined", "equity_multiple"),
      equity_wipeout: requiredOutputValue("base", "equity_wipeout") === 1,
      error_flag_count: errorFlags.length,
    });

    const generation_mode = data.generation_mode;
    const ai_note =
      generation_mode === "ai"
        ? "AI-generated narrative is constrained to deterministic underwriting evidence and requires provenance verification."
        : "Investment memo generated from the governed deterministic template.";

    // The same deterministic report drives the on-screen view and PDF/DOCX.
    const { buildMemoReport, memoReportText } = await import("./memo-report");
    const report = buildMemoReport({
      project,
      // These are column-subset selects; the memo builder reads only the
      // selected fields, so assert them to the full row shapes it expects.
      assumptions: assumptions as unknown as MemoReportContext["assumptions"],
      engineInputs: engineInputs as unknown as MemoReportContext["engineInputs"],
      outputs: outputs as unknown as MemoReportContext["outputs"],
      flags: flags as unknown as MemoReportContext["flags"],
      risks: risks as unknown as MemoReportContext["risks"],
      documents: documents as unknown as MemoReportContext["documents"],
      verdict,
      generationMode: generation_mode,
      generatedLabel: new Date().toLocaleString("en-US", { month: "long", year: "numeric" }),
    });

    // Allowed numeric provenance set for the governed artifact.
    // Reconciliation figures and their pure-function differences/ratios are
    // legitimately derivable (a gap is uses - sources; a covenant shortfall is
    // required / actual), as are the report's own pure-function derivations
    // (per-component GPR/EGI, capital-stack percentages) reported in
    // report.derived_values.
    const flagDerived: number[] = [];
    for (const f of flags) {
      const e = f.expected == null ? null : Number(f.expected);
      const a = f.actual == null ? null : Number(f.actual);
      if (e != null) flagDerived.push(e);
      if (a != null) flagDerived.push(a);
      // Gaps (expected - actual) and coverage ratios are legitimately derivable
      // figures the memo may quote. The provenance hardening here is
      // unit-awareness (see cashFlowAllowed below), not narrowing this set.
      if (e != null && a != null) {
        flagDerived.push(e - a, a - e);
        if (a !== 0) flagDerived.push(e / a);
        if (e !== 0) flagDerived.push(a / e);
      }
    }
    // Cash-flow amounts are tagged as money so a fabricated rate (e.g. "5.25%")
    // can no longer be validated by a coincidental dollar magnitude. Assumptions,
    // engine inputs and outputs stay untyped, so a legitimate rate is never
    // falsely orphaned.
    const cashFlowAllowed: AllowedValue[] = [];
    for (const c of cashFlows) {
      const v = Number(c.amount);
      if (Number.isFinite(v))
        cashFlowAllowed.push({ value: v, unit: "$" }, { value: -v, unit: "$" });
    }
    const allowed: AllowedValue[] = [
      ...buildAllowedValues(
        assumptions.map((a) => (a.value_numeric == null ? null : Number(a.value_numeric))),
        engineInputs.map((r) => (r.value_numeric == null ? null : Number(r.value_numeric))),
        outputs.map((o) => (o.value_numeric == null ? null : Number(o.value_numeric))),
        flags.flatMap((f) => [
          f.expected == null ? null : Number(f.expected),
          f.actual == null ? null : Number(f.actual),
        ]),
        verdict.gates.map((g) => (g.actual == null ? null : Number(g.actual))),
        // Fixed gate thresholds quoted by the verdict
        [1.5, 15, 100, 1.2, 1.0],
        flagDerived,
        report.derived_values,
      ),
      ...cashFlowAllowed,
    ];

    const { buildDeterministicMemo } = await import("./memo-template");
    type DetCtx = Parameters<typeof buildDeterministicMemo>[0];
    const deterministicMemo = buildDeterministicMemo({
      project,
      assumptions: assumptions as unknown as DetCtx["assumptions"],
      engineInputs: engineInputs as unknown as DetCtx["engineInputs"],
      outputs: outputs as unknown as DetCtx["outputs"],
      cashFlows: cashFlows as unknown as DetCtx["cashFlows"],
      flags: flags as unknown as DetCtx["flags"],
      risks: risks as unknown as DetCtx["risks"],
      errorFlags: errorFlags as unknown as DetCtx["errorFlags"],
      verdict,
    });
    let memo: Record<string, unknown> = deterministicMemo;
    const parse_warning = null;
    let ai_generation: AiGenerationProvenance | null = null;
    if (generation_mode === "ai") {
      const { hasAiProvider, generateAgirText } = await import("./ai-gateway.server");
      if (!hasAiProvider()) {
        throw new Error("AI memo generation requires a configured server-side AI provider.");
      }
      const { aiMemoPrompt, assertAiMemoVerdict, parseAiMemo } = await import("./ai-memo");
      const generation = await generateAgirText({
        endUserId: context.userId,
        temperature: 0,
        maxOutputTokens: 6_000,
        prompt: aiMemoPrompt({ deterministicMemo, verdictCode: verdict.code }),
      });
      const aiMemo = parseAiMemo(generation.text);
      assertAiMemoVerdict(aiMemo, verdict.code);
      memo = aiMemo;
      ai_generation = generation.ai;
    }

    // ---- Output provenance verifier ----
    // Verify the prose sections AND every numeric-bearing string the formatted
    // report (tables, stats, footnotes) will render.
    const memoText = [
      ...Object.values(memo).filter((v) => typeof v === "string"),
      memoReportText(report),
    ].join("\n");
    const provenance = verifyNumericProvenance(memoText, allowed);
    const verificationReport = {
      mode: generation_mode,
      pass: provenance.pass,
      token_count: provenance.tokenCount,
      orphans: provenance.orphans,
      parse_warning,
      ai_note,
      ai_generation,
      authority_note: AI_AUTHORITY_NOTE,
      verified_at: new Date().toISOString(),
    };

    // A deterministic artifact that fails the same gate remains review-only.
    const status = provenance.pass
      ? generation_mode === "ai"
        ? "generated_ai"
        : "generated_deterministic"
      : "needs_review";

    const memoInsert = {
      project_id: project.id,
      owner_id: context.userId,
      run_id: memoRun?.id ?? null,
      status,
      content: {
        ...memo,
        generation_mode,
        report,
        deterministic_verdict: verdict,
        run_version: memoRun
          ? {
              id: memoRun.id,
              run_number: memoRun.run_number,
              run_mode: memoRun.run_mode,
              input_fingerprint: memoRun.input_fingerprint,
              output_fingerprint: memoRun.output_fingerprint,
            }
          : null,
        unresolved_error_flags: errorFlags,
        needs_review: !provenance.pass,
        parse_warning,
        ai_note,
        ai_generation,
        authority_note: AI_AUTHORITY_NOTE,
      },
      verification_report: verificationReport,
    };
    let memoWrite = await context.supabase
      .from("investment_memos")
      .insert(memoInsert)
      .select()
      .single();
    if (isMissingColumn(memoWrite.error)) {
      const compatInsert: Record<string, unknown> = { ...memoInsert };
      delete compatInsert.run_id;
      memoWrite = await context.supabase
        .from("investment_memos")
        .insert(compatInsert as any)
        .select()
        .single();
    }
    const { data: row, error: insErr } = memoWrite;
    if (insErr)
      throw new Error(`Memo generation failed saving investment_memos: ${insErr.message}`);

    await context.supabase.from("audit_logs").insert({
      project_id: project.id,
      owner_id: context.userId,
      user_id: context.userId,
      entity_type: "investment_memos",
      entity_id: row.id,
      action: "memo_generated",
      payload: {
        run_id: memoRun?.id ?? null,
        run_number: memoRun?.run_number ?? null,
        input_fingerprint: memoRun?.input_fingerprint ?? null,
        verification_pass: provenance.pass,
        generation_mode,
        ai_generation,
      },
    });

    await context.supabase.from("activities").insert({
      project_id: project.id,
      user_id: context.userId,
      activity_type: "memo_generated",
      description: `Generated ${generation_mode === "ai" ? "AI-narrative" : "deterministic-template"} investment memo${provenance.pass ? " (provenance verified)" : `: NEEDS REVIEW: ${provenance.orphans.length} token(s) lack provenance`}`,
    });
    return row;
  });

export const listMemos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("investment_memos")
      .select("*")
      .eq("project_id", data.project_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ---------- Memo readiness diagnostics ----------
//
// Surfaces exactly why memo generation can or cannot run, so the UI can disable
// the button with a clear reason and developers can inspect the inputs.
export const debugMemoReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: project } = await context.supabase
      .from("projects")
      .select("id,name")
      .eq("id", data.project_id)
      .maybeSingle();

    type CountQuery = PromiseLike<{ count: number | null }> & {
      eq: (column: string, value: string) => CountQuery;
      in: (column: string, values: string[]) => CountQuery;
    };
    const count = async (
      table: "assumptions" | "underwriting_inputs" | "cash_flows" | "reconciliation_flags",
      filters?: (q: CountQuery) => CountQuery,
    ) => {
      let q = context.supabase
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq("project_id", data.project_id) as unknown as CountQuery;
      if (filters) q = filters(q);
      const { count: c } = await q;
      return c ?? 0;
    };

    const assumptions_count = await count("assumptions");
    const engine_inputs_count = await count("underwriting_inputs", (q) =>
      q.in("status", ["approved", "default_accepted", "calculated"]),
    );
    const cash_flows_count = await count("cash_flows");
    const reconciliation_flags_count = await count("reconciliation_flags");

    const { data: outputs } = await context.supabase
      .from("financial_outputs")
      .select("scenario_key,metric_key,value_numeric,formula_text,inputs")
      .eq("project_id", data.project_id);
    const financial_outputs_count = outputs?.length ?? 0;
    const base_outputs_count = (outputs ?? []).filter((o) => o.scenario_key === "base").length;
    const combined_outputs_count = (outputs ?? []).filter(
      (o) => o.scenario_key === "combined",
    ).length;
    const verdictRow = (outputs ?? []).find(
      (o) => o.scenario_key === "base" && o.metric_key === "verdict",
    );
    const latest_verdict =
      (verdictRow?.inputs as { code?: string } | null)?.code ?? verdictRow?.formula_text ?? null;

    const { data: flags } = await context.supabase
      .from("reconciliation_flags")
      .select("severity,resolved")
      .eq("project_id", data.project_id);
    const unresolved_error_flags_count = (flags ?? []).filter(
      (f) => f.severity === "error" && !f.resolved,
    ).length;

    // Detect which optional columns the table actually has.
    const probe = await context.supabase
      .from("investment_memos")
      .select("verification_report,status")
      .limit(1);
    const investment_memos_columns_detected = probe.error
      ? ["content"]
      : ["content", "verification_report", "status"];

    const blocking_reasons: string[] = [];
    if (!project) blocking_reasons.push("Project not found.");
    if (base_outputs_count === 0)
      blocking_reasons.push("Run deterministic underwriting before generating a memo.");
    if (financial_outputs_count === 0)
      blocking_reasons.push("No financial outputs: run deterministic underwriting first.");

    const { getAiReadinessDiagnostics } = await import("./ai-gateway.server");
    const ai = getAiReadinessDiagnostics();

    return {
      project_id: data.project_id,
      project_found: Boolean(project),
      assumptions_count,
      engine_inputs_count,
      financial_outputs_count,
      base_outputs_count,
      combined_outputs_count,
      cash_flows_count,
      reconciliation_flags_count,
      unresolved_error_flags_count,
      latest_verdict,
      investment_memos_columns_detected,
      can_generate: blocking_reasons.length === 0,
      blocking_reasons,
      env: {
        has_anthropic_key: ai.providers.anthropic.configured,
        has_openai_key: ai.providers.openai.configured,
        has_ai_provider: ai.configured,
        provider: ai.activeProvider,
        model: ai.activeModel,
      },
    };
  });
