import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  canonicalPermitMunicipality,
  isCoveredPermitMunicipality,
} from "@/lib/permit-municipalities";
import { z } from "zod";

export const APPLICABILITY_STATUSES = [
  "unknown",
  "potentially_required",
  "required",
  "not_required",
  "not_applicable",
  "needs_review",
] as const;
export const WORKFLOW_STATUSES = [
  "not_started",
  "application_ready",
  "submitted",
  "under_review",
  "corrections_requested",
  "approved",
  "issued",
  "expired",
  "rejected",
  "blocked",
] as const;
export const UNKNOWN_DURATION = "Timeline not available from the source yet.";
export const UNKNOWN_REQUIREMENT = "Not enough information to decide yet.";

const permitShape = z.object({
  project_id: z.string().uuid().nullable().optional(),
  case_id: z.string().uuid().nullable().optional(),
  jurisdiction_id: z.string().uuid().nullable().optional(),
  permit_rule_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(250),
  permit_type: z.string().min(1).max(100),
  description: z.string().max(5000).nullable().optional(),
  applicability_status: z.enum(APPLICABILITY_STATUSES).default("unknown"),
  workflow_status: z.enum(WORKFLOW_STATUSES).default("not_started"),
  is_required: z.boolean().nullable().optional(),
  required_reason: z.string().max(5000).nullable().optional(),
  processing_duration_text: z.string().max(500).nullable().optional(),
  processing_duration_days: z.number().nonnegative().nullable().optional(),
  duration_source: z.string().url().or(z.string().min(1)).nullable().optional(),
  responsible_party: z.string().max(250).nullable().optional(),
  application_url: z.string().url().nullable().optional(),
  confidence_score: z.number().min(0).max(1).nullable().optional(),
  confidence_band: z.string().max(50).nullable().optional(),
  source_document_id: z.string().uuid().nullable().optional(),
  source_location: z.string().max(500).nullable().optional(),
  source_text: z.string().max(10000).nullable().optional(),
  source_kind: z
    .enum([
      "verified_source",
      "analyst",
      "extracted",
      "reported",
      "unknown",
      "needs_review",
      "not_applicable",
    ])
    .default("unknown"),
  notes: z.string().max(10000).nullable().optional(),
});
const validatePermit = <T extends z.infer<typeof permitShape>>(v: T, ctx: z.RefinementCtx) => {
  if (!v.project_id && !v.case_id)
    ctx.addIssue({
      code: "custom",
      message: "A permit case or project is required.",
      path: ["case_id"],
    });
  if (v.processing_duration_days != null && !v.duration_source)
    ctx.addIssue({
      code: "custom",
      message: "A numeric duration requires a traceable source.",
      path: ["duration_source"],
    });
  if (v.source_kind === "analyst" && !v.required_reason && !v.notes)
    ctx.addIssue({
      code: "custom",
      message: "Analyst-provided facts require a reason or note.",
      path: ["required_reason"],
    });
  if (v.is_required != null && !["required", "not_required"].includes(v.applicability_status))
    ctx.addIssue({
      code: "custom",
      message: "Required state must agree with applicability.",
      path: ["is_required"],
    });
};
const permitInput = permitShape.superRefine(validatePermit);

export const listJurisdictions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("jurisdictions")
      .select("*")
      .eq("active", true)
      .order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });
export const listPermitRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { jurisdiction_id?: string }) =>
    z.object({ jurisdiction_id: z.string().uuid().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = (context.supabase as any)
      .from("permit_rules")
      .select("*, jurisdictions(name)")
      .order("name");
    if (data.jurisdiction_id) q = q.eq("jurisdiction_id", data.jurisdiction_id);
    const r = await q;
    if (r.error) throw new Error(r.error.message);
    return r.data ?? [];
  });
export const listProjectPermits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as any)
      .from("project_permits")
      .select(
        "*, jurisdictions(name), permit_requirements(*), permit_documents(*, documents(*)), permit_history(*)",
      )
      .eq("project_id", data.project_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
export const createPermit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => permitInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await (context.supabase as any)
      .from("project_permits")
      .insert({ ...data, owner_id: context.userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });
export const updatePermit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        expected_version: z.number().int().positive().optional(),
        patch: permitShape.omit({ project_id: true, case_id: true }).partial(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: current, error: readError } = await (context.supabase as any)
      .from("project_permits")
      .select(
        "project_id,case_id,row_version,applicability_status,workflow_status,is_required,source_kind,required_reason,notes",
      )
      .eq("id", data.id)
      .single();
    if (readError) throw new Error(readError.message);
    const merged = permitInput.parse({ ...current, ...data.patch });
    const { project_id, case_id, ...patch } = merged;
    let query = (context.supabase as any).from("project_permits").update(patch).eq("id", data.id);
    if (data.expected_version) query = query.eq("row_version", data.expected_version);
    const { data: row, error } = await query.select().single();
    if (error) throw new Error(error.message);
    return row;
  });
export const addPermitRequirement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        project_permit_id: z.string().uuid(),
        name: z.string().min(1),
        description: z.string().nullable().optional(),
        requirement_type: z.string().default("paperwork"),
        is_required: z.boolean().nullable().default(null),
        notes: z.string().nullable().optional(),
        source_kind: z
          .enum([
            "verified_source",
            "analyst",
            "extracted",
            "reported",
            "unknown",
            "needs_review",
            "not_applicable",
          ])
          .default("unknown"),
        source_url: z.string().url().nullable().optional(),
        responsible_party: z.string().max(250).nullable().optional(),
        applicability_state: z
          .enum(["required", "potentially_required", "unresolved", "not_applicable"])
          .default("unresolved"),
      })
      .superRefine((value, ctx) => {
        if (value.is_required === true && value.applicability_state !== "required")
          ctx.addIssue({
            code: "custom",
            path: ["applicability_state"],
            message: "Required paperwork needs a confirmed required state.",
          });
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const r = await (context.supabase as any)
      .from("permit_requirements")
      .insert(data)
      .select()
      .single();
    if (r.error) throw new Error(r.error.message);
    return r.data;
  });
export const updatePermitRequirement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["missing", "received", "not_applicable"]),
        document_id: z.string().uuid().nullable().optional(),
        status_reason: z.string().max(5000).nullable().optional(),
      })
      .superRefine((v, ctx) => {
        if (v.status === "not_applicable" && !v.status_reason?.trim())
          ctx.addIssue({
            code: "custom",
            path: ["status_reason"],
            message: "A reason is required when paperwork is not applicable.",
          });
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const r = await (context.supabase as any)
      .from("permit_requirements")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (r.error) throw new Error(r.error.message);
    return r.data;
  });
export const deletePermitRequirement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const r = await (context.supabase as any)
      .from("permit_requirements")
      .delete()
      .eq("id", data.id);
    if (r.error) throw new Error(r.error.message);
    return { ok: true };
  });
export const linkPermitDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        permit_id: z.string().uuid(),
        document_id: z.string().uuid(),
        document_role: z.string().default("supporting"),
        is_required: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const r = await (context.supabase as any)
      .from("permit_documents")
      .upsert({ ...data, is_received: true, received_at: new Date().toISOString() })
      .select()
      .single();
    if (r.error) throw new Error(r.error.message);
    return r.data;
  });
export const unlinkPermitDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ permit_id: z.string().uuid(), document_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const r = await (context.supabase as any)
      .from("permit_documents")
      .delete()
      .eq("permit_id", data.permit_id)
      .eq("document_id", data.document_id);
    if (r.error) throw new Error(r.error.message);
    return { ok: true };
  });
export const updateProjectPermitProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        property_address: z.string().max(500).nullable().optional(),
        municipality: z.string().max(200).nullable().optional(),
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
          .nullable()
          .optional(),
        property_type: z
          .enum(["residential", "commercial", "industrial", "mixed_use"])
          .nullable()
          .optional(),
        project_description: z.string().max(5000).nullable().optional(),
        work_categories: z.array(z.string()).default([]),
        zoning_designation: z.string().nullable().optional(),
        zoning_source: z.string().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    if (patch.municipality) {
      patch.municipality = canonicalPermitMunicipality(patch.municipality);
      if (!isCoveredPermitMunicipality(patch.municipality))
        throw new Error("Choose one of the municipalities in the current research catalogue.");
    }
    const r = await (context.supabase as any)
      .from("projects")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (r.error) throw new Error(r.error.message);
    return r.data;
  });

/** Creates review candidates only for the project's confirmed municipality.
 * Catalogue evidence is copied for traceability, but applicability remains
 * unknown and no candidate is marked required. */
export const generatePermitCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const result = await (context.supabase as any).rpc("generate_permit_catalogue_candidates", {
      p_parent_kind: "project",
      p_parent_id: data.project_id,
    });
    if (result.error) throw new Error(result.error.message);
    return result.data;
  });

export const listPermitExtractionCandidates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const result = await (context.supabase as any)
      .from("permit_extraction_candidates")
      .select("*, documents(name), jurisdictions(name)")
      .eq("project_id", data.project_id)
      .order("created_at", { ascending: false });
    if (result.error) throw new Error(result.error.message);
    return result.data ?? [];
  });

export const reviewPermitExtractionCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        decision: z.enum(["accepted", "rejected"]),
        reason: z.string().min(1).max(5000),
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

export const listAuthoritativeLandDataSources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ jurisdiction_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const result = await (context.supabase as any)
      .from("authoritative_land_data_sources")
      .select("*")
      .eq("jurisdiction_id", data.jurisdiction_id)
      .order("source_name");
    if (result.error) throw new Error(result.error.message);
    return result.data ?? [];
  });

export const extractPermitCandidatesFromDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ project_id: z.string().uuid(), document_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const documentResult = await db
      .from("documents")
      .select(
        "id,owner_id,project_id,permit_case_id,name,file_type,storage_path,size_bytes,scan_status,status",
      )
      .eq("id", data.document_id)
      .eq("project_id", data.project_id)
      .single();
    if (documentResult.error) throw new Error(documentResult.error.message);
    const access = await db.rpc("permit_project_access", { p_project_id: data.project_id });
    if (access.error || !access.data) throw new Error("Project write access is required.");
    const { requestPermitDocumentResearch } = await import("./permit-research.server");
    return requestPermitDocumentResearch(context, documentResult.data, "project");
  });
