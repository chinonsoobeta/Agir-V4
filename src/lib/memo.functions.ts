import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { computeInvestmentVerdict } from "./verdict";
import { buildAllowedValues, verifyNumericProvenance, type AllowedValue } from "./engine";
import { DEFAULT_AI_MODEL } from "./ai-gateway.server";
import type { MemoReportContext } from "./memo-report";
import { AI_AUTHORITY_NOTE } from "./ai-authority";
import { isMissingColumn } from "./db-compat";

// The LLM's only job here is PROSE around values injected from engine output.
// It runs at temperature 0, and every generated memo is post-verified: each
// numeric token must trace to an approved/default_accepted/calculated input,
// an engine output, or a reconciliation figure. Orphan numbers badge the memo
// needs_review and are persisted in verification_report: they NEVER block
// memo creation.

// Harden model output parsing: strip markdown fences, take the first JSON
// object, and on any failure fall back to a memo whose executive_summary is the
// raw text (with a parse_warning recorded in verification_report).
function parseMemoJson(text: string): {
  memo: Record<string, unknown>;
  parse_warning: string | null;
} {
  let cleaned = text.trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) cleaned = fenced[1].trim();
  const obj = cleaned.match(/\{[\s\S]*\}/);
  if (obj) {
    try {
      const parsed = JSON.parse(obj[0]);
      if (parsed && typeof parsed === "object")
        return { memo: parsed as Record<string, unknown>, parse_warning: null };
    } catch {
      /* fall through to fallback */
    }
  }
  return {
    memo: { executive_summary: text },
    parse_warning: "Model output was not valid JSON; stored the raw text as executive_summary.",
  };
}

export const generateMemo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
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
        "field_key,field_label,value_numeric,value_text,unit,status,confidence_score,source_document_id,source_text,formula_text,approved_by,approved_at",
      )
      .eq("project_id", data.project_id)
      .in("status", ["approved", "modified", "default_accepted", "calculated"]);
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

    const assumptions = assumptionsRes.data ?? [];
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

    const outputValue = (scenario: string, key: string) =>
      Number(
        outputs.find((row) => row.scenario_key === scenario && row.metric_key === key)
          ?.value_numeric ?? 0,
      );
    const errorFlags = flags.filter((f) => f.severity === "error" && !f.resolved);
    const verdictRow = outputs.find(
      (row) => row.scenario_key === "base" && row.metric_key === "verdict",
    );
    const verdict = computeInvestmentVerdict({
      equity_multiple: outputValue("base", "equity_multiple"),
      profit_margin: outputValue("base", "profit_margin"),
      development_spread: outputValue("base", "development_spread"),
      stress_dscr: outputValue("combined", "dscr"),
      stress_equity_multiple: outputValue("combined", "equity_multiple"),
      error_flag_count: errorFlags.length,
    });

    // ---- AI is OPTIONAL. With a key we use the AI-assisted flow; without one we
    // fall back to a deterministic template. Never throw for a missing key. ----
    const { hasAnthropicKey } = await import("./ai-gateway.server");
    const aiAvailable = hasAnthropicKey();
    let generation_mode: "ai" | "deterministic" = aiAvailable ? "ai" : "deterministic";
    let ai_note: string | null = aiAvailable
      ? null
      : "AI memo generation unavailable: deterministic template used.";

    // Structured IC-memorandum report: deterministic in BOTH modes (the AI only
    // affects prose, never the tables/figures). Drives the formatted on-screen
    // view and the PDF/DOCX downloads.
    const { buildMemoReport, memoReportText } = await import("./memo-report");
    let report = buildMemoReport({
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

    // Allowed numeric provenance set, shared by both generation paths.
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

    let memo: Record<string, unknown> = {};
    let parse_warning: string | null = null;

    if (aiAvailable) {
      const { readServerConfig } = await import("./config.server");
      const model = readServerConfig().aiModel || DEFAULT_AI_MODEL;
      const contextBlock = {
        project: {
          name: project.name,
          location: project.location,
          type: project.type,
          status: project.status,
          notes: project.notes,
        },
        approved_assumptions: assumptions,
        engine_inputs: engineInputs,
        financial_outputs: outputs,
        cash_flows: cashFlows,
        reconciliation_flags: flags,
        unresolved_error_flags: errorFlags,
        deterministic_verdict: verdict,
        persisted_verdict: verdictRow?.formula_text ?? null,
      };
      const prompt = `CONTEXT:
${JSON.stringify(contextBlock, null, 2)}

Generate an investor-grade investment memo. Respond ONLY in strict JSON with keys: executive_summary, project_description, market_overview, development_plan, capital_stack, financial_highlights, sensitivity, key_risks, risk_mitigation, investment_recommendation, managing_director_verdict, investment_committee_recommendation, sources_and_assumptions.

Every unresolved_error_flags entry MUST be stated verbatim in key_risks and reflected in the recommendation. Use the deterministic_verdict.code exactly in every recommendation section.`;

      let rawText = "";
      try {
        const { getAgirModel } = await import("./ai-gateway.server");
        const { generateText } = await import("ai");
        const result = await generateText({
          model: getAgirModel(model),
          temperature: 0,
          system: `Use ONLY values present in CONTEXT. Never introduce a number not in CONTEXT. Cite the metric_key or field_key when quoting a figure. If a section lacks data, write "Insufficient approved data." The investment recommendation must be exactly the deterministic_verdict.code. If deterministic_verdict.code is REJECT, state the magnitude of the projected loss plainly: no sugarcoating.`,
          prompt,
        });
        rawText = result.text;
      } catch (error) {
        generation_mode = "deterministic";
        ai_note = `AI memo generation failed: deterministic template used (${error instanceof Error ? error.message : String(error)}).`;
        await context.supabase.from("audit_logs").insert({
          project_id: data.project_id,
          owner_id: context.userId,
          user_id: context.userId,
          entity_type: "project",
          entity_id: data.project_id,
          action: "ai_fallback",
          payload: { feature: "memo_generation", reason: ai_note },
        });
      }
      if (generation_mode === "ai") {
        const parsed = parseMemoJson(rawText);
        memo = parsed.memo;
        parse_warning = parsed.parse_warning;
      }
    }

    if (generation_mode === "deterministic") {
      const { buildDeterministicMemo } = await import("./memo-template");
      type DetCtx = Parameters<typeof buildDeterministicMemo>[0];
      memo = buildDeterministicMemo({
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
      report = buildMemoReport({
        project,
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
    }

    // ---- Output provenance verifier (deterministic, both paths) ----
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
      authority_note: AI_AUTHORITY_NOTE,
      verified_at: new Date().toISOString(),
    };

    // Provenance NEVER blocks creation: a failing AI memo is saved with
    // needs_review=true and its orphan tokens recorded for the reviewer.
    const status =
      generation_mode === "deterministic"
        ? "generated_deterministic"
        : provenance.pass
          ? "generated"
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
      },
    });

    await context.supabase.from("activities").insert({
      project_id: project.id,
      user_id: context.userId,
      activity_type: "memo_generated",
      description: `Generated ${generation_mode === "deterministic" ? "deterministic-template" : "AI-assisted"} investment memo${provenance.pass ? " (provenance verified)" : `: NEEDS REVIEW: ${provenance.orphans.length} token(s) lack provenance`}`,
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

    const { hasAnthropicKey } = await import("./ai-gateway.server");
    const has_anthropic_key = hasAnthropicKey();

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
        has_anthropic_key,
        model: (await import("./config.server")).readServerConfig().aiModel || DEFAULT_AI_MODEL,
      },
    };
  });
