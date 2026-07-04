// Snapshot / lock a memo at IC submission.
//
// When a decision is recorded we freeze the exact inputs (approved assumptions),
// engine outputs, and rendered report behind an immutable version. A later
// assumption edit + re-run can then be DIFFED against what the committee
// actually saw, and can never silently rewrite the record.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { handleSchemaCompatibilityFallback, isMissingColumn, isMissingRelation } from "./db-compat";

type MemoSnapshotListRow = {
  id: string;
  version: number;
  verdict_code: string | null;
  content_hash: string;
  decision_id: string | null;
  run_id?: string | null;
  created_at: string;
  created_by_name: string | null;
};

export const createMemoSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { createMemoSnapshotInternal } = await import("./memo-snapshot.server");
    return createMemoSnapshotInternal(context, data.project_id, null);
  });

export const listMemoSnapshots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    let read: {
      data: MemoSnapshotListRow[] | null;
      error: { code?: string; message?: string } | null;
    } = await context.supabase
      .from("memo_snapshots")
      .select(
        "id, version, verdict_code, content_hash, decision_id, run_id, created_at, created_by_name",
      )
      .eq("project_id", data.project_id)
      .order("version", { ascending: false });
    if (isMissingColumn(read.error)) {
      handleSchemaCompatibilityFallback(read.error, {
        featureName: "memo snapshot run binding",
        table: "memo_snapshots",
        column: "run_id",
        operation: "list memo snapshots",
        fallback: null,
      });
      read = await context.supabase
        .from("memo_snapshots")
        .select("id, version, verdict_code, content_hash, decision_id, created_at, created_by_name")
        .eq("project_id", data.project_id)
        .order("version", { ascending: false });
    }
    const { data: rows, error } = read;
    if (isMissingRelation(error)) return [];
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const diffMemoSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { snapshot_id: string }) => z.object({ snapshot_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { diffMemoSnapshotInternal } = await import("./memo-snapshot.server");
    return diffMemoSnapshotInternal(context, data.snapshot_id);
  });
