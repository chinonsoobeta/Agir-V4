import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
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
export const UNKNOWN_DURATION = "Processing duration: Not found in verified sources.";
export const UNKNOWN_REQUIREMENT =
  "Requirement status: Cannot be determined from the available project information.";

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
        is_required: z.boolean().default(true),
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
    const db = context.supabase as any;
    const projectResult = await db
      .from("projects")
      .select("id,municipality,property_address,workspace_id")
      .eq("id", data.project_id)
      .single();
    if (projectResult.error) throw new Error(projectResult.error.message);
    if (!projectResult.data.municipality) {
      throw new Error("Confirm the project municipality before generating permit candidates.");
    }
    const jurisdictionResult = await db
      .from("jurisdictions")
      .select("id,name")
      .eq("name", projectResult.data.municipality)
      .eq("active", true)
      .single();
    if (jurisdictionResult.error) {
      throw new Error("The confirmed municipality is not in the current permit pilot.");
    }
    const rulesResult = await db
      .from("permit_rules")
      .select("*")
      .eq("jurisdiction_id", jurisdictionResult.data.id)
      .eq("rule_version", "2026-07-10-matrix")
      .order("permit_type");
    if (rulesResult.error) throw new Error(rulesResult.error.message);
    const existingResult = await db
      .from("project_permits")
      .select("permit_rule_id")
      .eq("project_id", data.project_id)
      .not("permit_rule_id", "is", null);
    if (existingResult.error) throw new Error(existingResult.error.message);
    const existing = new Set((existingResult.data ?? []).map((row: any) => row.permit_rule_id));
    const rules = (rulesResult.data ?? []).filter((rule: any) => !existing.has(rule.id));
    if (!rules.length) return { created: 0, jurisdiction: jurisdictionResult.data.name };
    const rows = rules.map((rule: any) => ({
      project_id: data.project_id,
      owner_id: context.userId,
      jurisdiction_id: jurisdictionResult.data.id,
      permit_rule_id: rule.id,
      name: rule.name,
      permit_type: rule.permit_type,
      description: rule.description,
      applicability_status: "unknown",
      workflow_status: "not_started",
      is_required: null,
      processing_duration_text: rule.published_duration_text,
      processing_duration_days: rule.published_duration_days,
      duration_source: rule.published_duration_text ? rule.official_source_url : null,
      application_url: rule.application_url ?? rule.official_source_url,
      source_location: rule.source_title,
      source_text: rule.source_text,
      source_kind: rule.verification_status === "unknown" ? "unknown" : "verified_source",
      confidence_band:
        rule.verification_status === "unknown" ? "unknown" : "source_verified_scope_unconfirmed",
      notes:
        "Generated from the municipality-specific pilot catalogue. Applicability requires analyst review against verified project facts.",
    }));
    const inserted = await db.from("project_permits").insert(rows).select("id,permit_rule_id");
    if (inserted.error) throw new Error(inserted.error.message);
    const requirementRows = (inserted.data ?? []).flatMap((permit: any) => {
      const rule = rules.find((candidate: any) => candidate.id === permit.permit_rule_id);
      return Array.isArray(rule?.required_documents)
        ? rule.required_documents.map((name: string) => ({
            project_permit_id: permit.id,
            name,
            requirement_type: "paperwork",
            status: "missing",
            is_required: true,
            source_text: rule.source_text,
          }))
        : [];
    });
    if (requirementRows.length) {
      const requirements = await db.from("permit_requirements").insert(requirementRows);
      if (requirements.error) throw new Error(requirements.error.message);
    }
    return { created: rows.length, jurisdiction: jurisdictionResult.data.name };
  });

const extractionCandidateSchema = z
  .object({
    project_id: z.string().uuid(),
    document_id: z.string().uuid(),
    jurisdiction_id: z.string().uuid().nullable().optional(),
    candidate_name: z.string().min(1).max(250),
    permit_type: z.string().max(100).nullable().optional(),
    description: z.string().max(5000).nullable().optional(),
    processing_duration_text: z.string().max(500).nullable().optional(),
    processing_duration_days: z.number().nonnegative().nullable().optional(),
    authority_name: z.string().max(250).nullable().optional(),
    source_location: z.string().min(1).max(500),
    source_text: z.string().min(1).max(10000),
    confidence_score: z.number().min(0).max(1).nullable().optional(),
    extraction_version: z.string().min(1).max(100),
  })
  .superRefine((row, ctx) => {
    if (row.processing_duration_days != null && !row.processing_duration_text) {
      ctx.addIssue({
        code: "custom",
        path: ["processing_duration_text"],
        message: "Extracted numeric durations require verbatim source text.",
      });
    }
  });

/** LLM/extractor boundary: stores a candidate only. This cannot create a
 * verified rule or project permit until an analyst explicitly accepts it. */
export const createPermitExtractionCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => extractionCandidateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const result = await (context.supabase as any)
      .from("permit_extraction_candidates")
      .upsert(
        { ...data, owner_id: context.userId, review_status: "needs_review" },
        { onConflict: "document_id,candidate_name,source_location,extraction_version" },
      )
      .select()
      .single();
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
    const db = context.supabase as any;
    const current = await db
      .from("permit_extraction_candidates")
      .select("*")
      .eq("id", data.id)
      .eq("review_status", "needs_review")
      .single();
    if (current.error) throw new Error(current.error.message);
    let projectPermitId: string | null = null;
    if (data.decision === "accepted") {
      const permit = await db
        .from("project_permits")
        .insert({
          project_id: current.data.project_id,
          owner_id: context.userId,
          jurisdiction_id: current.data.jurisdiction_id,
          name: current.data.candidate_name,
          permit_type: current.data.permit_type ?? "other",
          description: current.data.description,
          applicability_status: "needs_review",
          workflow_status: "not_started",
          is_required: null,
          processing_duration_text: current.data.processing_duration_text,
          processing_duration_days: current.data.processing_duration_days,
          duration_source: current.data.processing_duration_text
            ? `Project document: ${current.data.document_id}`
            : null,
          source_document_id: current.data.document_id,
          source_location: current.data.source_location,
          source_text: current.data.source_text,
          source_kind: "extracted",
          confidence_score: current.data.confidence_score,
          confidence_band: "extracted_analyst_accepted_needs_applicability_review",
          required_reason: data.reason,
          notes:
            "Accepted from document extraction. Acceptance preserves evidence but does not establish that the permit is required.",
        })
        .select("id")
        .single();
      if (permit.error) throw new Error(permit.error.message);
      projectPermitId = permit.data.id;
    }
    const reviewed = await db
      .from("permit_extraction_candidates")
      .update({
        review_status: data.decision,
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
        review_reason: data.reason,
        project_permit_id: projectPermitId,
      })
      .eq("id", data.id)
      .select()
      .single();
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
      .select("id,project_id,name,file_type,storage_path")
      .eq("id", data.document_id)
      .eq("project_id", data.project_id)
      .single();
    if (documentResult.error) throw new Error(documentResult.error.message);
    const { downloadDocumentBlob } = await import("./storage-download.server");
    const download = await downloadDocumentBlob(context.supabase, documentResult.data.storage_path);
    if (download.error || !download.data) {
      throw new Error(
        `Unable to read source document: ${download.error?.message ?? "unknown error"}`,
      );
    }
    const { extractFileTextWithMeta } = await import("./document-text.server");
    const extracted = await extractFileTextWithMeta(
      documentResult.data.name,
      documentResult.data.file_type,
      await download.data.arrayBuffer(),
    );
    const { extractExplicitPermitMentions } = await import("./permit-domain");
    const mentions = extractExplicitPermitMentions(extracted.text);
    if (!mentions.length) return { created: 0, candidates: [] };
    const rows = mentions.map((mention) => ({
      project_id: data.project_id,
      owner_id: context.userId,
      document_id: data.document_id,
      candidate_name: mention.candidateName,
      permit_type: null,
      source_location: mention.sourceLocation,
      source_text: mention.sourceText,
      confidence_score: extracted.recoveredViaOcr
        ? Math.min(0.6, (extracted.ocrConfidence ?? 0) / 100)
        : 0.7,
      review_status: "needs_review",
      extraction_version: "explicit-mention-v1",
    }));
    const inserted = await db
      .from("permit_extraction_candidates")
      .upsert(rows, {
        onConflict: "document_id,candidate_name,source_location,extraction_version",
        ignoreDuplicates: true,
      })
      .select();
    if (inserted.error) throw new Error(inserted.error.message);
    return { created: inserted.data?.length ?? 0, candidates: inserted.data ?? [] };
  });
