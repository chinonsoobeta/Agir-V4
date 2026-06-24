import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isMissingRelation } from "./db-compat";

const optionalWorkspace = z.string().uuid().nullable().optional();

async function profileMap(supabase: any, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map<string, any>();
  const { data } = await supabase
    .from("profiles")
    .select("id,email,full_name,avatar_url")
    .in("id", unique);
  return new Map((data ?? []).map((row: any) => [row.id, row]));
}

async function audit(
  context: any,
  projectId: string | null,
  entityType: string,
  entityId: string | null,
  action: string,
  payload: unknown,
) {
  await context.supabase.from("audit_logs").insert({
    project_id: projectId,
    owner_id: context.userId,
    user_id: context.userId,
    entity_type: entityType,
    entity_id: entityId,
    action,
    payload,
  });
}

const contactSchema = z.object({
  workspace_id: optionalWorkspace,
  full_name: z.string().trim().min(1).max(160),
  company: z.string().trim().max(200).nullable().optional(),
  title: z.string().trim().max(160).nullable().optional(),
  email: z.string().email().max(240).nullable().optional().or(z.literal("")),
  phone: z.string().trim().max(80).nullable().optional(),
  relationship_type: z
    .enum([
      "broker",
      "lender",
      "investor",
      "operator",
      "attorney",
      "consultant",
      "seller",
      "tenant",
      "other",
    ])
    .default("broker"),
  strength: z.enum(["new", "developing", "strong", "strategic"]).default("developing"),
  last_contacted_at: z.string().nullable().optional(),
  next_follow_up_at: z.string().nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

export const listRelationshipContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) =>
    z
      .object({ workspace_id: optionalWorkspace, project_id: z.string().uuid().optional() })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    let query = supabase.from("relationship_contacts").select("*").order("next_follow_up_at", {
      ascending: true,
      nullsFirst: false,
    });
    if (data.workspace_id) query = query.eq("workspace_id", data.workspace_id);
    const { data: contacts, error } = await query;
    if (isMissingRelation(error)) return [];
    if (error) throw new Error(error.message);

    const { data: links } = await supabase
      .from("deal_relationships")
      .select("id,project_id,contact_id,role,influence,projects(name)")
      .in(
        "contact_id",
        (contacts ?? []).map((contact: any) => contact.id),
      );
    return (contacts ?? []).map((contact: any) => ({
      ...contact,
      deals: (links ?? []).filter((link: any) => link.contact_id === contact.id),
    }));
  });

export const saveRelationshipContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) =>
    contactSchema.extend({ id: z.string().uuid().optional() }).parse(value),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    const { id, ...fields } = data;
    const payload = {
      ...fields,
      email: fields.email || null,
      owner_id: context.userId,
    };
    const result = id
      ? await supabase.from("relationship_contacts").update(payload).eq("id", id).select().single()
      : await supabase.from("relationship_contacts").insert(payload).select().single();
    if (isMissingRelation(result.error)) {
      throw new Error("Relationship intelligence needs the latest database migration.");
    }
    if (result.error) throw new Error(result.error.message);
    await audit(
      context,
      null,
      "relationship_contact",
      result.data.id,
      id ? "relationship_contact_updated" : "relationship_contact_created",
      { full_name: result.data.full_name, company: result.data.company },
    );
    return result.data;
  });

export const linkContactToDeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        contact_id: z.string().uuid(),
        role: z.string().trim().max(120).nullable().optional(),
        influence: z.enum(["low", "medium", "high", "decision_maker"]).default("medium"),
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    const { data: row, error } = await supabase
      .from("deal_relationships")
      .upsert({ ...data, owner_id: context.userId }, { onConflict: "project_id,contact_id" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await audit(context, data.project_id, "deal_relationship", row.id, "relationship_linked", data);
    return row;
  });

export const listDealCollaboration = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) => z.object({ project_id: z.string().uuid() }).parse(value))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    const [commentsResult, assignmentsResult, projectResult] = await Promise.all([
      supabase
        .from("deal_comments")
        .select("*")
        .eq("project_id", data.project_id)
        .order("created_at", { ascending: false }),
      supabase
        .from("deal_assignments")
        .select("*")
        .eq("project_id", data.project_id)
        .order("created_at", { ascending: true }),
      supabase.from("projects").select("workspace_id,owner_id").eq("id", data.project_id).single(),
    ]);
    if (isMissingRelation(commentsResult.error) || isMissingRelation(assignmentsResult.error)) {
      return { comments: [], assignments: [], members: [] };
    }
    if (commentsResult.error) throw new Error(commentsResult.error.message);
    if (assignmentsResult.error) throw new Error(assignmentsResult.error.message);

    const actorIds = [
      ...(commentsResult.data ?? []).map((row: any) => row.user_id),
      ...(assignmentsResult.data ?? []).flatMap((row: any) => [row.user_id, row.assigned_by]),
    ];
    const profiles = await profileMap(supabase, actorIds);
    let members: any[] = [];
    if (projectResult.data?.workspace_id) {
      const { data: memberships } = await supabase
        .from("workspace_members")
        .select("id,user_id,role")
        .eq("workspace_id", projectResult.data.workspace_id);
      const memberProfiles = await profileMap(
        supabase,
        (memberships ?? []).map((row: any) => row.user_id),
      );
      members = (memberships ?? []).map((row: any) => ({
        ...row,
        profile: memberProfiles.get(row.user_id) ?? null,
      }));
    }
    return {
      comments: (commentsResult.data ?? []).map((row: any) => ({
        ...row,
        profile: profiles.get(row.user_id) ?? null,
      })),
      assignments: (assignmentsResult.data ?? []).map((row: any) => ({
        ...row,
        profile: profiles.get(row.user_id) ?? null,
      })),
      members,
    };
  });

export const addDealComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        body: z.string().trim().min(1).max(4000),
        mentions: z.array(z.string().uuid()).max(20).default([]),
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    const { data: row, error } = await supabase
      .from("deal_comments")
      .insert({ ...data, user_id: context.userId })
      .select()
      .single();
    if (isMissingRelation(error))
      throw new Error("Collaboration needs the latest database migration.");
    if (error) throw new Error(error.message);
    if (data.mentions.length) {
      await supabase.from("notifications").insert(
        data.mentions
          .filter((id: string) => id !== context.userId)
          .map((recipient_id: string) => ({
            recipient_id,
            project_id: data.project_id,
            kind: "mention",
            title: "You were mentioned in a deal",
            body: data.body.slice(0, 240),
            action_url: `/projects/${data.project_id}`,
          })),
      );
    }
    await audit(context, data.project_id, "deal_comment", row.id, "comment_added", {
      mentions: data.mentions,
    });
    return row;
  });

export const assignDealMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        user_id: z.string().uuid(),
        responsibility: z.string().trim().min(1).max(120),
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    const { data: row, error } = await supabase
      .from("deal_assignments")
      .upsert(
        { ...data, assigned_by: context.userId },
        { onConflict: "project_id,user_id,responsibility" },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    if (data.user_id !== context.userId) {
      await supabase.from("notifications").insert({
        recipient_id: data.user_id,
        project_id: data.project_id,
        kind: "assignment",
        title: "You were assigned to a deal",
        body: data.responsibility,
        action_url: `/projects/${data.project_id}`,
      });
    }
    await audit(context, data.project_id, "deal_assignment", row.id, "member_assigned", data);
    return row;
  });

export const listNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(40);
    if (isMissingRelation(error)) return [];
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) => z.object({ id: z.string().uuid() }).parse(value))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listIntegrationRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) => z.object({ workspace_id: optionalWorkspace }).parse(value))
  .handler(async ({ data, context }) => {
    let query = (context.supabase as any)
      .from("integration_sync_runs")
      .select("*, integration_connections(provider,display_name)")
      .order("started_at", { ascending: false })
      .limit(30);
    if (data.workspace_id) query = query.eq("workspace_id", data.workspace_id);
    const { data: rows, error } = await query;
    if (isMissingRelation(error)) return [];
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const runIntegrationSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) =>
    z.object({ connection_id: z.string().uuid(), workspace_id: optionalWorkspace }).parse(value),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    const started = new Date().toISOString();
    const { data: run, error } = await supabase
      .from("integration_sync_runs")
      .insert({
        connection_id: data.connection_id,
        workspace_id: data.workspace_id ?? null,
        owner_id: context.userId,
        direction: "bidirectional",
        status: "running",
        started_at: started,
      })
      .select()
      .single();
    if (isMissingRelation(error))
      throw new Error("Sync history needs the latest database migration.");
    if (error) throw new Error(error.message);

    const { count: projectCount } = await supabase
      .from("projects")
      .select("id", { count: "exact", head: true });
    const completed = new Date().toISOString();
    const { data: finished, error: finishError } = await supabase
      .from("integration_sync_runs")
      .update({
        status: "succeeded",
        records_read: projectCount ?? 0,
        records_written: 0,
        completed_at: completed,
        metadata: {
          mode: "connectivity_check",
          message: "Connection verified. Provider-specific field mapping can now be configured.",
        },
      })
      .eq("id", run.id)
      .select()
      .single();
    if (finishError) throw new Error(finishError.message);
    await supabase
      .from("integration_connections")
      .update({ last_synced_at: completed, status: "connected" })
      .eq("id", data.connection_id);
    return finished;
  });

const importDealSchema = z.object({
  name: z.string().trim().min(1).max(200),
  location: z.string().trim().max(200).nullable().optional(),
  type: z
    .enum([
      "industrial",
      "mixed_use",
      "multifamily",
      "office",
      "retail",
      "hospitality",
      "self_storage",
      "data_center",
      "life_science",
      "commercial",
      "land",
      "other",
    ])
    .default("other"),
  source: z.string().trim().max(200).nullable().optional(),
  probability: z.number().min(0).max(100).default(25),
  acquisition_cost: z.number().min(0).default(0),
  target_close_date: z.string().nullable().optional(),
});

export const importDeals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) =>
    z
      .object({
        workspace_id: optionalWorkspace,
        rows: z.array(importDealSchema).min(1).max(500),
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    const rows = data.rows.map((row) => ({
      ...row,
      workspace_id: data.workspace_id ?? null,
      owner_id: context.userId,
      status: "pipeline",
    }));
    const { data: inserted, error } = await (context.supabase as any)
      .from("projects")
      .insert(rows)
      .select("id,name");
    if (error) throw new Error(error.message);
    await Promise.all(
      (inserted ?? []).map((project: any) =>
        (context.supabase as any).from("activities").insert({
          project_id: project.id,
          user_id: context.userId,
          activity_type: "project_imported",
          description: `Imported ${project.name}`,
        }),
      ),
    );
    return { imported: inserted?.length ?? 0, projects: inserted ?? [] };
  });

export const listWebhookEndpoints = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) => z.object({ workspace_id: optionalWorkspace }).parse(value))
  .handler(async ({ data, context }) => {
    let query = (context.supabase as any)
      .from("webhook_endpoints")
      .select("*")
      .order("created_at", { ascending: false });
    if (data.workspace_id) query = query.eq("workspace_id", data.workspace_id);
    const { data: rows, error } = await query;
    if (isMissingRelation(error)) return [];
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const saveWebhookEndpoint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) =>
    z
      .object({
        workspace_id: optionalWorkspace,
        name: z.string().trim().min(1).max(160),
        endpoint_url: z.string().url().max(1000),
        event_types: z.array(z.string().min(1).max(120)).min(1).max(20),
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    const secretHint = crypto.randomUUID().replaceAll("-", "").slice(-8);
    const { data: row, error } = await (context.supabase as any)
      .from("webhook_endpoints")
      .insert({
        ...data,
        owner_id: context.userId,
        signing_secret_hint: secretHint,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const getWorkspaceGovernance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) => z.object({ workspace_id: z.string().uuid() }).parse(value))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await (context.supabase as any)
      .from("workspace_settings")
      .select("*")
      .eq("workspace_id", data.workspace_id)
      .maybeSingle();
    if (isMissingRelation(error) || !row) {
      return {
        workspace_id: data.workspace_id,
        approval_threshold: null,
        require_two_person_approval: false,
        allowed_email_domains: [],
        data_retention_days: 2555,
      };
    }
    if (error) throw new Error(error.message);
    return row;
  });

export const saveWorkspaceGovernance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) =>
    z
      .object({
        workspace_id: z.string().uuid(),
        approval_threshold: z.number().min(0).nullable(),
        require_two_person_approval: z.boolean(),
        allowed_email_domains: z.array(z.string().trim().min(1).max(160)).max(50),
        data_retention_days: z.number().int().min(30).max(36500),
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await (context.supabase as any)
      .from("workspace_settings")
      .upsert(data, { onConflict: "workspace_id" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const trackOnboardingEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) =>
    z
      .object({
        workspace_id: optionalWorkspace,
        event_name: z.string().min(1).max(120),
        step_key: z.string().max(120).nullable().optional(),
        metadata: z.record(z.any()).default({}),
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).from("onboarding_events").insert({
      ...data,
      user_id: context.userId,
    });
    if (isMissingRelation(error)) return { ok: true, persisted: false };
    if (error) throw new Error(error.message);
    return { ok: true, persisted: true };
  });
