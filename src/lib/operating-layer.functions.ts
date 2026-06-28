// Operating-layer server functions (Workstream 3). Every function attaches
// requireSupabaseAuth, validates input with zod, and queries through the
// user-scoped client so RLS is the only authority on what a caller can touch.
//
// 3A execution critical path, 3B IC voting + conditions, 3C connector
// import/export. The deterministic financial engine and its verdict are never
// touched here: this layer is governance and workflow around the deal.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { computeCriticalPath, type ExecMilestone } from "./execution/critical-path";
import {
  tallyVotes,
  transitionCondition,
  conditionsCleared,
  openConditionCount,
  type IcVote,
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
    const execMilestones: ExecMilestone[] = (milestones ?? []).map((m: any) => ({
      id: m.id,
      title: m.title,
      dueDate: m.due_date ?? null,
      status: m.status,
      dependsOn: Array.isArray(m.depends_on) ? m.depends_on : [],
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
    const votes: IcVote[] = (rows ?? []).map((r: any) => ({ memberId: r.owner_id, vote: r.vote }));
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
      cleared: conditionsCleared(conditions.map((c: any) => ({ status: c.status }))),
      openCount: openConditionCount(conditions.map((c: any) => ({ status: c.status }))),
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

    const records: DealRecord[] = (projects ?? []).map((p: any) => ({
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
    let created = 0;
    let updated = 0;
    let failed = errors.length;

    for (const rec of records) {
      try {
        const { data: link } = await context.supabase
          .from("external_record_links")
          .select("id,project_id")
          .eq("connection_id", data.connection_id)
          .eq("external_id", rec.external_id)
          .maybeSingle();

        // Only safe, defaulted columns are written; type/status keep their DB
        // defaults so an external value can never violate the enum.
        const patch = {
          name: rec.name,
          location: rec.location,
          source: rec.source,
          probability: rec.probability ?? undefined,
          target_close_date: rec.target_close_date,
        };

        if (link?.project_id) {
          const { error } = await context.supabase
            .from("projects")
            .update(patch)
            .eq("id", link.project_id);
          if (error) throw new Error(error.message);
          await context.supabase
            .from("external_record_links")
            .update({ last_synced_at: new Date().toISOString() })
            .eq("id", link.id);
          updated++;
        } else {
          const { data: project, error } = await context.supabase
            .from("projects")
            .insert({ owner_id: context.userId, workspace_id: workspaceId, ...patch })
            .select("id")
            .single();
          if (error) throw new Error(error.message);
          const { error: linkErr } = await context.supabase.from("external_record_links").insert({
            connection_id: data.connection_id,
            owner_id: context.userId,
            project_id: project.id,
            external_id: rec.external_id,
            direction: "inbound",
          });
          if (linkErr) throw new Error(linkErr.message);
          created++;
        }
      } catch {
        failed++;
      }
    }

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
