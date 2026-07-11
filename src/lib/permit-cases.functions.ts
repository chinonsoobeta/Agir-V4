import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const PROPERTY_TYPES = [
  "residential",
  "commercial",
  "industrial",
  "mixed_use",
  "institutional",
  "other",
] as const;
export const WORK_TYPES = [
  "new_construction",
  "renovation",
  "tenant_improvement",
  "demolition",
  "addition",
  "change_of_use",
  "accessory_secondary_dwelling",
  "site_servicing",
  "industrial_alteration",
  "other",
] as const;
export const PROJECT_CONTEXTS = [
  "single_family_residential",
  "multifamily_residential",
  "commercial",
  "industrial",
  "mixed_use",
  "large_development",
  "other",
] as const;

const caseShape = z.object({
  workspace_id: z.string().uuid().nullable().optional(),
  project_id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(250),
  property_address: z.string().max(500).nullable().optional(),
  municipality: z.string().max(200).nullable().optional(),
  municipality_confirmed: z.boolean().default(false),
  province: z.string().min(1).max(100).default("British Columbia"),
  property_type: z.enum(PROPERTY_TYPES).nullable().optional(),
  work_type: z.enum(WORK_TYPES).nullable().optional(),
  project_context: z.enum(PROJECT_CONTEXTS).nullable().optional(),
  work_categories: z.array(z.string().max(100)).max(30).default([]),
  description: z.string().max(5000).nullable().optional(),
  existing_use: z.string().max(1000).nullable().optional(),
  proposed_use: z.string().max(1000).nullable().optional(),
  known_conditions: z.string().max(5000).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  zoning_designation: z.string().max(200).nullable().optional(),
  zoning_source: z.string().max(1000).nullable().optional(),
  zoning_verified_at: z.string().datetime().nullable().optional(),
  zoning_source_kind: z
    .enum(["verified_source", "analyst", "unknown", "not_applicable"])
    .default("unknown"),
});
export const permitCaseInputSchema = caseShape.superRefine((v, ctx) => {
  if (v.municipality_confirmed && !v.municipality)
    ctx.addIssue({
      code: "custom",
      path: ["municipality"],
      message: "A confirmed municipality must be named.",
    });
  if (
    v.zoning_designation &&
    (!v.zoning_source ||
      !v.zoning_verified_at ||
      !["verified_source", "analyst"].includes(v.zoning_source_kind))
  )
    ctx.addIssue({
      code: "custom",
      path: ["zoning_designation"],
      message: "Zoning requires a source, verification date, and supported provenance.",
    });
});

export type PermitCaseInput = z.input<typeof permitCaseInputSchema>;

export const listPermitCases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        workspace_id: z.string().uuid().nullable().optional(),
        search: z.string().max(200).optional(),
        municipality: z.string().max(200).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = (context.supabase as any)
      .from("permit_cases")
      .select(
        "*, projects(id,name), project_permits(id,applicability_status,workflow_status,permit_requirements(id,status,is_required))",
      )
      .order("updated_at", { ascending: false });
    if (data.workspace_id) q = q.eq("workspace_id", data.workspace_id);
    else if (data.workspace_id === null) q = q.is("workspace_id", null);
    if (data.municipality) q = q.eq("municipality", data.municipality);
    if (data.search)
      q = q.or(
        `name.ilike.%${data.search.replace(/[,%]/g, "")}%,property_address.ilike.%${data.search.replace(/[,%]/g, "")}%,municipality.ilike.%${data.search.replace(/[,%]/g, "")}%`,
      );
    const r = await q;
    if (r.error) throw new Error(r.error.message);
    return r.data ?? [];
  });

export const getPermitCase = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const r = await (context.supabase as any)
      .from("permit_cases")
      .select(
        "*, projects(id,name), project_permits(*, jurisdictions(name,jurisdiction_type), permit_requirements(*), permit_documents(*,documents(*)), permit_history(*)), permit_case_history(*)",
      )
      .eq("id", data.id)
      .single();
    if (r.error) throw new Error(r.error.message);
    return r.data;
  });

export const createPermitCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => permitCaseInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    if (data.project_id) {
      const p = await db
        .from("projects")
        .select("id,workspace_id")
        .eq("id", data.project_id)
        .single();
      if (p.error)
        throw new Error("You cannot attach this permit case to that underwriting project.");
      if ((p.data.workspace_id ?? null) !== (data.workspace_id ?? null))
        throw new Error("The case and project must belong to the same workspace.");
    }
    const r = await db
      .from("permit_cases")
      .insert({ ...data, owner_id: context.userId })
      .select()
      .single();
    if (r.error) throw new Error(r.error.message);
    return r.data;
  });

export const updatePermitCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        patch: caseShape.partial(),
        reason: z.string().min(1).max(1000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const r = await (context.supabase as any)
      .from("permit_cases")
      .update(data.patch)
      .eq("id", data.id)
      .select()
      .single();
    if (r.error) throw new Error(r.error.message);
    await (context.supabase as any).from("permit_case_history").insert({
      case_id: data.id,
      action: "case_update_reason",
      reason: data.reason,
      changed_by: context.userId,
    });
    return r.data;
  });

export const listAttachableProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ workspace_id: z.string().uuid().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("projects")
      .select("id,name,location,workspace_id")
      .order("name");
    query = data.workspace_id
      ? query.eq("workspace_id", data.workspace_id)
      : query.is("workspace_id", null);
    const result = await query;
    if (result.error) throw new Error(result.error.message);
    return result.data ?? [];
  });

export const setPermitCaseProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        case_id: z.string().uuid(),
        project_id: z.string().uuid().nullable(),
        expected_version: z.number().int().positive(),
        reason: z.string().min(1).max(1000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const args = {
      p_case_id: data.case_id,
      p_expected_version: data.expected_version,
      p_reason: data.reason,
      ...(data.project_id ? { p_project_id: data.project_id } : {}),
    };
    const result = await context.supabase.rpc("set_permit_case_project", args);
    if (result.error)
      throw new Error(
        result.error.message.includes("version conflict")
          ? "This case changed in another session. Refresh and try again."
          : result.error.message,
      );
    return result.data;
  });

/** Municipality catalogue candidates stay unknown and retain the exact rule version. */
export const generateCasePermitCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ case_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const c = await db.from("permit_cases").select("*").eq("id", data.case_id).single();
    if (c.error) throw new Error(c.error.message);
    if (!c.data.municipality_confirmed || !c.data.municipality)
      throw new Error("Confirm the municipality before generating permit candidates.");
    const j = await db
      .from("jurisdictions")
      .select("id,name,jurisdiction_type")
      .eq("name", c.data.municipality)
      .eq("jurisdiction_type", "municipality")
      .eq("active", true)
      .single();
    if (j.error) throw new Error("The confirmed municipality is not in the current permit pilot.");
    const rules = await db
      .from("permit_rules")
      .select("*")
      .eq("jurisdiction_id", j.data.id)
      .is("superseded_at", null)
      .order("permit_type");
    if (rules.error) throw new Error(rules.error.message);
    const existing = await db
      .from("project_permits")
      .select("permit_rule_id")
      .eq("case_id", data.case_id);
    if (existing.error) throw new Error(existing.error.message);
    const ids = new Set((existing.data ?? []).map((x: any) => x.permit_rule_id));
    const rows = (rules.data ?? [])
      .filter((x: any) => !ids.has(x.id))
      .map((x: any) => ({
        case_id: data.case_id,
        project_id: c.data.project_id,
        owner_id: context.userId,
        jurisdiction_id: j.data.id,
        permit_rule_id: x.id,
        name: x.name,
        permit_type: x.permit_type,
        description: x.description,
        applicability_status: "unknown",
        workflow_status: "not_started",
        is_required: null,
        processing_duration_text: x.published_duration_text,
        processing_duration_days: x.published_duration_days,
        duration_source: x.published_duration_text ? x.official_source_url : null,
        application_url: x.application_url ?? x.official_source_url,
        source_location: x.source_title,
        source_text: x.source_text,
        source_kind: x.verification_status === "verified" ? "verified_source" : "needs_review",
        confidence_band: "catalogue_candidate_scope_unconfirmed",
        notes: `Candidate generated from ${j.data.name} rule ${x.rule_version}. Applicability requires review against verified case facts.`,
      }));
    if (!rows.length) return { created: 0, jurisdiction: j.data.name };
    const ins = await db.from("project_permits").insert(rows);
    if (ins.error) throw new Error(ins.error.message);
    return { created: rows.length, jurisdiction: j.data.name };
  });
