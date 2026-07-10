import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { handleSchemaCompatibilityFallback, isMissingRelation } from "./db-compat";

const EXTRACTION_JOBS_FEATURE = "extraction_jobs queue";

export const listDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { project_id?: string }) => d)
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("documents")
      .select("*")
      .order("upload_date", { ascending: false });
    if (data?.project_id) q = q.eq("project_id", data.project_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listExtractionJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { project_id?: string }) => d)
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("extraction_jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (data?.project_id) q = q.eq("project_id", data.project_id);
    const { data: rows, error } = await q;
    if (isMissingRelation(error))
      return handleSchemaCompatibilityFallback(error, {
        featureName: EXTRACTION_JOBS_FEATURE,
        table: "extraction_jobs",
        operation: "list extraction jobs",
        fallback: [],
      });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// Cancel an in-flight / queued extraction job. A completed job is immutable.
export const cancelExtractionJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: job, error } = await context.supabase
      .from("extraction_jobs")
      .select("status")
      .eq("id", data.id)
      .single();
    if (isMissingRelation(error))
      return handleSchemaCompatibilityFallback(error, {
        featureName: EXTRACTION_JOBS_FEATURE,
        table: "extraction_jobs",
        operation: "cancel extraction job lookup",
        fallback: { ok: true },
      });
    if (error) throw new Error(error.message);
    if (job.status === "completed") throw new Error("A completed job cannot be cancelled.");
    const { requestJobCancellation } = await import("./extraction-jobs.server");
    await requestJobCancellation(context, data.id);
    return { ok: true };
  });

// Retry a failed / cancelled job: clears the job so the next analyze/extract
// call re-claims a fresh one (the work is keyed idempotently by content-hash).
export const retryExtractionJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: job, error } = await context.supabase
      .from("extraction_jobs")
      .select("status, document_id")
      .eq("id", data.id)
      .single();
    if (isMissingRelation(error))
      return handleSchemaCompatibilityFallback(error, {
        featureName: EXTRACTION_JOBS_FEATURE,
        table: "extraction_jobs",
        operation: "retry extraction job lookup",
        fallback: { ok: true, document_id: null },
      });
    if (error) throw new Error(error.message);
    if (job.status === "running") throw new Error("This job is still running.");
    if (job.status === "completed") throw new Error("This job already completed.");
    // Reset (not delete) so it stays under the owner-gated UPDATE policy; the
    // next analyze/extract call re-runs the work (keyed idempotently by hash).
    const { error: updErr } = await context.supabase
      .from("extraction_jobs")
      .update({ status: "queued", progress: 0, error: null, finished_at: null })
      .eq("id", data.id);
    if (updErr) throw new Error(updErr.message);
    if (job.document_id) {
      await context.supabase
        .from("documents")
        .update({ extraction_status: "pending", extraction_error: null })
        .eq("id", job.document_id);
    }
    return { ok: true, document_id: job.document_id as string | null };
  });

const CreateDocSchema = z.object({
  project_id: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(255),
  file_type: z.string().max(255).optional().nullable(),
  category: z.string().max(255).optional().nullable(),
  storage_path: z.string().min(1),
  size_bytes: z.number().int().min(0).optional(),
  // SHA-256 of the file content, computed client-side, used for idempotent
  // upload (same content in the same project is one document) and dedup.
  content_hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional()
    .nullable(),
});

export const createDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => CreateDocSchema.parse(d))
  .handler(async ({ data, context }) => {
    // Storage RLS enforces the same boundary, but validate it before persisting
    // the metadata row as well. This prevents a hand-crafted server-function
    // request from registering an arbitrary path for later privileged recovery.
    if (
      !data.storage_path.startsWith(`${context.userId}/`) ||
      data.storage_path.includes("..") ||
      data.storage_path.includes("\\")
    ) {
      throw new Error("Document storage path is invalid.");
    }

    // Idempotency / dedup: an identical file already in this project is reused
    // rather than re-inserted (a double-click or retry is a no-op). Do this
    // before consuming an upload-rate token or checking aggregate quota: a
    // harmless retry must not exhaust either resource-control limit.
    if (data.content_hash) {
      let dq = context.supabase
        .from("documents")
        .select("*")
        .eq("owner_id", context.userId)
        .eq("content_hash", data.content_hash);
      dq = data.project_id ? dq.eq("project_id", data.project_id) : dq.is("project_id", null);
      const { data: existing, error: existingError } = await dq.maybeSingle();
      if (existingError) throw new Error(existingError.message);
      if (existing) return { ...existing, deduped: true };
    }

    const { enforceRateLimit } = await import("./rate-limit.server");
    await enforceRateLimit(context, "document_upload", {
      metadata: { file_type: data.file_type ?? null, size_bytes: data.size_bytes ?? 0 },
    });
    const { UPLOAD_LIMITS, enforceUploadQuota } = await import("./upload-guards.server");
    const size = data.size_bytes ?? 0;
    if (size > UPLOAD_LIMITS.maxFileBytes) {
      throw new Error(
        `File exceeds the ${Math.round(UPLOAD_LIMITS.maxFileBytes / (1024 * 1024))} MB upload limit.`,
      );
    }
    await enforceUploadQuota(context, size);

    const { data: row, error } = await context.supabase
      .from("documents")
      .insert({
        ...data,
        owner_id: context.userId,
        extraction_status: "pending",
        scan_status: "pending",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: doc } = await context.supabase
      .from("documents")
      .select("storage_path")
      .eq("id", data.id)
      .single();
    if (doc?.storage_path)
      await context.supabase.storage.from("documents").remove([doc.storage_path]);
    const { error } = await context.supabase.from("documents").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getDocumentUrl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { enforceRateLimit } = await import("./rate-limit.server");
    await enforceRateLimit(context, "signed_document_url", { metadata: { document_id: data.id } });
    const { data: doc, error } = await context.supabase
      .from("documents")
      .select("storage_path,project_id")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    if (
      doc.storage_path.startsWith("/") ||
      doc.storage_path.includes("..") ||
      doc.storage_path.includes("\\")
    ) {
      throw new Error("Document storage path is invalid.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error: signedError } = await supabaseAdmin.storage
      .from("documents")
      .createSignedUrl(doc.storage_path, 300);
    if (signedError) throw new Error(signedError.message);
    const { writeAuditEvent } = await import("./audit.server");
    await writeAuditEvent(context, {
      projectId: doc.project_id,
      entityType: "documents",
      entityId: data.id,
      action: "signed_url_created",
      payload: { ttl_seconds: 300 },
    });
    return { url: signed?.signedUrl ?? null };
  });

export const analyzeDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { id: string; name: string; category?: string | null }) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string(),
        category: z.string().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { enforceRateLimit } = await import("./rate-limit.server");
    await enforceRateLimit(context, "document_analysis", { metadata: { document_id: data.id } });
    const { data: doc, error: docErr } = await context.supabase
      .from("documents")
      .select("*")
      .eq("id", data.id)
      .single();
    if (docErr) throw new Error(docErr.message);

    const { claimJob, completeJob, failJob, isInlineJob } =
      await import("./extraction-jobs.server");

    // EXTRACTION_ASYNC=1 moves the heavy pipeline (download, AV scan, OCR, AI)
    // off the request path: this handler only records a queued job and returns
    // immediately; a worker (scripts/extraction-worker.mjs -> the token-guarded
    // /api/extraction/worker endpoint) executes it. Default remains in-request
    // so environments without a worker keep working unchanged.
    let asyncMode = process.env.EXTRACTION_ASYNC === "1";

    // Idempotent + observable: one job per (owner, document content). A retry or
    // double-click re-attaches to the existing job instead of re-running OCR/AI.
    const idempotencyKey = doc.content_hash || `doc:${doc.id}`;
    const { job, existed } = await claimJob(context, {
      kind: "document_analysis",
      idempotencyKey,
      projectId: doc.project_id,
      documentId: doc.id,
      message: "Extracting document text",
      enqueue: asyncMode,
    });
    if (existed && job.status === "completed") {
      return (
        (job.result_json as { summary: string; assumptions: string; risks: string }) ?? {
          summary: "",
          assumptions: "",
          risks: "",
        }
      );
    }
    // A pre-migration DB has no extraction_jobs table, so no worker could ever
    // claim the job -- fall back to in-request execution rather than strand it.
    if (isInlineJob(job)) asyncMode = false;

    if (asyncMode) {
      // Freshly enqueued, or re-attached to a job that is already queued or
      // running: either way the worker owns execution from here. Mark the
      // document so the UI shows a live "queued" badge (realtime refresh).
      if (!existed) {
        await context.supabase
          .from("documents")
          .update({ extraction_status: "queued" })
          .eq("id", data.id);
      }
      return { queued: true as const, job_id: job.id, summary: "", assumptions: "", risks: "" };
    }

    const { executeDocumentAnalysis, ExtractionFailure } =
      await import("./extraction-executor.server");
    try {
      const extractionResult = await executeDocumentAnalysis(context, doc);
      await completeJob(context, job.id, extractionResult);
      return extractionResult;
    } catch (err) {
      const message = "Document analysis failed. Please try again.";
      await failJob(context, job.id, err instanceof Error ? err.message : message);
      throw new Error(message);
    }
  });
