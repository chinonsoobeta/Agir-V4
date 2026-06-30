// Operating-layer server functions (Workstream 3). Every function attaches
// requireSupabaseAuth, validates input with zod, and queries through the
// user-scoped client so RLS is the only authority on what a caller can touch.
//
// 3A execution critical path, 3B IC voting + conditions, 3C connector
// import/export. The deterministic financial engine and its verdict are never
// touched here: this layer is governance and workflow around the deal.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";
import {
  computeCriticalPath,
  type ExecMilestone,
  type MilestoneStatus,
} from "./execution/critical-path";
import {
  tallyVotes,
  transitionCondition,
  conditionsCleared,
  openConditionCount,
  type IcVote,
  type VoteValue,
  type ConditionStatus,
  type ConditionAction,
} from "./committee/voting";
import { getConnector, type DealRecord, type FieldMapping } from "./integrations/connector";
import { isMissingRelation } from "./db-compat";

const today = () => new Date().toISOString().slice(0, 10);

// ===================== 3A. Execution critical path =====================

export const setMilestoneDependencies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), depends_on: z.array(z.string().uuid()).max(50) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("deal_milestones")
      .update({ depends_on: data.depends_on })
      .eq("id", data.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const getCriticalPath = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const [{ data: milestones, error: mErr }, { data: project }] = await Promise.all([
      context.supabase.from("deal_milestones").select("*").eq("project_id", data.project_id),
      context.supabase
        .from("projects")
        .select("target_close_date")
        .eq("id", data.project_id)
        .maybeSingle(),
    ]);
    // Degrade to an empty critical path on an unmigrated schema instead of
    // crashing the Execution page (the deal_milestones table may not exist yet).
    if (mErr && !isMissingRelation(mErr)) throw new Error(mErr.message);
    const execMilestones: ExecMilestone[] = (milestones ?? []).map((m) => ({
      id: m.id,
      title: m.title,
      dueDate: m.due_date ?? null,
      status: m.status as MilestoneStatus,
      dependsOn: Array.isArray(m.depends_on) ? (m.depends_on as string[]) : [],
      priority: m.priority,
    }));
    const result = computeCriticalPath(execMilestones, project?.target_close_date ?? null, today());
    return {
      ...result,
      targetCloseDate: project?.target_close_date ?? null,
      milestoneCount: execMilestones.length,
    };
  });

// ===================== 3B. IC voting + conditions =====================

export const castVote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        vote: z.enum(["approve", "approve_with_conditions", "reject", "abstain"]),
        rationale: z.string().max(4000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("ic_votes")
      .upsert(
        {
          project_id: data.project_id,
          owner_id: context.userId,
          vote: data.vote,
          rationale: data.rationale ?? null,
        },
        { onConflict: "project_id,owner_id" },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_logs").insert({
      project_id: data.project_id,
      owner_id: context.userId,
      user_id: context.userId,
      entity_type: "ic_vote",
      entity_id: row?.id ?? null,
      action: "cast_vote",
      payload: { vote: data.vote },
    });
    return row;
  });

export const listIcVotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("ic_votes")
      .select("*")
      .eq("project_id", data.project_id);
    if (isMissingRelation(error)) return { votes: [], tally: tallyVotes([]) };
    if (error) throw new Error(error.message);
    const votes: IcVote[] = (rows ?? []).map((r) => ({
      memberId: r.owner_id,
      vote: r.vote as VoteValue,
    }));
    return { votes: rows ?? [], tally: tallyVotes(votes) };
  });

export const addCondition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ project_id: z.string().uuid(), label: z.string().min(1).max(1000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("ic_conditions")
      .insert({
        project_id: data.project_id,
        owner_id: context.userId,
        label: data.label,
        status: "open",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateConditionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), action: z.enum(["satisfy", "reopen", "waive"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: current, error: cErr } = await context.supabase
      .from("ic_conditions")
      .select("status")
      .eq("id", data.id)
      .single();
    if (cErr) throw new Error(cErr.message);
    // Deterministic state machine: throws on an illegal transition.
    const next: ConditionStatus = transitionCondition(
      current.status as ConditionStatus,
      data.action as ConditionAction,
    );
    const satisfied = next === "satisfied";
    const { data: row, error } = await context.supabase
      .from("ic_conditions")
      .update({
        status: next,
        satisfied_by: satisfied ? context.userId : null,
        satisfied_at: satisfied ? new Date().toISOString() : null,
      })
      .eq("id", data.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listConditions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("ic_conditions")
      .select("*")
      .eq("project_id", data.project_id)
      .order("created_at", { ascending: true });
    if (isMissingRelation(error)) return { conditions: [], cleared: true, openCount: 0 };
    if (error) throw new Error(error.message);
    const conditions = rows ?? [];
    return {
      conditions,
      cleared: conditionsCleared(conditions.map((c) => ({ status: c.status as ConditionStatus }))),
      openCount: openConditionCount(
        conditions.map((c) => ({ status: c.status as ConditionStatus })),
      ),
    };
  });

// ===================== 3C. Integrations connector =====================

const MappingSchema = z.record(z.string(), z.string());

export const exportDealsCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ connection_id: z.string().uuid(), mapping: MappingSchema }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const connector = getConnector("csv");
    if (!connector) throw new Error("CSV connector is not available.");
    const { data: connection, error: connErr } = await context.supabase
      .from("integration_connections")
      .select("*")
      .eq("id", data.connection_id)
      .single();
    if (connErr) throw new Error(connErr.message);

    const { data: projects, error: pErr } = await context.supabase
      .from("projects")
      .select("id,name,location,type,source,probability,target_close_date");
    if (pErr) throw new Error(pErr.message);

    const records: DealRecord[] = (projects ?? []).map((p) => ({
      external_id: p.id,
      name: p.name,
      location: p.location ?? null,
      type: p.type ?? null,
      source: p.source ?? null,
      probability: p.probability == null ? null : Number(p.probability),
      target_close_date: p.target_close_date ?? null,
    }));
    const csv = connector.formatOutbound(records, data.mapping as FieldMapping);

    await context.supabase.from("integration_sync_runs").insert({
      connection_id: data.connection_id,
      owner_id: context.userId,
      workspace_id: connection.workspace_id ?? null,
      direction: "outbound",
      status: "succeeded",
      records_read: records.length,
      records_written: records.length,
      records_failed: 0,
      completed_at: new Date().toISOString(),
    });
    return { csv, recordCount: records.length };
  });

export type ImportDealsOutcome = { created: number; updated: number; failed: number };

// Persist parsed deal records, idempotently, against external_record_links.
//
// The previous implementation looped per record and issued a SELECT + 1-2 writes
// each: a 1,000-row import meant ~3,000 sequential round-trips (a textbook N+1).
// This batches the work:
//   * ONE IN query loads every existing link (was N selects).
//   * New deals insert as ONE projects insert + ONE links insert; on a batch
//     error it falls back to per-row inserts so a single bad row (e.g. an
//     unparseable target_close_date) cannot poison the whole import.
//   * Existing deals carry distinct patches, so they stay N updates, but run
//     concurrently rather than in a sequential await chain, and their link
//     last_synced_at touch collapses into ONE batched update.
// Per-row failure isolation (the old try/catch-per-record contract) is preserved.
export async function importDealRecords(
  supabase: SupabaseClient<Database>,
  opts: {
    connectionId: string;
    ownerId: string;
    workspaceId: string | null;
    records: DealRecord[];
  },
): Promise<ImportDealsOutcome> {
  const { records } = opts;
  if (!records.length) return { created: 0, updated: 0, failed: 0 };

  // Only safe, defaulted columns are written; type/status keep their DB defaults
  // so an external value can never violate the enum.
  // Updates omit an absent probability (undefined) so they never wipe an existing
  // value; inserts use a stable key set (null for absent) because PostgREST keys
  // a bulk insert off the column set and it must be uniform across rows.
  type ProjectInsert = Database["public"]["Tables"]["projects"]["Insert"];
  type ProjectUpdate = Database["public"]["Tables"]["projects"]["Update"];
  const updatePatch = (rec: DealRecord): ProjectUpdate => ({
    name: rec.name,
    location: rec.location,
    source: rec.source,
    probability: rec.probability ?? undefined,
    target_close_date: rec.target_close_date,
  });
  // probability is written as null when absent (a uniform key set keeps the
  // PostgREST bulk insert valid); the generated Insert type narrows it to number,
  // so the row is asserted against the table's Insert shape.
  const insertRow = (rec: DealRecord): ProjectInsert =>
    ({
      owner_id: opts.ownerId,
      workspace_id: opts.workspaceId,
      name: rec.name,
      location: rec.location,
      source: rec.source,
      probability: rec.probability ?? null,
      target_close_date: rec.target_close_date,
    }) as ProjectInsert;
  const linkRow = (rec: DealRecord, projectId: string) => ({
    connection_id: opts.connectionId,
    owner_id: opts.ownerId,
    project_id: projectId,
    external_id: rec.external_id,
    direction: "inbound",
  });

  // 1) One query for every existing link instead of one SELECT per record.
  const externalIds = [...new Set(records.map((r) => r.external_id))];
  const { data: links, error: linkErr } = await supabase
    .from("external_record_links")
    .select("id,project_id,external_id")
    .eq("connection_id", opts.connectionId)
    .in("external_id", externalIds);
  if (linkErr) throw new Error(linkErr.message);
  const linkByExternalId = new Map<string, { id: string; project_id: string | null }>();
  for (const l of links ?? []) linkByExternalId.set(l.external_id, l);

  const toUpdate: Array<{ rec: DealRecord; linkId: string; projectId: string }> = [];
  const toInsert: DealRecord[] = [];
  for (const rec of records) {
    const link = linkByExternalId.get(rec.external_id);
    if (link?.project_id) toUpdate.push({ rec, linkId: link.id, projectId: link.project_id });
    else toInsert.push(rec);
  }

  let created = 0;
  let updated = 0;
  let failed = 0;

  // 2) Updates: distinct patches, so N statements, but concurrent (not awaited
  //    one at a time). The link touch is one batched update over the synced ids.
  const updateResults = await Promise.allSettled(
    toUpdate.map(({ rec, linkId, projectId }) =>
      supabase
        .from("projects")
        .update(updatePatch(rec))
        .eq("id", projectId)
        .then((res) => {
          if (res?.error) throw new Error(res.error.message);
          return linkId;
        }),
    ),
  );
  const syncedLinkIds: string[] = [];
  for (const r of updateResults) {
    if (r.status === "fulfilled") {
      updated++;
      syncedLinkIds.push(r.value);
    } else failed++;
  }
  if (syncedLinkIds.length) {
    await supabase
      .from("external_record_links")
      .update({ last_synced_at: new Date().toISOString() })
      .in("id", syncedLinkIds);
  }

  // 3) Inserts: one batched projects insert (RETURNING id, in VALUES order) plus
  //    one batched links insert. Fall back to per-row on any batch error.
  if (toInsert.length) {
    const insertOne = async (rec: DealRecord): Promise<boolean> => {
      const { data: project, error } = await supabase
        .from("projects")
        .insert(insertRow(rec))
        .select("id")
        .single();
      if (error || !project) return false;
      const { error: liErr } = await supabase
        .from("external_record_links")
        .insert(linkRow(rec, project.id));
      return !liErr;
    };

    const { data: inserted, error: insErr } = await supabase
      .from("projects")
      .insert(toInsert.map(insertRow))
      .select("id");

    if (insErr || !Array.isArray(inserted) || inserted.length !== toInsert.length) {
      // Batch insert failed or returned an unexpected shape; isolate bad rows.
      const settled = await Promise.allSettled(toInsert.map(insertOne));
      for (const r of settled) {
        if (r.status === "fulfilled" && r.value) created++;
        else failed++;
      }
    } else {
      const { error: linksErr } = await supabase
        .from("external_record_links")
        .insert(toInsert.map((rec, i) => linkRow(rec, inserted[i].id)));
      if (linksErr) {
        // Projects landed but the link batch did not: retry links per-row so a
        // single duplicate/constraint hit cannot strand the whole batch.
        const settled = await Promise.allSettled(
          toInsert.map((rec, i) =>
            supabase
              .from("external_record_links")
              .insert(linkRow(rec, inserted[i].id))
              .then((res) => {
                if (res?.error) throw new Error(res.error.message);
              }),
          ),
        );
        for (const r of settled) {
          if (r.status === "fulfilled") created++;
          else failed++;
        }
      } else {
        created += toInsert.length;
      }
    }
  }

  return { created, updated, failed };
}

export const importDealsCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        connection_id: z.string().uuid(),
        csv: z.string().min(1).max(2_000_000),
        mapping: MappingSchema,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const connector = getConnector("csv");
    if (!connector) throw new Error("CSV connector is not available.");
    const { data: connection, error: connErr } = await context.supabase
      .from("integration_connections")
      .select("*")
      .eq("id", data.connection_id)
      .single();
    if (connErr) throw new Error(connErr.message);
    const workspaceId = connection.workspace_id ?? null;

    const { records, errors } = connector.parseInbound(data.csv, data.mapping as FieldMapping);
    const {
      created,
      updated,
      failed: writeFailures,
    } = await importDealRecords(context.supabase, {
      connectionId: data.connection_id,
      ownerId: context.userId,
      workspaceId,
      records,
    });
    const failed = errors.length + writeFailures;

    const status = failed === 0 ? "succeeded" : created + updated > 0 ? "partial" : "failed";
    await context.supabase.from("integration_sync_runs").insert({
      connection_id: data.connection_id,
      owner_id: context.userId,
      workspace_id: workspaceId,
      direction: "inbound",
      status,
      records_read: records.length + errors.length,
      records_written: created + updated,
      records_failed: failed,
      error_summary: errors.slice(0, 10).join("; ") || null,
      completed_at: new Date().toISOString(),
    });
    return { created, updated, failed, parseErrors: errors };
  });

export const listSyncRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { connection_id: string }) =>
    z.object({ connection_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("integration_sync_runs")
      .select("*")
      .eq("connection_id", data.connection_id)
      .order("started_at", { ascending: false })
      .limit(20);
    if (isMissingRelation(error)) return [];
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
