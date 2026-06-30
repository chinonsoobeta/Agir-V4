// Snapshot / lock a memo at IC submission.
//
// When a decision is recorded we freeze the exact inputs (approved assumptions),
// engine outputs, and rendered report behind an immutable version. A later
// assumption edit + re-run can then be DIFFED against what the committee
// actually saw, and can never silently rewrite the record.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { isMissingRelation } from "./db-compat";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

const SNAPSHOT_ASSUMPTION_STATUSES: Database["public"]["Enums"]["assumption_status"][] = [
  "approved",
  "modified",
  "default_accepted",
  "calculated",
];

type Ctx = { supabase: SupabaseClient<Database>; userId: string };
type MemoSnapshotRow = Database["public"]["Tables"]["memo_snapshots"]["Row"];

// The investment_memos.content / financial_outputs.inputs and the *_json
// snapshot columns are stored as untyped Json. These read nested fields off
// that dynamic shape defensively (identical to the prior `any` access: a missing
// or non-object value yields undefined/null).
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function loadSnapshotInputs(ctx: Ctx, projectId: string) {
  const [{ data: assumptions }, { data: outputs }, { data: memos }] = await Promise.all([
    ctx.supabase
      .from("assumptions")
      .select("field_key, field_label, value_numeric, value_text, unit, status, confidence_score")
      .eq("project_id", projectId)
      .in("status", SNAPSHOT_ASSUMPTION_STATUSES),
    ctx.supabase
      .from("financial_outputs")
      .select("scenario_key, metric_key, metric_label, value_numeric, unit, formula_text")
      .eq("project_id", projectId),
    ctx.supabase
      .from("investment_memos")
      .select("id, content, status, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  const memo = (memos ?? [])[0] ?? null;
  const memoReport = asRecord(asRecord(memo?.content)?.report);
  const report = (asRecord(memo?.content)?.report ?? null) as Json;
  const verdictRow = (outputs ?? []).find((o) => o.metric_key === "verdict");
  const verdictRaw =
    asRecord(asRecord(verdictRow)?.inputs)?.code ?? memoReport?.verdict_code ?? null;
  const verdictCode = typeof verdictRaw === "string" ? verdictRaw : null;
  return {
    assumptions: assumptions ?? [],
    outputs: outputs ?? [],
    memoId: memo?.id ?? null,
    report,
    verdictCode,
  };
}

/**
 * Create a frozen snapshot for a project, optionally tied to a decision. Called
 * from recordDecision at IC submission, and exposed directly so an analyst can
 * also pin a checkpoint. Returns the inserted snapshot row.
 */
export async function createMemoSnapshotInternal(
  ctx: Ctx,
  projectId: string,
  decisionId: string | null,
): Promise<MemoSnapshotRow> {
  const { stableJsonHash } = await import("./hash.server");
  const inputs = await loadSnapshotInputs(ctx, projectId);
  const contentHash = stableJsonHash({
    assumptions: inputs.assumptions,
    outputs: inputs.outputs.map((o) => ({
      s: o.scenario_key,
      m: o.metric_key,
      v: o.value_numeric,
    })),
  });

  const { data: prof } = await ctx.supabase
    .from("profiles")
    .select("full_name,email")
    .eq("id", ctx.userId)
    .maybeSingle();
  const createdByName = prof?.full_name || prof?.email || "user";

  const { data: last, error: lastError } = await ctx.supabase
    .from("memo_snapshots")
    .select("version")
    .eq("project_id", projectId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (isMissingRelation(lastError)) {
    throw new Error("Memo snapshots need the latest database migration.");
  }
  if (lastError) throw new Error(lastError.message);
  const version = (last?.version ?? 0) + 1;

  const { data: row, error } = await ctx.supabase
    .from("memo_snapshots")
    .insert({
      project_id: projectId,
      owner_id: ctx.userId,
      memo_id: inputs.memoId,
      decision_id: decisionId,
      version,
      verdict_code: inputs.verdictCode,
      assumptions_json: inputs.assumptions,
      outputs_json: inputs.outputs,
      report_json: inputs.report,
      content_hash: contentHash,
      created_by: ctx.userId,
      created_by_name: createdByName,
    })
    .select()
    .single();
  if (isMissingRelation(error)) {
    throw new Error("Memo snapshots need the latest database migration.");
  }
  if (error) throw new Error(error.message);
  return row;
}

export const createMemoSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => createMemoSnapshotInternal(context, data.project_id, null));

export const listMemoSnapshots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("memo_snapshots")
      .select("id, version, verdict_code, content_hash, decision_id, created_at, created_by_name")
      .eq("project_id", data.project_id)
      .order("version", { ascending: false });
    if (isMissingRelation(error)) return [];
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/**
 * Diff a frozen snapshot against the project's CURRENT inputs + outputs. Used by
 * the UI to show "what changed since the committee saw this" if the deal was
 * re-run after submission.
 */
export const diffMemoSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { snapshot_id: string }) => z.object({ snapshot_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: snap, error } = await context.supabase
      .from("memo_snapshots")
      .select("*")
      .eq("id", data.snapshot_id)
      .single();
    if (isMissingRelation(error)) {
      return {
        snapshot_id: data.snapshot_id,
        version: null,
        locked_at: null,
        content_hash: null,
        current_hash: null,
        drifted: false,
        assumption_changes: [],
        output_changes: [],
        unavailable: "Memo snapshots need the latest database migration.",
      };
    }
    if (error) throw new Error(error.message);

    const current = await loadSnapshotInputs(context, snap.project_id);
    const { stableJsonHash } = await import("./hash.server");
    const currentHash = stableJsonHash({
      assumptions: current.assumptions,
      outputs: current.outputs.map((o) => ({
        s: o.scenario_key,
        m: o.metric_key,
        v: o.value_numeric,
      })),
    });

    type AssumptionChange = {
      field_key: string;
      field_label: Json;
      was: Json;
      now: Json;
      kind: "added" | "removed" | "changed";
    };
    type OutputChange = {
      scenario_key: Json;
      metric_key: Json;
      metric_label: Json;
      unit: Json;
      was: Json;
      now: Json;
    };

    type JsonRecord = Record<string, Json | undefined>;
    const lockedA = new Map<string, JsonRecord>(
      asArray(snap.assumptions_json)
        .map(asRecord)
        .filter((a): a is Record<string, unknown> => a !== undefined)
        .map((a) => [String(a.field_key), a as JsonRecord]),
    );
    const curA = new Map<string, JsonRecord>(
      current.assumptions.map((a) => [String(a.field_key), a as JsonRecord]),
    );
    const assumptionChanges: AssumptionChange[] = [];
    for (const key of new Set([...lockedA.keys(), ...curA.keys()])) {
      const was = lockedA.get(key);
      const now = curA.get(key);
      const wv = was?.value_numeric ?? was?.value_text ?? null;
      const nv = now?.value_numeric ?? now?.value_text ?? null;
      if (JSON.stringify(wv) !== JSON.stringify(nv)) {
        assumptionChanges.push({
          field_key: key,
          field_label: now?.field_label ?? was?.field_label ?? key,
          was: wv,
          now: nv,
          kind: !was ? "added" : !now ? "removed" : "changed",
        });
      }
    }

    const keyOf = (o: JsonRecord) => `${o.scenario_key}::${o.metric_key}`;
    const lockedO = new Map<string, JsonRecord>(
      asArray(snap.outputs_json)
        .map(asRecord)
        .filter((o): o is Record<string, unknown> => o !== undefined)
        .map((o) => [keyOf(o as JsonRecord), o as JsonRecord]),
    );
    const curO = new Map<string, JsonRecord>(
      current.outputs.map((o) => [keyOf(o as JsonRecord), o as JsonRecord]),
    );
    const outputChanges: OutputChange[] = [];
    for (const k of new Set([...lockedO.keys(), ...curO.keys()])) {
      const was = lockedO.get(k);
      const now = curO.get(k);
      if ((was?.value_numeric ?? null) !== (now?.value_numeric ?? null)) {
        outputChanges.push({
          scenario_key: (now ?? was)?.scenario_key ?? null,
          metric_key: (now ?? was)?.metric_key ?? null,
          metric_label: (now ?? was)?.metric_label ?? null,
          unit: (now ?? was)?.unit ?? null,
          was: was?.value_numeric ?? null,
          now: now?.value_numeric ?? null,
        });
      }
    }

    return {
      snapshot_id: snap.id,
      version: snap.version,
      locked_at: snap.created_at,
      content_hash: snap.content_hash,
      current_hash: currentHash,
      drifted: currentHash !== snap.content_hash,
      assumption_changes: assumptionChanges,
      output_changes: outputChanges,
    };
  });
