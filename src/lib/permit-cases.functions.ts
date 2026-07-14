import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { canonicalPermitMunicipality } from "@/lib/permit-municipalities";
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
  address_line_2: z.string().max(200).nullable().optional(),
  building_name: z.string().max(250).nullable().optional(),
  address_provider: z.enum(["google_places", "openstreetmap", "manual"]).nullable().optional(),
  address_place_id: z.string().max(500).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  municipality: z.string().max(200).nullable().optional(),
  municipality_confirmed: z.boolean().default(false),
  province: z.string().min(1).max(100).default("British Columbia"),
  postal_code: z.string().max(30).nullable().optional(),
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
    const municipality = canonicalPermitMunicipality(data.municipality);
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
      .insert({ ...data, municipality, owner_id: context.userId })
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
    const municipality = data.patch.municipality
      ? canonicalPermitMunicipality(data.patch.municipality)
      : data.patch.municipality;
    const r = await (context.supabase as any)
      .from("permit_cases")
      .update({ ...data.patch, municipality })
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

export const setPermitCaseArchived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        case_id: z.string().uuid(),
        archived: z.boolean(),
        reason: z.string().trim().min(1).max(1000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const result = await (context.supabase as any).rpc("set_permit_case_archived", {
      p_case_id: data.case_id,
      p_archived: data.archived,
      p_reason: data.reason,
    });
    if (result.error) throw new Error(result.error.message);
    return result.data;
  });

export const transferPermitCaseToWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        case_id: z.string().uuid(),
        workspace_id: z.string().uuid(),
        reason: z.string().trim().min(1).max(1000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const result = await (context.supabase as any).rpc("transfer_permit_case_to_workspace", {
      p_case_id: data.case_id,
      p_workspace_id: data.workspace_id,
      p_reason: data.reason,
    });
    if (result.error) throw new Error(result.error.message);
    return result.data;
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
    const result = await (context.supabase as any).rpc("generate_permit_catalogue_candidates", {
      p_parent_kind: "permit_case",
      p_parent_id: data.case_id,
    });
    if (result.error) throw new Error(result.error.message);
    return result.data;
  });

export const listPermitCaseExtractionCandidates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ case_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const result = await (context.supabase as any)
      .from("permit_extraction_candidates")
      .select("*,documents(name)")
      .eq("permit_case_id", data.case_id)
      .order("created_at", { ascending: false });
    if (result.error) throw new Error(result.error.message);
    return result.data ?? [];
  });

export const extractPermitCaseDocumentCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ case_id: z.string().uuid(), document_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const documentResult = await db
      .from("documents")
      .select(
        "id,owner_id,project_id,permit_case_id,name,file_type,storage_path,size_bytes,scan_status,status",
      )
      .eq("id", data.document_id)
      .eq("permit_case_id", data.case_id)
      .single();
    if (documentResult.error) throw new Error(documentResult.error.message);
    const access = await db.rpc("permit_case_write_access", { p_case_id: data.case_id });
    if (access.error || !access.data) throw new Error("Permit case write access is required.");
    const { requestPermitDocumentResearch } = await import("./permit-research.server");
    return requestPermitDocumentResearch(context, documentResult.data, "case");
  });

export const reviewPermitCaseExtractionCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        decision: z.enum(["accepted", "rejected"]),
        reason: z.string().trim().min(1).max(1000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const reviewed = await (context.supabase as any).rpc("review_permit_extraction_candidate", {
      p_candidate_id: data.id,
      p_decision: data.decision,
      p_reason: data.reason,
    });
    if (reviewed.error) throw new Error(reviewed.error.message);
    return reviewed.data;
  });

export const getPermitCaseCollaboration = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ case_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const [assignments, handoffs] = await Promise.all([
      db
        .from("permit_case_assignments")
        .select("*")
        .eq("case_id", data.case_id)
        .order("created_at", { ascending: false }),
      db
        .from("permit_case_handoffs")
        .select("*")
        .eq("case_id", data.case_id)
        .order("created_at", { ascending: false }),
    ]);
    if (assignments.error) throw new Error(assignments.error.message);
    if (handoffs.error) throw new Error(handoffs.error.message);
    return { assignments: assignments.data ?? [], handoffs: handoffs.data ?? [] };
  });

export const assignPermitCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        case_id: z.string().uuid(),
        assignee_id: z.string().uuid(),
        responsibility: z.string().trim().min(1).max(250),
        due_at: z.string().datetime().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const result = await (context.supabase as any)
      .from("permit_case_assignments")
      .insert({ ...data, assigned_by: context.userId })
      .select()
      .single();
    if (result.error) throw new Error(result.error.message);
    return result.data;
  });

export const startPermitCaseHandoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        case_id: z.string().uuid(),
        to_user_id: z.string().uuid(),
        note: z.string().trim().min(1).max(5000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const result = await (context.supabase as any)
      .from("permit_case_handoffs")
      .insert({
        ...data,
        from_user_id: context.userId,
        initiated_by: context.userId,
      })
      .select()
      .single();
    if (result.error) throw new Error(result.error.message);
    return result.data;
  });

export const respondPermitCaseHandoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ handoff_id: z.string().uuid(), status: z.enum(["accepted", "rejected"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc(
      "respond_permit_case_handoff" as never,
      {
        p_handoff_id: data.handoff_id,
        p_status: data.status,
      } as never,
    );
    if (result.error) throw new Error(result.error.message);
    return result.data;
  });
