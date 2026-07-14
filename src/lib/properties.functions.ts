import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json } from "@/integrations/supabase/types";
import { canonicalPermitMunicipality } from "./permit-municipalities";

export type PropertyRow = Database["public"]["Tables"]["properties"]["Row"];
export type PropertyUrlRow = Database["public"]["Tables"]["property_urls"]["Row"];
export type PropertyTaskRow = Database["public"]["Tables"]["property_tasks"]["Row"];
export type PropertyActivityRow = Database["public"]["Tables"]["property_activity_events"]["Row"];
export type PropertyMatchScope = "current" | "historical" | "current_and_historical";
export type PropertySearchRow = PropertyRow & { match_scope?: PropertyMatchScope };
export type PropertyContactRow = Database["public"]["Tables"]["property_contacts"]["Row"] & {
  contact: Database["public"]["Tables"]["relationship_contacts"]["Row"];
};

export type PropertyDetail = {
  property: PropertyRow;
  projects: Database["public"]["Tables"]["projects"]["Row"][];
  permit_cases: Database["public"]["Tables"]["permit_cases"]["Row"][];
  documents: Database["public"]["Tables"]["documents"]["Row"][];
  contacts: PropertyContactRow[];
  urls: PropertyUrlRow[];
  tasks: PropertyTaskRow[];
  activities: PropertyActivityRow[];
  activity_total: number;
  activity_next_cursor: PropertyActivityCursor | null;
};

export type PropertyActivityCursor = { created_at: string; id: string };
export type PropertyActivityPage = {
  items: PropertyActivityRow[];
  total: number;
  next_cursor: PropertyActivityCursor | null;
};

const listPropertiesSchema = z.object({
  workspace_id: z.string().uuid().nullable().optional(),
  query: z
    .string()
    .trim()
    .max(300)
    .refine(
      (query) => query.split(/\s+/).filter(Boolean).length <= 20,
      "Search supports up to 20 fragments at a time.",
    )
    .optional(),
  municipality: z.string().trim().max(200).optional(),
  project_type: z.string().trim().max(100).optional(),
  min_price: z.number().nonnegative().optional(),
  max_price: z.number().nonnegative().optional(),
  include_archived: z.boolean().default(false),
  limit: z.number().int().min(1).max(200).default(50),
});

export type ListPropertiesInput = z.input<typeof listPropertiesSchema>;

const propertyShape = z.object({
  workspace_id: z.string().uuid().nullable().optional(),
  display_name: z.string().trim().max(250).nullable().optional(),
  building_name: z.string().trim().max(250).nullable().optional(),
  address_line_1: z.string().trim().min(1).max(500),
  address_line_2: z.string().trim().max(200).nullable().optional(),
  unit: z.string().trim().max(100).nullable().optional(),
  municipality: z.string().trim().max(200).nullable().optional(),
  region: z.string().trim().max(200).nullable().optional(),
  postal_code: z.string().trim().max(30).nullable().optional(),
  country_code: z.string().trim().length(2).default("CA"),
  place_provider: z.enum(["google_places", "openstreetmap", "manual", "other"]).default("manual"),
  provider_place_id: z.string().trim().max(500).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  zoning_designation: z.string().trim().max(250).nullable().optional(),
  zoning_source_url: z.string().url().max(2000).nullable().optional(),
  zoning_verified_at: z.string().datetime().nullable().optional(),
  zoning_evidence: z.unknown().optional(),
  price: z.number().nonnegative().nullable().optional(),
  currency: z.string().trim().length(3).default("CAD"),
  owner_name: z.string().trim().max(250).nullable().optional(),
  broker_name: z.string().trim().max(250).nullable().optional(),
  project_type: z.string().trim().max(100).nullable().optional(),
  notes: z.string().max(20_000).nullable().optional(),
});

const savePropertySchema = propertyShape.extend({ id: z.string().uuid().optional() });

export type SavePropertyInput = Omit<z.input<typeof savePropertySchema>, "zoning_evidence"> & {
  zoning_evidence?: Json;
};

const taskStatus = z.enum(["todo", "in_progress", "blocked", "done", "cancelled"]);
const taskPriority = z.enum(["low", "normal", "high", "urgent"]);
const savePropertyTaskSchema = z
  .object({
    id: z.string().uuid().optional(),
    property_id: z.string().uuid(),
    title: z.string().trim().min(1).max(300),
    status: taskStatus.optional(),
    priority: taskPriority.optional(),
    due_at: z.string().datetime().nullable().optional(),
    assigned_to: z.string().uuid().nullable().optional(),
    notes: z.string().max(10_000).nullable().optional(),
    is_next_action: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    if (value.is_next_action && value.status && ["done", "cancelled"].includes(value.status)) {
      context.addIssue({
        code: "custom",
        path: ["is_next_action"],
        message: "Only an open task can be the next action.",
      });
    }
  });

export type SavePropertyTaskInput = z.input<typeof savePropertyTaskSchema>;

const propertyIdSchema = z.object({ id: z.string().uuid() });
const propertyActivityPageSchema = z
  .object({
    property_id: z.string().uuid(),
    before_created_at: z.string().datetime().nullable().optional(),
    before_id: z.string().uuid().nullable().optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .superRefine((value, context) => {
    if (Boolean(value.before_created_at) !== Boolean(value.before_id)) {
      context.addIssue({
        code: "custom",
        path: [value.before_created_at ? "before_id" : "before_created_at"],
        message: "Activity pagination requires both cursor fields.",
      });
    }
  });

function nextActivityCursor(rows: PropertyActivityRow[], hasMore: boolean) {
  if (!hasMore) return null;
  const last = rows.at(-1);
  return last ? { created_at: last.created_at, id: last.id } : null;
}

/** Search the active personal or selected workspace property catalogue. */
export const listProperties = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => listPropertiesSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<PropertySearchRow[]> => {
    const result = await (context.supabase as any).rpc("search_properties", {
      p_workspace_id: data.workspace_id ?? null,
      p_query: data.query || null,
      p_municipality: data.municipality || null,
      p_project_type: data.project_type || null,
      p_min_price: data.min_price ?? null,
      p_max_price: data.max_price ?? null,
      p_include_archived: data.include_archived,
      p_limit: data.limit,
    });
    if (result.error) throw new Error(result.error.message);
    const properties = (result.data ?? []) as PropertyRow[];
    if (!data.query || !properties.length) return properties;

    const matches = await (context.supabase as any).rpc("property_search_match_scopes", {
      p_property_ids: properties.map((property) => property.id),
      p_query: data.query,
    });
    if (matches.error) throw new Error(matches.error.message);

    const scopes = new Map<string, PropertyMatchScope>();
    for (const match of matches.data ?? []) {
      scopes.set(match.property_id, match.match_scope as PropertyMatchScope);
    }
    return properties.map((property) => {
      const match_scope = scopes.get(property.id);
      return match_scope ? { ...property, match_scope } : property;
    });
  });

export const listPropertyActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => propertyActivityPageSchema.parse(input))
  .handler(async ({ data, context }): Promise<PropertyActivityPage> => {
    const result = await (context.supabase as any).rpc("list_property_activity", {
      p_property_id: data.property_id,
      p_before_created_at: data.before_created_at ?? null,
      p_before_id: data.before_id ?? null,
      p_limit: data.limit,
    });
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data ?? []) as Array<PropertyActivityRow & { total_count: number }>;
    const hasMore = rows.length > data.limit;
    const visibleRows = rows.slice(0, data.limit);
    const items = visibleRows.map(
      ({ total_count: _totalCount, ...row }) => row as PropertyActivityRow,
    );
    return {
      items,
      total: Number(rows[0]?.total_count ?? 0),
      next_cursor: nextActivityCursor(items, hasMore),
    };
  });

/** Load one canonical property and all of its permission-filtered context. */
export const getProperty = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => propertyIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<PropertyDetail> => {
    const db = context.supabase as any;
    const propertyResult = await db.from("properties").select("*").eq("id", data.id).single();
    if (propertyResult.error) throw new Error(propertyResult.error.message);

    const [projects, permitCases, documents, contacts, urls, tasks, activityPage] =
      await Promise.all([
        db.from("projects").select("*").eq("property_id", data.id).order("updated_at", {
          ascending: false,
        }),
        db.from("permit_cases").select("*").eq("property_id", data.id).order("updated_at", {
          ascending: false,
        }),
        db.from("documents").select("*").eq("property_id", data.id).order("upload_date", {
          ascending: false,
        }),
        db
          .from("property_contacts")
          .select("*, contact:relationship_contacts(*)")
          .eq("property_id", data.id)
          .order("created_at", { ascending: false }),
        db
          .from("property_urls")
          .select("*")
          .eq("property_id", data.id)
          .order("created_at", { ascending: false }),
        db
          .from("property_tasks")
          .select("*")
          .eq("property_id", data.id)
          .order("is_next_action", { ascending: false })
          .order("due_at", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: false }),
        db.rpc("list_property_activity", {
          p_property_id: data.id,
          p_before_created_at: null,
          p_before_id: null,
          p_limit: 50,
        }),
      ]);

    for (const result of [projects, permitCases, documents, contacts, urls, tasks, activityPage]) {
      if (result.error) throw new Error(result.error.message);
    }

    const activityRows = (activityPage.data ?? []) as Array<
      PropertyActivityRow & { total_count: number }
    >;
    const visibleActivityRows = activityRows.slice(0, 50);
    const activities = visibleActivityRows.map(
      ({ total_count: _totalCount, ...row }) => row as PropertyActivityRow,
    );

    return {
      property: propertyResult.data as PropertyRow,
      projects: (projects.data ?? []) as PropertyDetail["projects"],
      permit_cases: (permitCases.data ?? []) as PropertyDetail["permit_cases"],
      documents: (documents.data ?? []) as PropertyDetail["documents"],
      contacts: (contacts.data ?? []) as PropertyContactRow[],
      urls: (urls.data ?? []) as PropertyUrlRow[],
      tasks: (tasks.data ?? []) as PropertyTaskRow[],
      activities,
      activity_total: Number(activityRows[0]?.total_count ?? 0),
      activity_next_cursor: nextActivityCursor(activities, activityRows.length > 50),
    };
  });

/** Create a canonical property or edit its research fields without moving tenants. */
export const saveProperty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => savePropertySchema.parse(input))
  .handler(async ({ data, context }): Promise<PropertyRow> => {
    const db = context.supabase as any;
    const { id, ...values } = data;
    const payload = {
      ...values,
      country_code: values.country_code.toUpperCase(),
      currency: values.currency.toUpperCase(),
      ...(values.municipality !== undefined
        ? { municipality: canonicalPermitMunicipality(values.municipality) }
        : {}),
      ...(values.zoning_evidence !== undefined
        ? { zoning_evidence: values.zoning_evidence as Json }
        : {}),
    };

    const result = id
      ? await db.from("properties").update(payload).eq("id", id).select().single()
      : await db
          .from("properties")
          .insert({ ...payload, owner_id: context.userId })
          .select()
          .single();
    if (result.error) throw new Error(result.error.message);
    return result.data as PropertyRow;
  });

/** Archive without deleting the property or its institutional history. */
export const archiveProperty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ id: z.string().uuid(), reason: z.string().trim().min(1).max(1000) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<PropertyRow> => {
    const result = await (context.supabase as any)
      .from("properties")
      .update({
        status: "archived",
        archived_at: new Date().toISOString(),
        archived_by: context.userId,
        archive_reason: data.reason,
      })
      .eq("id", data.id)
      .select()
      .single();
    if (result.error) throw new Error(result.error.message);
    return result.data as PropertyRow;
  });

export const savePropertyTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => savePropertyTaskSchema.parse(input))
  .handler(async ({ data, context }): Promise<PropertyTaskRow> => {
    const db = context.supabase as any;
    const { id, is_next_action, ...values } = data;
    const result = id
      ? await db.from("property_tasks").update(values).eq("id", id).select().single()
      : await db
          .from("property_tasks")
          .insert({
            ...values,
            status: values.status ?? "todo",
            priority: values.priority ?? "normal",
            is_next_action: false,
            created_by: context.userId,
          })
          .select()
          .single();
    if (result.error) throw new Error(result.error.message);
    if (is_next_action === undefined || (!id && !is_next_action)) {
      return result.data as PropertyTaskRow;
    }
    const selection = await db.rpc("set_property_next_action", {
      p_task_id: result.data.id,
      p_enabled: is_next_action,
    });
    if (selection.error) throw new Error(selection.error.message);
    return selection.data as PropertyTaskRow;
  });

/** Move a complete personal Property graph into an authorized workspace. */
export const transferPersonalProperty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        property_id: z.string().uuid(),
        workspace_id: z.string().uuid(),
        reason: z.string().trim().min(1).max(1000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ property_id: string }> => {
    const result = await (context.supabase as any).rpc("transfer_personal_property_to_workspace", {
      p_property_id: data.property_id,
      p_workspace_id: data.workspace_id,
      p_reason: data.reason,
    });
    if (result.error) throw new Error(result.error.message);
    return { property_id: result.data as string };
  });

export const listPropertyTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ property_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PropertyTaskRow[]> => {
    const result = await (context.supabase as any)
      .from("property_tasks")
      .select("*")
      .eq("property_id", data.property_id)
      .order("is_next_action", { ascending: false })
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (result.error) throw new Error(result.error.message);
    return (result.data ?? []) as PropertyTaskRow[];
  });

export const addPropertyLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        property_id: z.string().uuid(),
        url: z.string().url().max(2000),
        label: z.string().trim().max(200).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<PropertyUrlRow> => {
    const result = await (context.supabase as any)
      .from("property_urls")
      .insert({ ...data, created_by: context.userId })
      .select()
      .single();
    if (result.error) throw new Error(result.error.message);
    return result.data as PropertyUrlRow;
  });

export const linkPropertyContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        property_id: z.string().uuid(),
        contact_id: z.string().uuid(),
        role: z
          .enum(["owner", "broker", "seller", "tenant", "lender", "consultant", "other"])
          .default("other"),
        notes: z.string().max(10_000).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const result = await (context.supabase as any)
      .from("property_contacts")
      .insert({ ...data, created_by: context.userId })
      .select("*, contact:relationship_contacts(*)")
      .single();
    if (result.error) throw new Error(result.error.message);
    return result.data as PropertyContactRow;
  });

export const linkPropertyProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ property_id: z.string().uuid(), project_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const result = await (context.supabase as any)
      .from("projects")
      .update({ property_id: data.property_id })
      .eq("id", data.project_id)
      .is("property_id", null)
      .select("id,property_id")
      .single();
    if (result.error)
      throw new Error(
        result.error.code === "PGRST116"
          ? "This deal is unavailable or is already linked to a property."
          : result.error.message,
      );
    return result.data as { id: string; property_id: string };
  });

export const linkPropertyPermitCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ property_id: z.string().uuid(), permit_case_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const result = await (context.supabase as any)
      .from("permit_cases")
      .update({ property_id: data.property_id })
      .eq("id", data.permit_case_id)
      .is("property_id", null)
      .select("id,property_id")
      .single();
    if (result.error)
      throw new Error(
        result.error.code === "PGRST116"
          ? "This Permit case is unavailable or is already linked to a property."
          : result.error.message,
      );
    return result.data as { id: string; property_id: string };
  });

export const linkPropertyDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ property_id: z.string().uuid(), document_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const result = await (context.supabase as any)
      .from("documents")
      .update({ property_id: data.property_id })
      .eq("id", data.document_id)
      .is("property_id", null)
      .select("id,property_id")
      .single();
    if (result.error)
      throw new Error(
        result.error.code === "PGRST116"
          ? "This document is unavailable or is already linked to a property."
          : result.error.message,
      );
    return result.data as { id: string; property_id: string };
  });
