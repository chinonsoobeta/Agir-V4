import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";
import { isMissingColumn } from "./db-compat";

type ProjectInsert = Database["public"]["Tables"]["projects"]["Insert"];
type ProjectUpdate = Database["public"]["Tables"]["projects"]["Update"];

// Columns added by the operating-platform migration. If that migration has not
// been applied to the target database yet, writes including these must degrade
// gracefully (strip + retry) rather than fail the whole deal create/update.
const OPERATING_COLUMNS = [
  "source",
  "probability",
  "target_close_date",
  "lead_owner",
  "workspace_id",
] as const;

type OperatingColumn = (typeof OPERATING_COLUMNS)[number];

function stripOperatingColumns<T extends Record<string, unknown>>(
  row: T,
): Omit<T, OperatingColumn> {
  const copy: Record<string, unknown> = { ...row };
  for (const c of OPERATING_COLUMNS) delete copy[c];
  return copy as Omit<T, OperatingColumn>;
}

const ProjectSchema = z.object({
  name: z.string().min(1).max(200),
  location: z.string().max(200).optional().nullable(),
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
    .default("industrial"),
  status: z
    .enum(["pipeline", "underwriting", "approved", "active", "completed", "cancelled"])
    .default("pipeline"),
  acquisition_cost: z.number().min(0).default(0),
  construction_cost: z.number().min(0).default(0),
  revenue_forecast: z.number().min(0).default(0),
  debt_amount: z.number().min(0).default(0),
  equity_amount: z.number().min(0).default(0),
  interest_rate: z.number().min(0).max(100).default(0),
  start_date: z.string().optional().nullable(),
  completion_date: z.string().optional().nullable(),
  target_close_date: z.string().optional().nullable(),
  source: z.string().max(200).optional().nullable(),
  probability: z.number().min(0).max(100).default(25),
  lead_owner: z.string().max(200).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  workspace_id: z.string().uuid().optional().nullable(),
  property_address: z.string().max(500).optional().nullable(),
  address_line_2: z.string().max(200).optional().nullable(),
  building_name: z.string().max(250).optional().nullable(),
  address_provider: z.enum(["google_places", "openstreetmap", "manual"]).optional().nullable(),
  address_place_id: z.string().max(500).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  municipality: z.string().max(200).optional().nullable(),
  address_region: z.string().max(200).optional().nullable(),
  postal_code: z.string().max(30).optional().nullable(),
  permit_project_type: z
    .enum([
      "new_construction",
      "renovation",
      "tenant_improvement",
      "demolition",
      "addition",
      "change_of_use",
      "other",
    ])
    .optional()
    .nullable(),
  property_type: z
    .enum(["residential", "commercial", "industrial", "mixed_use"])
    .optional()
    .nullable(),
  project_description: z.string().max(5000).optional().nullable(),
  work_categories: z.array(z.string()).optional().default([]),
  zoning_designation: z.string().max(200).optional().nullable(),
  zoning_source: z.string().max(1000).optional().nullable(),
});

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getProject = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: proj, error } = await context.supabase
      .from("projects")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    return proj;
  });

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => ProjectSchema.parse(d))
  .handler(async ({ data, context }) => {
    const payload: ProjectInsert = { ...data, owner_id: context.userId };
    let { data: proj, error } = await context.supabase
      .from("projects")
      .insert(payload)
      .select()
      .single();
    // Older schema without the operating-platform columns: retry with base fields.
    if (isMissingColumn(error)) {
      ({ data: proj, error } = await context.supabase
        .from("projects")
        .insert(stripOperatingColumns(payload))
        .select()
        .single());
    }
    if (error) throw new Error(error.message);
    if (!proj) throw new Error("Project insert returned no row");
    await context.supabase.from("activities").insert({
      project_id: proj.id,
      user_id: context.userId,
      activity_type: "project_created",
      description: `Created project ${proj.name}`,
    });
    return proj;
  });

export const updateProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid() }).merge(ProjectSchema.partial()).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const projectPatch: ProjectUpdate = patch;
    let { data: proj, error } = await context.supabase
      .from("projects")
      .update(projectPatch)
      .eq("id", id)
      .select()
      .single();
    if (isMissingColumn(error)) {
      const base = stripOperatingColumns(projectPatch);
      // Nothing left to update once operating columns are stripped → re-read the row.
      if (Object.keys(base).length === 0) {
        ({ data: proj, error } = await context.supabase
          .from("projects")
          .select()
          .eq("id", id)
          .single());
      } else {
        ({ data: proj, error } = await context.supabase
          .from("projects")
          .update(base)
          .eq("id", id)
          .select()
          .single());
      }
    }
    if (error) throw new Error(error.message);
    return proj;
  });

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("projects").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listActivities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("activities")
      .select("*, projects(name)")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// The legacy runProjectUnderwriting (which silently filled missing inputs
// from project columns and hardcoded defaults) has been removed. Underwriting
// runs exclusively through runFullUnderwriting in underwriting.functions.ts,
// which is fail-closed over approved/default_accepted provenance rows.
