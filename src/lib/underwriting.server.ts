// Fail-closed underwriting server implementation.
//
// THE ONE ARCHITECTURAL LAW: the engine reads from exactly ONE place: the
// typed EngineInput assembled by loadEngineInput() from underwriting_inputs,
// development_budget and revenue_program rows where status ∈
// {approved, default_accepted}. No LLM call exists anywhere in the path from
// button-click to rendered metric, and the engine never receives a value that
// lacks a provenance row.

import "@tanstack/react-start/server-only";
import { readServerConfig } from "./config.server";
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
  UnderwritingBlockedError,
  type EngineOutput,
  type ProjectInputRows,
  type ReconciliationFlag,
  type UnderwritingInput,
} from "./engine";
import { withinModelTolerance } from "./engine/tolerance-policy";
import { computeInvestmentVerdict } from "./verdict";
import {
  buildInsight,
  writeNarrative,
  computePortfolioNorms,
  deriveDealContext,
  interpretDeal,
} from "./context";
import { generateFindings } from "./findings";
import { reconcileRecommendation } from "./decision";
import { AI_AUTHORITY_NOTE } from "./ai-authority";
import {
  handleSchemaCompatibilityFallback,
  isMissingColumn,
  isMissingFunction,
  isMissingRelation,
} from "./db-compat";
import {
  assertWorkflowPermission,
  getWorkflowPermissionsForProject,
} from "./workflow-permissions.server";

// Taxonomy (review queue) → engine key mapping. Conflicting review-queue rows
// are surfaced to readiness through this mapping so a conflicted key blocks
// underwriting even before approval.
import {
  ENGINE_SCALAR_TO_TAXONOMY,
  TAXONOMY_TO_ENGINE_SCALAR,
  TAXONOMY_TO_BUDGET_CATEGORY,
  TAXONOMY_TO_REVENUE_FIELD,
} from "./taxonomy-engine-map";
import { ASSUMPTION_BY_KEY } from "./assumption-taxonomy";

export const APPROVED_ASSUMPTION_SYNC_MESSAGE =
  "Approved assumptions are still syncing to engine inputs. Retry underwriting in a moment.";

type SupabaseFacade = any;
type ServerContext = {
  supabase: SupabaseFacade;
  userId: string;
};

async function auditWorkflowEvent(
  ctx: ServerContext,
  projectId: string,
  action: string,
  payload: Record<string, unknown>,
) {
  await ctx.supabase.from("audit_logs").insert({
    project_id: projectId,
    owner_id: ctx.userId,
    user_id: ctx.userId,
    entity_type: "project",
    entity_id: projectId,
    action,
    payload,
  });
}

type UnderwritingRunStatus = "completed" | "blocked" | "failed";
type UnderwritingRunMode = "deterministic" | "ai_assisted_default_selection";

function persistedRunMode(mode: "ai" | "deterministic"): UnderwritingRunMode {
  return mode === "ai" ? "ai_assisted_default_selection" : "deterministic";
}

function orderedRecord<T extends Record<string, unknown>>(row: T) {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function normalizeProjectRows(rows: ProjectInputRows) {
  const sortBy = (a: Record<string, unknown>, b: Record<string, unknown>) =>
    String(a.key ?? a.category ?? a.unit_type ?? "").localeCompare(
      String(b.key ?? b.category ?? b.unit_type ?? ""),
    );
  return {
    scalars: rows.scalars.map(orderedRecord).sort(sortBy),
    budget: rows.budget.map(orderedRecord).sort(sortBy),
    revenue: rows.revenue.map(orderedRecord).sort(sortBy),
  };
}

function runBlockedReasons(readiness: ReturnType<typeof computeReadiness>) {
  return [
    ...readiness.missing.map((key) => ({ kind: "missing", key })),
    ...readiness.conflicting.map((key) => ({ kind: "conflicting", key })),
    ...readiness.impossible.map((key) => ({ kind: "impossible", key })),
  ];
}

function acceptedDefaultsUsed(rows: ProjectInputRows) {
  const scalarDefaults = rows.scalars
    .filter((row) => row.status === "default_accepted")
    .map((row) => ({ key: row.key, value: row.value_numeric, source: row.source ?? "default" }));
  const budgetDefaults = rows.budget
    .filter((row) => row.status === "default_accepted")
    .map((row) => ({ key: `budget:${row.category}`, value: row.amount, source: "default" }));
  const revenueDefaults = rows.revenue
    .filter((row) => row.status === "default_accepted")
    .map((row) => ({ key: `revenue:${row.unit_type}`, source: "default" }));
  return [...scalarDefaults, ...budgetDefaults, ...revenueDefaults];
}

function conflictResolutionsUsed(rows: ProjectInputRows) {
  return rows.scalars
    .filter((row) => (row as any).resolution_note || row.conflict_values)
    .map((row) => ({
      key: row.key,
      value: row.value_numeric,
      resolution_note: (row as any).resolution_note ?? null,
      conflict_values: row.conflict_values ?? null,
    }));
}

function outputSnapshot(rows: Array<Record<string, unknown>>) {
  return rows.map((row) => ({
    scenario_key: row.scenario_key,
    metric_key: row.metric_key,
    metric_label: row.metric_label ?? null,
    value_numeric: row.value_numeric ?? null,
    unit: row.unit ?? null,
    formula_text: row.formula_text ?? null,
  }));
}

function withoutRunId<T extends Record<string, unknown>>(rows: T[]) {
  return rows.map((row) => {
    const compat = { ...row };
    delete compat.run_id;
    return compat;
  });
}

async function insertRowsWithRunIdCompatibility(
  supabase: SupabaseFacade,
  table: string,
  rows: Array<Record<string, unknown>>,
  operation: string,
) {
  const insert = await supabase.from(table).insert(rows);
  if (!isMissingColumn(insert.error)) return insert;

  handleSchemaCompatibilityFallback(insert.error, {
    featureName: "underwriting run scoped outputs",
    table,
    column: "run_id",
    operation,
    fallback: null,
  });
  return supabase.from(table).insert(withoutRunId(rows));
}

function normalizedRows(rows: Array<Record<string, unknown>>, runId: string) {
  return rows.map((row) => {
    const copy: Record<string, unknown> = { ...row, run_id: runId };
    delete copy.id;
    return copy;
  });
}

const RUN_HISTORY_TABLES = {
  financial_outputs: "run_financial_outputs",
  cash_flows: "run_cash_flows",
  reconciliation_flags: "run_reconciliation_flags",
  risk_register: "run_risk_register",
} as const;

async function runHistoryWriteClient(fallback: SupabaseFacade) {
  const config = readServerConfig();
  if (!config.supabaseUrl || !config.serviceRoleKey) return fallback;
  const { getServiceRoleClient } = await import("@/integrations/supabase/service-role.server");
  return getServiceRoleClient("run_history_write");
}

async function insertRunHistoryRows(
  supabase: SupabaseFacade,
  sourceTable: keyof typeof RUN_HISTORY_TABLES,
  rows: Array<Record<string, unknown>>,
  runId: string,
  operation: string,
) {
  if (!rows.length) return;
  const table = RUN_HISTORY_TABLES[sourceTable];
  const writer = await runHistoryWriteClient(supabase);
  const res = await writer.from(table).insert(normalizedRows(rows, runId));
  if (isMissingRelation(res.error)) {
    handleSchemaCompatibilityFallback(res.error, {
      featureName: "normalized underwriting run history",
      table,
      operation,
      fallback: null,
    });
    return;
  }
  if (res.error) throw new Error(`${operation} failed: ${res.error.message}`);
}

async function persistUnderwritingRunTransaction(
  ctx: ServerContext,
  input: {
    projectId: string;
    status: UnderwritingRunStatus;
    mode: "ai" | "deterministic";
    inputFingerprint: string;
    outputFingerprint?: string | null;
    verdictCode?: string | null;
    blockedReasons?: unknown[];
    acceptedDefaults?: unknown[];
    conflictResolutions?: unknown[];
    inputSnapshot?: unknown;
    outputSnapshot?: unknown[];
    financialOutputs?: Array<Record<string, unknown>>;
    cashFlows?: Array<Record<string, unknown>>;
    reconciliationFlags?: Array<Record<string, unknown>>;
    risks?: Array<Record<string, unknown>>;
    auditPayload?: Record<string, unknown>;
    jobId?: string | null;
    jobResult?: Record<string, unknown>;
  },
) {
  const { data, error } = await ctx.supabase.rpc("persist_underwriting_run_transaction", {
    p_project_id: input.projectId,
    p_owner_id: ctx.userId,
    p_created_by: ctx.userId,
    p_run_mode: persistedRunMode(input.mode),
    p_status: input.status,
    p_input_fingerprint: input.inputFingerprint,
    p_output_fingerprint: input.outputFingerprint ?? null,
    p_verdict_code: input.verdictCode ?? null,
    p_blocked_reasons: input.blockedReasons ?? [],
    p_accepted_defaults_used: input.acceptedDefaults ?? [],
    p_conflict_resolutions_used: input.conflictResolutions ?? [],
    p_input_snapshot: input.inputSnapshot ?? {},
    p_output_snapshot: input.outputSnapshot ?? [],
    p_financial_outputs: input.financialOutputs ?? [],
    p_cash_flows: input.cashFlows ?? [],
    p_reconciliation_flags: input.reconciliationFlags ?? [],
    p_risk_register: input.risks ?? [],
    p_audit_payload: input.auditPayload ?? {},
    p_job_id: input.jobId ?? null,
    p_job_result: input.jobResult ?? null,
  });
  if (isMissingFunction(error) || isMissingRelation(error)) {
    return handleSchemaCompatibilityFallback(error, {
      featureName: "transactional underwriting run persistence",
      table: "persist_underwriting_run_transaction",
      operation: "persist underwriting run atomically",
      fallback: null,
    });
  }
  if (error) throw new Error(`Transactional underwriting persistence failed: ${error.message}`);
  return data;
}

async function deleteLatestUnderwritingOutputs(ctx: ServerContext, projectId: string) {
  const { error } = await ctx.supabase.rpc("delete_underwriting_outputs", {
    p_project_id: projectId,
  });
  if (!isMissingFunction(error) && !isMissingRelation(error)) {
    if (error) throw new Error(error.message);
    return;
  }

  handleSchemaCompatibilityFallback(error, {
    featureName: "transactional underwriting output deletes",
    table: "delete_underwriting_outputs",
    operation: "delete latest underwriting compatibility rows",
    fallback: null,
  });

  const deletes = await Promise.all([
    ctx.supabase.from("financial_outputs").delete().eq("project_id", projectId),
    ctx.supabase.from("cash_flows").delete().eq("project_id", projectId),
    ctx.supabase.from("reconciliation_flags").delete().eq("project_id", projectId),
    ctx.supabase.from("risk_register").delete().eq("project_id", projectId),
  ]);
  const deleteError = deletes.find((res) => res.error)?.error;
  if (deleteError) throw new Error(deleteError.message);
}

async function copyLatestCompatibilityRowsToRun(
  supabase: SupabaseFacade,
  projectId: string,
  runId: string,
) {
  for (const [sourceTable, historyTable] of Object.entries(RUN_HISTORY_TABLES)) {
    const { data, error } = await supabase
      .from(sourceTable)
      .select("*")
      .eq("project_id", projectId);
    if (error) throw new Error(`Loading ${sourceTable} for run history failed: ${error.message}`);
    await insertRunHistoryRows(
      supabase,
      sourceTable as keyof typeof RUN_HISTORY_TABLES,
      (data ?? []) as Array<Record<string, unknown>>,
      runId,
      `insert ${historyTable}`,
    );
  }
}

async function stampLatestRowsWithRunId(
  supabase: SupabaseFacade,
  projectId: string,
  runId: string,
  tables: string[],
) {
  for (const table of tables) {
    const write = await supabase.from(table).update({ run_id: runId }).eq("project_id", projectId);
    if (!isMissingColumn(write.error)) {
      if (write.error) throw new Error(write.error.message);
      continue;
    }
    handleSchemaCompatibilityFallback(write.error, {
      featureName: "underwriting run scoped outputs",
      table,
      column: "run_id",
      operation: "stamp latest rows with run id",
      fallback: null,
    });
  }
}

async function nextRunNumber(ctx: ServerContext, projectId: string) {
  const { data, error } = await ctx.supabase
    .from("underwriting_runs")
    .select("run_number")
    .eq("project_id", projectId)
    .order("run_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (isMissingRelation(error)) {
    return handleSchemaCompatibilityFallback(error, {
      featureName: "underwriting run versions",
      table: "underwriting_runs",
      operation: "find next run number",
      fallback: null as number | null,
    });
  }
  if (error) throw new Error(error.message);
  return (data?.run_number ?? 0) + 1;
}

async function insertUnderwritingRun(
  ctx: ServerContext,
  input: {
    projectId: string;
    status: UnderwritingRunStatus;
    mode: "ai" | "deterministic";
    inputFingerprint: string;
    outputFingerprint?: string | null;
    verdictCode?: string | null;
    blockedReasons?: unknown[];
    acceptedDefaults?: unknown[];
    conflictResolutions?: unknown[];
    inputSnapshot?: unknown;
    outputSnapshot?: unknown[];
  },
) {
  const runNumber = await nextRunNumber(ctx, input.projectId);
  if (runNumber == null) return null;
  const { data: row, error } = await ctx.supabase
    .from("underwriting_runs")
    .insert({
      project_id: input.projectId,
      owner_id: ctx.userId,
      run_number: runNumber,
      run_mode: persistedRunMode(input.mode),
      status: input.status,
      input_fingerprint: input.inputFingerprint,
      output_fingerprint: input.outputFingerprint ?? null,
      verdict_code: input.verdictCode ?? null,
      blocked_reasons: input.blockedReasons ?? [],
      accepted_defaults_used: input.acceptedDefaults ?? [],
      conflict_resolutions_used: input.conflictResolutions ?? [],
      input_snapshot: input.inputSnapshot ?? {},
      output_snapshot: input.outputSnapshot ?? [],
      created_by: ctx.userId,
    })
    .select()
    .single();
  if (isMissingRelation(error)) {
    return handleSchemaCompatibilityFallback(error, {
      featureName: "underwriting run versions",
      table: "underwriting_runs",
      operation: "insert run version",
      fallback: null,
    });
  }
  if (error) throw new Error(error.message);
  return row;
}

async function currentInputBasis(supabase: SupabaseFacade, projectId: string) {
  const { stableJsonHash } = await import("./hash.server");
  const rows = await loadProjectRows(supabase, projectId);
  const readiness = computeReadiness(rows);
  if (readiness.status === "blocked") {
    return {
      rows,
      readiness,
      input: null,
      inputFingerprint: stableJsonHash({
        readiness,
        rows: normalizeProjectRows(rows),
      }),
    };
  }
  const input = assembleEngineInput(rows);
  return {
    rows,
    readiness,
    input,
    inputFingerprint: stableJsonHash(input),
  };
}

function valuesMatch(actual: unknown, expected: unknown) {
  if (actual == null || expected == null) return false;
  const a = Number(actual);
  const e = Number(expected);
  return withinModelTolerance(a, e);
}

function revenueColumnFor(field: string) {
  return field === "rent" ? "market_rent_monthly" : field;
}

export async function assertApprovedAssumptionsSynced(supabase: SupabaseFacade, projectId: string) {
  const { data: assumptions, error } = await supabase
    .from("assumptions")
    .select("field_key,field_label,value_numeric,status")
    .eq("project_id", projectId)
    .in("status", ["approved", "modified"]);
  if (error) throw new Error(error.message);
  const rows = (assumptions ?? []).filter((row: any) => row.value_numeric != null);
  if (!rows.length) return;

  const [{ data: scalars }, { data: budget }, { data: revenue }] = await Promise.all([
    supabase
      .from("underwriting_inputs")
      .select("key,value_numeric,status")
      .eq("project_id", projectId),
    supabase
      .from("development_budget")
      .select("category,label,amount,status")
      .eq("project_id", projectId),
    supabase.from("revenue_program").select("*").eq("project_id", projectId),
  ]);

  for (const row of rows as any[]) {
    const scalarKey = TAXONOMY_TO_ENGINE_SCALAR[row.field_key];
    if (scalarKey) {
      const synced = (scalars ?? []).some(
        (input: any) =>
          input.key === scalarKey &&
          input.status === "approved" &&
          valuesMatch(input.value_numeric, row.value_numeric),
      );
      if (!synced) throw new Error(APPROVED_ASSUMPTION_SYNC_MESSAGE);
      continue;
    }

    const budgetCategory = TAXONOMY_TO_BUDGET_CATEGORY[row.field_key];
    if (budgetCategory) {
      const synced = (budget ?? []).some(
        (input: any) =>
          input.category === budgetCategory &&
          (budgetCategory !== "other" || input.label === row.field_label) &&
          input.status === "approved" &&
          valuesMatch(input.amount, row.value_numeric),
      );
      if (!synced) throw new Error(APPROVED_ASSUMPTION_SYNC_MESSAGE);
      continue;
    }

    const revenueMap = TAXONOMY_TO_REVENUE_FIELD[row.field_key];
    if (revenueMap) {
      const column = revenueColumnFor(revenueMap.field);
      const synced = (revenue ?? []).some(
        (input: any) =>
          input.unit_type === revenueMap.unitType &&
          input.status === "approved" &&
          valuesMatch(input[column], row.value_numeric),
      );
      if (!synced) throw new Error(APPROVED_ASSUMPTION_SYNC_MESSAGE);
    }
  }
}

// The single loader. Everything the engine sees flows through here.
async function loadProjectRows(
  supabase: SupabaseFacade,
  projectId: string,
): Promise<ProjectInputRows> {
  const { loadProjectInputRepositoryRows } =
    await import("./repositories/project-inputs.repository");
  const { conflictingAssumptions, ...rows } = await loadProjectInputRepositoryRows(
    supabase,
    projectId,
  );

  // Unresolved review-queue conflicts block readiness for their engine target.
  // scalar, budget category, OR revenue component. Previously only scalar
  // conflicts blocked, so a conflicting budget/revenue key (land_cost,
  // residential_units, …) slipped past the fail-closed gate.
  for (const a of conflictingAssumptions ?? []) {
    const engineKey = TAXONOMY_TO_ENGINE_SCALAR[a.field_key];
    if (engineKey) {
      const existing = rows.scalars.find((r) => r.key === engineKey);
      if (existing && (existing.status === "approved" || existing.status === "default_accepted"))
        continue;
      if (existing) {
        existing.status = "conflicting";
        existing.conflict_values = a.conflict_values ?? existing.conflict_values;
      } else {
        rows.scalars.push({
          key: engineKey,
          value_numeric: null,
          status: "conflicting",
          conflict_values: a.conflict_values ?? null,
        });
      }
      continue;
    }
    const budgetCategory = TAXONOMY_TO_BUDGET_CATEGORY[a.field_key];
    if (budgetCategory) {
      const existing = rows.budget.find((b) => b.category === budgetCategory);
      if (existing && (existing.status === "approved" || existing.status === "default_accepted"))
        continue;
      if (existing) existing.status = "conflicting";
      else rows.budget.push({ category: budgetCategory as any, amount: 0, status: "conflicting" });
      continue;
    }
    const rev = TAXONOMY_TO_REVENUE_FIELD[a.field_key];
    if (rev) {
      const existing = rows.revenue.find((r) => r.unit_type === rev.unitType);
      if (existing && (existing.status === "approved" || existing.status === "default_accepted"))
        continue;
      if (existing) existing.status = "conflicting";
      else
        rows.revenue.push({
          unit_type: rev.unitType,
          unit_count: 0,
          rent: 0,
          rent_basis: rev.basis,
          status: "conflicting",
        } as any);
      continue;
    }
  }

  return rows;
}

export async function loadEngineInput(
  supabase: SupabaseFacade,
  projectId: string,
): Promise<UnderwritingInput> {
  return assembleEngineInput(await loadProjectRows(supabase, projectId));
}

// WS3. Return the assembled, engine-ready input so the client can run the PURE
// engine for transparency (the monthly schedule grid) and flexible sensitivity
// (tornado / breakeven / 2-variable grid). It only EXPOSES the user's own approved
// inputs (RLS-scoped via context.supabase); it never persists. Fail-closed: a deal
// that is not ready returns { blocked } with the same missing/conflicting detail
// the engine would refuse on, so the UI explains what to resolve rather than
// computing on a gap.
export async function getEngineInputForContext({
  data,
  context,
}: {
  data: { project_id: string };
  context: ServerContext;
}): Promise<
  | { blocked: false; input: UnderwritingInput }
  | { blocked: true; missing: string[]; conflicting: string[]; impossible: string[] }
> {
  try {
    const input = await loadEngineInput(context.supabase, data.project_id);
    return { blocked: false, input };
  } catch (error) {
    if (error instanceof UnderwritingBlockedError) {
      return {
        blocked: true,
        missing: error.readiness.missing,
        conflicting: error.readiness.conflicting,
        impossible: error.readiness.impossible,
      };
    }
    throw error;
  }
}

function scalarValue(rows: ProjectInputRows, key: string): number | null {
  const row = rows.scalars.find(
    (r) =>
      r.key === key &&
      (r.status === "approved" || r.status === "default_accepted") &&
      r.value_numeric != null,
  );
  return row?.value_numeric ?? null;
}

export function buildReconciliationContext(
  rows: ProjectInputRows,
  input: UnderwritingInput,
  output: EngineOutput,
) {
  const perUnitCounts = rows.revenue
    .filter((r) => r.rent_basis === "per_unit" && Number(r.unit_count) > 0)
    .map((r) => Number(r.unit_count));
  // The building's unit total is the SUM of the per-unit-type counts (1BR + 2BR
  // + ...). Treating each unit-type count as a competing building total
  // false-fails every multi-unit-type deal; cross-check the summed total
  // against any document-stated total instead.
  const buildingUnitTotal = perUnitCounts.reduce((sum, n) => sum + n, 0);
  const statedUnits = scalarValue(rows, "stated_unit_count");
  const budgetSum = rows.budget
    .filter((b) => b.status === "approved" || b.status === "default_accepted")
    .reduce((sum, b) => sum + Number(b.amount), 0);
  const statedTotalRow = rows.scalars.find(
    (r) =>
      r.key === "stated_total_project_cost" &&
      (r.status === "approved" || r.status === "default_accepted"),
  );
  const statedTotalSource = statedTotalRow
    ? [statedTotalRow.source_location, statedTotalRow.source_text]
        .filter(Boolean)
        .join(": ")
        .slice(0, 240) || null
    : null;
  return {
    tdc: output.values.tdc,
    equity: output.values.equity,
    loan: output.values.totalDebt,
    noi: output.values.noi,
    amortizingAnnualDebtService: output.values.annualDebtService,
    interestOnlyAnnualDebtService: input.loanAmount * (input.interestRatePct / 100),
    ioCoversHold: (input.ioMonths ?? 0) >= input.holdYears * 12,
    statedLtcPct: scalarValue(rows, "stated_ltc_pct"),
    minDscr: scalarValue(rows, "min_dscr"),
    minAllInDscr: scalarValue(rows, "min_all_in_dscr"),
    allInDscr: output.values.allInDscr,
    minDebtYield: scalarValue(rows, "min_debt_yield"),
    debtYieldPct: output.values.debtYieldPct,
    lenderStabilizedOccupancyPct: scalarValue(rows, "lender_stabilized_occupancy_pct"),
    componentOccupancies: input.revenueProgram.map((r) => ({
      unitType: r.unitType,
      occupancyPct: r.occupancyPct ?? null,
    })),
    statedTotalProjectCost: scalarValue(rows, "stated_total_project_cost"),
    statedTotalSource,
    budgetSum,
    unitCounts: [
      ...(buildingUnitTotal > 0 ? [buildingUnitTotal] : []),
      ...(statedUnits != null ? [statedUnits] : []),
    ],
  };
}

// ---------- Readiness (fail-closed gate) ----------

export async function getUnderwritingReadinessForContext({
  data,
  context,
}: {
  data: { project_id: string };
  context: ServerContext;
}) {
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
  const defaultedKeys = rows.scalars
    .filter((r) => r.status === "default_accepted")
    .map((r) => r.key);
  return { ...readiness, conflicts, defaults, defaultedKeys };
}

// ---------- Defaults are static and consensual ----------

// Persist a batch of accepted static defaults in a SINGLE upsert instead of one
// round-trip per key. Both the analyst ("accept all") and the AI-assisted paths
// accept N keys at once; issuing N sequential upserts was a real N+1 against
// underwriting_inputs. All rows share the (project_id,key) conflict target, so a
// single .upsert([...]) is equivalent - and duplicate keys are collapsed first
// because Postgres rejects a statement that touches the same conflict row twice.
export async function persistAcceptedDefaults(
  supabase: SupabaseFacade,
  opts: {
    projectId: string;
    userId: string;
    keys: string[];
    via: "analyst" | "ai";
  },
): Promise<string[]> {
  const seen = new Set<string>();
  const accepted: string[] = [];
  for (const key of opts.keys) {
    if (seen.has(key) || !DEFAULTS[key]) continue;
    seen.add(key);
    accepted.push(key);
  }
  if (!accepted.length) return [];

  const approvedAt = new Date().toISOString();
  const reason =
    opts.via === "ai"
      ? "AI accepted the consensual static default"
      : "Static default accepted by analyst";
  const rows = accepted.map((key) => ({
    project_id: opts.projectId,
    owner_id: opts.userId,
    key,
    value_numeric: DEFAULTS[key].value,
    source: "default",
    status: "default_accepted",
    formula_text: `${reason}: ${DEFAULTS[key].label}`,
    approved_by: opts.userId,
    approved_at: approvedAt,
  }));
  const { error } = await supabase
    .from("underwriting_inputs")
    .upsert(rows, { onConflict: "project_id,key" });
  if (error) throw new Error(error.message);
  return accepted;
}

async function mirrorAcceptedDefaultsToAssumptions(
  supabase: SupabaseFacade,
  opts: {
    projectId: string;
    userId: string;
    keys: string[];
  },
) {
  const approvedAt = new Date().toISOString();
  for (const engineKey of opts.keys) {
    const taxonomyKey = ENGINE_SCALAR_TO_TAXONOMY[engineKey];
    const def = taxonomyKey ? ASSUMPTION_BY_KEY[taxonomyKey] : null;
    const defaultDef = DEFAULTS[engineKey];
    if (!def || !defaultDef) continue;

    const { data: existing, error: existingError } = await supabase
      .from("assumptions")
      .select("id,current_version,status")
      .eq("project_id", opts.projectId)
      .eq("field_key", taxonomyKey)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    const payload = {
      project_id: opts.projectId,
      owner_id: opts.userId,
      field_key: def.key,
      field_label: def.label,
      category: def.category,
      unit: def.unit,
      value_numeric: defaultDef.value,
      value_text: null,
      status: "default_accepted" as const,
      conflict_values: null,
      confidence_score: 100,
      confidence_band: "high" as const,
      source_document_id: null,
      source_location: "Static default",
      source_text: defaultDef.label,
      formula_text: `Static default accepted by analyst: ${defaultDef.label}`,
      ai_reasoning:
        "Static default accepted explicitly. AI did not invent this value; the deterministic engine reads the fixed default.",
      approved_by: opts.userId,
      approved_at: approvedAt,
    };

    if (existing) {
      const { error } = await supabase
        .from("assumptions")
        .update({
          ...payload,
          current_version: Number(existing.current_version ?? 1) + 1,
        })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("assumptions").insert(payload);
      if (error) throw new Error(error.message);
    }
  }
}

export async function acceptDefaultsForContext({
  data,
  context,
}: {
  data: { project_id: string };
  context: ServerContext;
}) {
  await assertWorkflowPermission(context, data.project_id, "canRunUnderwriting");
  const rows = await loadProjectRows(context.supabase, data.project_id);
  const readiness = computeReadiness(rows);
  const accepted = await persistAcceptedDefaults(context.supabase, {
    projectId: data.project_id,
    userId: context.userId,
    keys: readiness.defaultable,
    via: "analyst",
  });
  await mirrorAcceptedDefaultsToAssumptions(context.supabase, {
    projectId: data.project_id,
    userId: context.userId,
    keys: accepted,
  });
  await context.supabase.from("audit_logs").insert({
    project_id: data.project_id,
    owner_id: context.userId,
    user_id: context.userId,
    entity_type: "underwriting_inputs",
    entity_id: null,
    action: "accept_defaults",
    payload: { accepted, defaults: accepted.map((k) => ({ key: k, value: DEFAULTS[k].value })) },
  });
  return { accepted };
}

// ---------- Deterministic conflict resolution ----------

export type ResolveConflictData = {
  project_id: string;
  key: string;
  mode: "pick" | "conservative";
  value?: number;
  resolution_note?: string;
};

export async function resolveConflictForContext({
  data,
  context,
}: {
  data: ResolveConflictData;
  context: ServerContext;
}) {
  await assertWorkflowPermission(context, data.project_id, "canRunUnderwriting");
  const rows = await loadProjectRows(context.supabase, data.project_id);
  const row = rows.scalars.find((r) => r.key === data.key && r.status === "conflicting");
  if (!row) throw new Error(`No conflicting input found for key ${data.key}.`);
  const candidates = (row.conflict_values ?? [])
    .map((c) => Number(c.value))
    .filter((v) => Number.isFinite(v));
  if (!candidates.length)
    throw new Error(`Conflict for ${data.key} has no recorded candidate values.`);

  let resolved: number;
  if (data.mode === "conservative") {
    resolved = conservativePick(data.key, candidates);
  } else {
    if (data.value == null) throw new Error("mode=pick requires a value.");
    // Picking is constrained to one of the documented candidates: no code
    // path may average, blend, or invent a third value.
    if (!candidates.some((c) => Math.abs(c - data.value!) < 1e-9)) {
      throw new Error(
        `Value ${data.value} is not one of the documented candidates (${candidates.join(", ")}).`,
      );
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
        value_numeric: resolved,
        status: "approved",
        approved_by: context.userId,
        approved_at: new Date().toISOString(),
        ai_reasoning: note,
      })
      .eq("project_id", data.project_id)
      .eq("field_key", taxonomyKey)
      .eq("status", "conflicting");
  }

  await context.supabase.from("audit_logs").insert({
    project_id: data.project_id,
    owner_id: context.userId,
    user_id: context.userId,
    entity_type: "underwriting_inputs",
    entity_id: null,
    action: "resolve_conflict",
    payload: { key: data.key, mode: data.mode, resolved, candidates, note },
  });
  return { key: data.key, resolved, note };
}

// ---------- AI-assisted input selection (never invents a value) ----------
//
// "AI selects inputs, the engine computes." The ONLY thing AI may do here is
// choose, from the consensual STATIC defaults in DEFAULTS, which defaultable
// inputs are reasonable to accept on the analyst's behalf so a deal blocked
// solely by defaultable gaps can run. It selects by index from a fixed list.
// it cannot change a value or introduce a number that is not already a
// pre-approved constant. Accepted rows are written as default_accepted with
// provenance and remain fully visible and reversible by the analyst.
async function aiSelectDefaults(
  ctx: ServerContext,
  projectId: string,
  defaultable: string[],
): Promise<string[]> {
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
      "You are an institutional real estate underwriter deciding which STATIC, pre-approved default assumptions are reasonable to accept for a development pro forma. You may ONLY accept or skip the listed defaults: you cannot change a value or introduce a new one. Accept a default only when its fixed value is a standard, defensible market convention for that missing input.",
    prompt: `Missing defaultable inputs and their fixed default values:\n${list}\n\nReturn ONLY a JSON array of the integer indices you accept (e.g. [0,2]). Return [] to accept none.`,
  });
  const m = text.match(/\[[\s\S]*?\]/);
  let indices: unknown = [];
  try {
    indices = m ? JSON.parse(m[0]) : [];
  } catch {
    indices = [];
  }
  const chosenKeys: string[] = [];
  for (const raw of Array.isArray(indices) ? indices : []) {
    const key = keys[Number(raw)];
    if (key) chosenKeys.push(key);
  }
  const accepted = await persistAcceptedDefaults(ctx.supabase, {
    projectId,
    userId: ctx.userId,
    keys: chosenKeys,
    via: "ai",
  });
  if (accepted.length) {
    await mirrorAcceptedDefaultsToAssumptions(ctx.supabase, {
      projectId,
      userId: ctx.userId,
      keys: accepted,
    });
    await ctx.supabase.from("audit_logs").insert({
      project_id: projectId,
      owner_id: ctx.userId,
      user_id: ctx.userId,
      entity_type: "underwriting_inputs",
      entity_id: null,
      action: "ai_accept_defaults",
      payload: { accepted, defaults: accepted.map((k) => ({ key: k, value: DEFAULTS[k].value })) },
    });
  }
  return accepted;
}

// ---------- The underwriting run (engine math is always deterministic) ----------

export type RunFullUnderwritingData = {
  project_id: string;
  mode: "ai" | "deterministic";
};

export async function runFullUnderwritingForContext(
  data: RunFullUnderwritingData,
  context: ServerContext,
) {
  await assertWorkflowPermission(context, data.project_id, "canRunUnderwriting");
  const { enforceRateLimit } = await import("./rate-limit.server");
  await enforceRateLimit(context, "underwriting_run", {
    metadata: { project_id: data.project_id, mode: data.mode ?? "ai" },
  });
  const { hasAnthropicKey } = await import("./ai-gateway.server");
  const aiAvailable = hasAnthropicKey();
  const wantsAI = data.mode === "ai";
  const useAI = wantsAI && aiAvailable;
  let aiFailureReason: string | null =
    wantsAI && !aiAvailable
      ? "AI unavailable (ANTHROPIC_API_KEY missing or malformed): used the deterministic engine."
      : null;
  if (aiFailureReason) {
    await auditWorkflowEvent(context, data.project_id, "ai_fallback", {
      feature: "underwriting",
      reason: aiFailureReason,
    });
  }
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
      await auditWorkflowEvent(context, data.project_id, "ai_fallback", {
        feature: "underwriting",
        reason: aiFailureReason,
      });
    }
  }
  const analysisMode: "ai" | "deterministic" = useAI && !aiFailureReason ? "ai" : "deterministic";
  const aiMeta = {
    analysis_mode: analysisMode,
    ai_used: analysisMode === "ai",
    ai_note: aiFailureReason,
    ai_accepted_defaults: aiAcceptedDefaults,
    authority_note: AI_AUTHORITY_NOTE,
  };

  if (readiness.status === "blocked") {
    const { stableJsonHash } = await import("./hash.server");
    const inputFingerprint = stableJsonHash({
      readiness,
      rows: normalizeProjectRows(rows),
    });
    let blockedRun = await persistUnderwritingRunTransaction(context, {
      projectId: data.project_id,
      status: "blocked",
      mode: analysisMode,
      inputFingerprint,
      blockedReasons: runBlockedReasons(readiness),
      acceptedDefaults: acceptedDefaultsUsed(rows),
      conflictResolutions: conflictResolutionsUsed(rows),
      inputSnapshot: normalizeProjectRows(rows),
      auditPayload: {
        readiness,
        analysis_mode: analysisMode,
        ai_note: aiFailureReason,
      },
    });
    if (!blockedRun) {
      blockedRun = await insertUnderwritingRun(context, {
        projectId: data.project_id,
        status: "blocked",
        mode: analysisMode,
        inputFingerprint,
        blockedReasons: runBlockedReasons(readiness),
        acceptedDefaults: acceptedDefaultsUsed(rows),
        conflictResolutions: conflictResolutionsUsed(rows),
        inputSnapshot: normalizeProjectRows(rows),
      });
      // Fail closed: zero metrics, zero charts, no partial numbers.
      await auditWorkflowEvent(context, data.project_id, "underwriting_blocked", {
        readiness,
        analysis_mode: analysisMode,
        ai_note: aiFailureReason,
        run_id: blockedRun?.id ?? null,
        run_number: blockedRun?.run_number ?? null,
        input_fingerprint: inputFingerprint,
      });
    }
    return {
      blocked: true as const,
      readiness,
      run_version: blockedRun
        ? { id: blockedRun.id, run_number: blockedRun.run_number, status: blockedRun.status }
        : null,
      ...aiMeta,
    };
  }
  await assertApprovedAssumptionsSynced(context.supabase, data.project_id);

  const input = assembleEngineInput(rows);
  const { stableJsonHash } = await import("./hash.server");
  const inputFingerprint = stableJsonHash(input);

  // Idempotency: key the run by (project, content-hash of the engine input +
  // mode). A double-click or retry with identical inputs returns the cached
  // result instead of re-running the (billing-relevant) insight/findings work
  // and re-writing the output tables.
  const { claimJob, completeJob } = await import("./extraction-jobs.server");
  const runKey = stableJsonHash({ input, mode: analysisMode });
  const { job: runJob, existed: runExisted } = await claimJob(context, {
    kind: "underwriting",
    idempotencyKey: runKey,
    projectId: data.project_id,
    message: "Running underwriting",
  });
  if (runExisted && runJob.status === "completed" && runJob.result_json) {
    const prevRunId = (runJob.result_json as any)?.run_version?.id as string | undefined;
    let query = context.supabase
      .from("financial_outputs")
      .select("scenario_key,metric_key,metric_label,value_numeric,unit,formula_text")
      .eq("project_id", data.project_id);
    if (prevRunId) query = query.eq("run_id", prevRunId);
    const { data: cachedOutputs, error } = await query;
    if (error) throw new Error(error.message);
    if ((cachedOutputs ?? []).length > 0) {
      const cachedOutputSnapshot = outputSnapshot(
        (cachedOutputs ?? []) as Array<Record<string, unknown>>,
      );
      const cachedRun = await insertUnderwritingRun(context, {
        projectId: data.project_id,
        status: "completed",
        mode: analysisMode,
        inputFingerprint,
        outputFingerprint: stableJsonHash(cachedOutputSnapshot),
        verdictCode:
          ((runJob.result_json as any)?.verdict?.code as string | undefined) ??
          ((runJob.result_json as any)?.verdictCode as string | undefined) ??
          null,
        acceptedDefaults: acceptedDefaultsUsed(rows),
        conflictResolutions: conflictResolutionsUsed(rows),
        inputSnapshot: input,
        outputSnapshot: cachedOutputSnapshot,
      });
      await auditWorkflowEvent(context, data.project_id, "underwriting_run_version_created", {
        run_id: cachedRun?.id ?? null,
        run_number: cachedRun?.run_number ?? null,
        source: "cached_completed_job",
        input_fingerprint: inputFingerprint,
      });
      if (cachedRun?.id) {
        await stampLatestRowsWithRunId(context.supabase, data.project_id, cachedRun.id, [
          "financial_outputs",
          "cash_flows",
          "reconciliation_flags",
          "risk_register",
        ]);
        await copyLatestCompatibilityRowsToRun(context.supabase, data.project_id, cachedRun.id);
      }
      return {
        ...(runJob.result_json as any),
        run_version: cachedRun
          ? { id: cachedRun.id, run_number: cachedRun.run_number, status: cachedRun.status }
          : null,
      };
    }
  }

  const base = runUnderwriting(input);

  // Derived tier: persist the calculated TDC with its formula so a derivable
  // total is never reported as missing.
  const calculated = deriveCalculatedTdc(rows.budget);
  if (calculated) {
    await context.supabase.from("underwriting_inputs").upsert(
      {
        project_id: data.project_id,
        owner_id: context.userId,
        key: "total_project_cost",
        value_numeric: calculated.value,
        source: "analyst",
        status: "calculated",
        formula_text: calculated.formula_text,
      },
      { onConflict: "project_id,key" },
    );
  }

  // Reconciliation gates run automatically with every engine run.
  const flags: ReconciliationFlag[] = [
    ...runReconciliationChecks(buildReconciliationContext(rows, input, base)),
    ...base.warnings.map((w) => ({
      check_key: w.key,
      severity: "warning" as const,
      message: w.message,
      expected: w.expected,
      actual: w.actual,
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

  // ---- Deterministic Insight Layer (context, benchmarks, attribution, NLG) ----
  // Portfolio-derived norms (the firm's own deals) blend with curated defaults
  // for context-aware judgment. Scoped to the project's workspace so team-wide
  // norms are consistent across analysts.
  const { data: projectWs } = await context.supabase
    .from("projects")
    .select("workspace_id")
    .eq("id", data.project_id)
    .maybeSingle();
  const peerProjectIds = projectWs?.workspace_id
    ? await context.supabase
        .from("projects")
        .select("id")
        .eq("workspace_id", projectWs.workspace_id)
        .neq("id", data.project_id)
        .then((r: { data: Array<{ id: string }> | null }) => r.data?.map((p) => p.id) ?? [])
    : [];
  const { data: portfolioRows } = peerProjectIds.length
    ? await context.supabase
        .from("financial_outputs")
        .select("project_id, metric_key, value_numeric")
        .in("project_id", peerProjectIds)
        .eq("scenario_key", "base")
    : { data: [] };
  const portfolioNorms = computePortfolioNorms((portfolioRows ?? []) as any);
  const { data: projectRow } = await context.supabase
    .from("projects")
    .select("name, type, location")
    .eq("id", data.project_id)
    .maybeSingle();

  // ONE recommendation: reconcile the gate verdict with the findings engine and
  // the contextual read so every surface (Analysis, Decision, memo) agrees.
  // Call generateFindings EXACTLY as buildDecision (the decision/findings tab)
  // does: real assumptions, scenarios, and NO engine `input`: so the
  // persisted recommendation matches what the Decision tab would compute.
  const { data: findingsAssumptions } = await context.supabase
    .from("assumptions")
    .select("field_key,value_numeric,status,confidence_score")
    .eq("project_id", data.project_id);
  let findingsRec: string | null = null;
  try {
    const scenarios = scenarioOutputs
      .filter((s) => s.key !== "base")
      .map((s) => ({ key: s.key, label: s.key, output: s.output }));
    findingsRec = generateFindings(
      base,
      (findingsAssumptions ?? []) as any,
      scenarios as any,
    ).recommendation;
  } catch {
    findingsRec = null;
  }
  const dealContext = deriveDealContext(input, {
    type: projectRow?.type ?? null,
    location: projectRow?.location ?? null,
  });
  const interpretationsForRec = interpretDeal(base, dealContext, {
    portfolioNorms,
    portfolioMinSample: 6,
  });
  const reconciled = reconcileRecommendation({
    verdictCode: verdict.code,
    hardFail: verdict.hardFail,
    findingsRec,
    weakContext: interpretationsForRec.some((i) => i.band === "weak" || i.band === "critical"),
  });

  const insight = buildInsight(base, input, {
    meta: {
      name: projectRow?.name ?? null,
      type: projectRow?.type ?? null,
      location: projectRow?.location ?? null,
    },
    benchInputs: { portfolioNorms, portfolioMinSample: 6 },
    covenants: {
      minDscr: scalarValue(rows, "min_dscr"),
      minDebtYield: scalarValue(rows, "min_debt_yield"),
    },
    verdictCode: reconciled.code,
  });

  const outputInserts: Array<Record<string, unknown>> = [];
  for (const { key: scenarioKey, output } of scenarioOutputs) {
    for (const metric of output.metrics) {
      outputInserts.push({
        project_id: data.project_id,
        owner_id: context.userId,
        scenario_key: scenarioKey,
        metric_key: metric.key,
        metric_label: metric.label,
        value_numeric: Number.isFinite(metric.value) ? metric.value : null,
        unit: metric.unit,
        formula_text: metric.formula,
        inputs: { engine_input_keys: Object.keys(input), scenario: scenarioKey },
      });
    }
  }
  outputInserts.push({
    project_id: data.project_id,
    owner_id: context.userId,
    scenario_key: "base",
    metric_key: "risk_score",
    metric_label: "Risk Score",
    value_numeric: riskScore,
    unit: "count",
    formula_text: "Fixed thresholds over engine outputs + reconciliation flags (no LLM).",
    inputs: { error_flags: errorFlags.length },
  });
  outputInserts.push({
    project_id: data.project_id,
    owner_id: context.userId,
    scenario_key: "base",
    metric_key: "verdict",
    metric_label: "Deterministic Verdict",
    value_numeric: null,
    unit: "count",
    formula_text: `${verdict.code}: ${verdict.gates.filter((g) => !g.pass).length} of ${verdict.gates.length} gates failed${verdict.hardFail ? "; hard fail (equity wipeout or error-severity reconciliation flag)" : ""}`,
    inputs: { code: verdict.code, gates: verdict.gates, hardFail: verdict.hardFail },
  });
  // The deterministic "analyst read": thesis, contextual interpretations,
  // what-if levers, and audience-adapted narratives (all provenance-clean).
  outputInserts.push({
    project_id: data.project_id,
    owner_id: context.userId,
    scenario_key: "base",
    metric_key: "insight",
    metric_label: "Deterministic Read",
    value_numeric: null,
    unit: "count",
    formula_text: insight.thesis,
    inputs: {
      recommendation: reconciled.code,
      recommendationRationale: reconciled.rationale,
      gateVerdict: verdict.code,
      context: insight.context,
      interpretations: insight.interpretations,
      levers: insight.attribution.levers,
      drivers: insight.attribution.drivers,
      bullets: insight.bullets,
      narratives: {
        ic: writeNarrative(insight, "ic"),
        lender: writeNarrative(insight, "lender"),
        investor: writeNarrative(insight, "investor"),
        internal: writeNarrative(insight, "internal"),
      },
      derivedValues: insight.derivedValues,
      portfolioSample: portfolioNorms.sampleSize,
    },
  });
  const persistedOutputSnapshot = outputSnapshot(outputInserts);
  const outputFingerprint = stableJsonHash(persistedOutputSnapshot);
  const cashFlowInserts: Array<Record<string, unknown>> = scenarioOutputs.flatMap(
    ({ key: scenarioKey, output }) =>
      output.cashFlows.map((row) => ({
        project_id: data.project_id,
        owner_id: context.userId,
        scenario_key: scenarioKey,
        period_year: row.periodYear,
        line_key: row.lineKey,
        amount: row.amount,
      })),
  );
  const flagRows: Array<Record<string, unknown>> = flags.map((flag) => ({
    project_id: data.project_id,
    owner_id: context.userId,
    ...flag,
  }));
  const riskRows: Array<Record<string, unknown>> = risks.map((risk) => ({
    project_id: data.project_id,
    owner_id: context.userId,
    ...risk,
  }));
  const runAuditPayload = {
    scenarios: scenarioOutputs.map((s) => s.key),
    verdict: verdict.code,
    risk_score: riskScore,
    error_flags: errorFlags.length,
    equity_wipeout: base.equityWipeout,
    analysis_mode: analysisMode,
    ai_accepted_defaults: aiAcceptedDefaults,
  };
  const resultBase = {
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

  const transactionalRun = await persistUnderwritingRunTransaction(context, {
    projectId: data.project_id,
    status: "completed",
    mode: analysisMode,
    inputFingerprint,
    outputFingerprint,
    verdictCode: verdict.code,
    acceptedDefaults: acceptedDefaultsUsed(rows),
    conflictResolutions: conflictResolutionsUsed(rows),
    inputSnapshot: input,
    outputSnapshot: persistedOutputSnapshot,
    financialOutputs: outputInserts,
    cashFlows: cashFlowInserts,
    reconciliationFlags: flagRows,
    risks: riskRows,
    auditPayload: runAuditPayload,
    jobId: runJob.id,
    jobResult: resultBase,
  });
  if (transactionalRun) {
    const runVersionInfo = {
      id: transactionalRun.id,
      run_number: transactionalRun.run_number,
      status: transactionalRun.status,
    };
    // Ensure idempotency and audit even on the RPC path.
    await completeJob(context, runJob.id, { ...resultBase, run_version: runVersionInfo });
    const { writeAuditEvent } = await import("./audit.server");
    await writeAuditEvent(context, {
      projectId: data.project_id,
      entityType: "project",
      entityId: data.project_id,
      action: "run_full_underwriting",
      payload: {
        ...runAuditPayload,
        run_id: transactionalRun.id,
        run_number: transactionalRun.run_number,
        input_fingerprint: inputFingerprint,
        output_fingerprint: outputFingerprint,
      },
    });
    return {
      ...resultBase,
      run_version: {
        id: transactionalRun.id,
        run_number: transactionalRun.run_number,
        status: transactionalRun.status,
      },
    };
  }

  // Compatibility path for explicitly supported older schemas where the RPC
  // has not landed yet.
  await deleteLatestUnderwritingOutputs(context, data.project_id);

  const completedRun = await insertUnderwritingRun(context, {
    projectId: data.project_id,
    status: "completed",
    mode: analysisMode,
    inputFingerprint,
    outputFingerprint,
    verdictCode: verdict.code,
    acceptedDefaults: acceptedDefaultsUsed(rows),
    conflictResolutions: conflictResolutionsUsed(rows),
    inputSnapshot: input,
    outputSnapshot: persistedOutputSnapshot,
  });
  if (completedRun) {
    await insertRunHistoryRows(
      context.supabase,
      "financial_outputs",
      outputInserts,
      completedRun.id,
      "insert normalized financial outputs",
    );
    for (const row of outputInserts) row.run_id = completedRun.id;
  }
  const { error: outErr } = await insertRowsWithRunIdCompatibility(
    context.supabase,
    "financial_outputs",
    outputInserts,
    "insert financial outputs",
  );
  if (outErr) throw new Error(outErr.message);

  for (const row of cashFlowInserts) row.run_id = completedRun?.id ?? null;
  if (completedRun) {
    await insertRunHistoryRows(
      context.supabase,
      "cash_flows",
      cashFlowInserts,
      completedRun.id,
      "insert normalized cash flows",
    );
  }
  if (cashFlowInserts.length) {
    const { error } = await insertRowsWithRunIdCompatibility(
      context.supabase,
      "cash_flows",
      cashFlowInserts,
      "insert cash flows",
    );
    if (error) throw new Error(error.message);
  }

  if (flags.length) {
    for (const row of flagRows) row.run_id = completedRun?.id ?? null;
    if (completedRun) {
      await insertRunHistoryRows(
        context.supabase,
        "reconciliation_flags",
        flagRows,
        completedRun.id,
        "insert normalized reconciliation flags",
      );
    }
    const { error } = await insertRowsWithRunIdCompatibility(
      context.supabase,
      "reconciliation_flags",
      flagRows,
      "insert reconciliation flags",
    );
    if (error) throw new Error(error.message);
  }

  if (risks.length) {
    for (const row of riskRows) row.run_id = completedRun?.id ?? null;
    if (completedRun) {
      await insertRunHistoryRows(
        context.supabase,
        "risk_register",
        riskRows,
        completedRun.id,
        "insert normalized risk register",
      );
    }
    const { error } = await insertRowsWithRunIdCompatibility(
      context.supabase,
      "risk_register",
      riskRows,
      "insert risk register",
    );
    if (error) throw new Error(error.message);
  }

  const { writeAuditEvent } = await import("./audit.server");
  await writeAuditEvent(context, {
    projectId: data.project_id,
    entityType: "project",
    entityId: data.project_id,
    action: "run_full_underwriting",
    payload: {
      ...runAuditPayload,
      run_id: completedRun?.id ?? null,
      run_number: completedRun?.run_number ?? null,
      input_fingerprint: inputFingerprint,
      output_fingerprint: outputFingerprint,
    },
  });

  const result = {
    ...resultBase,
    run_version: completedRun
      ? { id: completedRun.id, run_number: completedRun.run_number, status: completedRun.status }
      : null,
  };
  await completeJob(context, runJob.id, result);
  return result;
}

export async function listReconciliationFlagsForContext({
  data,
  context,
}: {
  data: { project_id: string };
  context: ServerContext;
}) {
  const { data: rows, error } = await context.supabase
    .from("reconciliation_flags")
    .select("*")
    .eq("project_id", data.project_id)
    .order("severity", { ascending: false });
  if (error) throw new Error(error.message);
  return rows ?? [];
}

export async function listUnderwritingRunsForContext({
  data,
  context,
}: {
  data: { project_id: string; limit?: number };
  context: ServerContext;
}) {
  const limit = Math.min(Math.max(data.limit ?? 10, 1), 25);
  const { data: rows, error } = await context.supabase
    .from("underwriting_runs")
    .select("*")
    .eq("project_id", data.project_id)
    .order("run_number", { ascending: false })
    .limit(limit);
  if (isMissingRelation(error)) {
    return handleSchemaCompatibilityFallback(error, {
      featureName: "underwriting run versions",
      table: "underwriting_runs",
      operation: "list run versions",
      fallback: [],
    });
  }
  if (error) throw new Error(error.message);
  return rows ?? [];
}

async function getUnderwritingRunForProject(
  supabase: SupabaseFacade,
  projectId: string,
  runId: string,
) {
  const { data: run, error } = await supabase
    .from("underwriting_runs")
    .select("*")
    .eq("project_id", projectId)
    .eq("id", runId)
    .maybeSingle();
  if (isMissingRelation(error)) {
    return handleSchemaCompatibilityFallback(error, {
      featureName: "underwriting run versions",
      table: "underwriting_runs",
      operation: "load run version",
      fallback: null,
    });
  }
  if (error) throw new Error(error.message);
  return run ?? null;
}

export async function getLatestCompletedRunForContext({
  data,
  context,
}: {
  data: { project_id: string };
  context: ServerContext;
}) {
  const { data: run, error } = await context.supabase
    .from("underwriting_runs")
    .select("*")
    .eq("project_id", data.project_id)
    .eq("status", "completed")
    .order("run_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (isMissingRelation(error)) {
    return handleSchemaCompatibilityFallback(error, {
      featureName: "underwriting run versions",
      table: "underwriting_runs",
      operation: "load latest completed run",
      fallback: null,
    });
  }
  if (error) throw new Error(error.message);
  return run ?? null;
}

async function selectRunScopedRows(
  supabase: SupabaseFacade,
  table: string,
  projectId: string,
  runId: string,
  select = "*",
) {
  const historyTable = RUN_HISTORY_TABLES[table as keyof typeof RUN_HISTORY_TABLES];
  if (historyTable) {
    const historyRes = await supabase
      .from(historyTable)
      .select(select)
      .eq("project_id", projectId)
      .eq("run_id", runId);
    if (isMissingRelation(historyRes.error)) {
      handleSchemaCompatibilityFallback(historyRes.error, {
        featureName: "normalized underwriting run history",
        table: historyTable,
        operation: "load normalized run rows",
        fallback: null,
      });
    } else {
      if (historyRes.error) return historyRes;
      if ((historyRes.data ?? []).length) return historyRes;
    }
  }

  const res = await supabase
    .from(table)
    .select(select)
    .eq("project_id", projectId)
    .eq("run_id", runId);
  if (!isMissingColumn(res.error)) return res;

  handleSchemaCompatibilityFallback(res.error, {
    featureName: "underwriting run scoped outputs",
    table,
    column: "run_id",
    operation: "load run scoped rows",
    fallback: null,
  });
  return { data: [], error: null };
}

export async function listFinancialOutputsForRunForContext({
  data,
  context,
}: {
  data: { project_id: string; run_id: string };
  context: ServerContext;
}) {
  const run = await getUnderwritingRunForProject(context.supabase, data.project_id, data.run_id);
  if (!run) return [];
  const { data: rows, error } = await selectRunScopedRows(
    context.supabase,
    "financial_outputs",
    data.project_id,
    data.run_id,
  );
  if (error) throw new Error(error.message);
  if ((rows ?? []).length) return rows ?? [];
  return Array.isArray(run.output_snapshot) ? run.output_snapshot : [];
}

export async function listCashFlowsForRunForContext({
  data,
  context,
}: {
  data: { project_id: string; run_id: string };
  context: ServerContext;
}) {
  const { data: rows, error } = await selectRunScopedRows(
    context.supabase,
    "cash_flows",
    data.project_id,
    data.run_id,
  );
  if (error) throw new Error(error.message);
  return rows ?? [];
}

export async function listReconciliationFlagsForRunForContext({
  data,
  context,
}: {
  data: { project_id: string; run_id: string };
  context: ServerContext;
}) {
  const { data: rows, error } = await selectRunScopedRows(
    context.supabase,
    "reconciliation_flags",
    data.project_id,
    data.run_id,
  );
  if (error) throw new Error(error.message);
  return rows ?? [];
}

export async function listRisksForRunForContext({
  data,
  context,
}: {
  data: { project_id: string; run_id: string };
  context: ServerContext;
}) {
  const { data: rows, error } = await selectRunScopedRows(
    context.supabase,
    "risk_register",
    data.project_id,
    data.run_id,
  );
  if (error) throw new Error(error.message);
  return rows ?? [];
}

export async function getLatestCompletedRunOutputsForContext({
  data,
  context,
}: {
  data: { project_id: string };
  context: ServerContext;
}) {
  const run = await getLatestCompletedRunForContext({ data, context });
  if (!run) {
    return { run: null, outputs: [], cash_flows: [], reconciliation_flags: [], risks: [] };
  }
  const [outputs, cashFlows, flags, risks] = await Promise.all([
    listFinancialOutputsForRunForContext({
      data: { project_id: data.project_id, run_id: run.id },
      context,
    }),
    listCashFlowsForRunForContext({
      data: { project_id: data.project_id, run_id: run.id },
      context,
    }),
    listReconciliationFlagsForRunForContext({
      data: { project_id: data.project_id, run_id: run.id },
      context,
    }),
    listRisksForRunForContext({
      data: { project_id: data.project_id, run_id: run.id },
      context,
    }),
  ]);
  return { run, outputs, cash_flows: cashFlows, reconciliation_flags: flags, risks };
}

export async function getUnderwritingRunStateForContext({
  data,
  context,
}: {
  data: { project_id: string };
  context: ServerContext;
}) {
  const permissions = await getWorkflowPermissionsForProject(context, data.project_id);
  const basis = await currentInputBasis(context.supabase, data.project_id);
  const runs = await listUnderwritingRunsForContext({
    data: { project_id: data.project_id, limit: 10 },
    context,
  });
  const latestCompleted = runs.find((run: any) => run.status === "completed") ?? null;
  const latestRun = runs[0] ?? null;
  const freshness =
    basis.readiness.status === "blocked"
      ? "blocked"
      : !latestCompleted
        ? "pending"
        : latestCompleted.input_fingerprint === basis.inputFingerprint
          ? "current"
          : "stale";
  return {
    project_id: data.project_id,
    freshness,
    readiness: basis.readiness,
    current_input_fingerprint: basis.inputFingerprint,
    latest_run: latestRun,
    latest_completed_run: latestCompleted,
    runs,
    permissions,
  };
}
