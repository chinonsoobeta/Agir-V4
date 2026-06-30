import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

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

    // Idempotency / dedup: an identical file already in this project is reused
    // rather than re-inserted (a double-click or retry is a no-op).
    if (data.content_hash) {
      let dq = context.supabase
        .from("documents")
        .select("*")
        .eq("owner_id", context.userId)
        .eq("content_hash", data.content_hash);
      dq = data.project_id ? dq.eq("project_id", data.project_id) : dq.is("project_id", null);
      const { data: existing } = await dq.maybeSingle();
      if (existing) return { ...existing, deduped: true };
    }

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

    const { claimJob, completeJob, failJob } = await import("./extraction-jobs.server");
    const { scanDocument, UPLOAD_LIMITS } = await import("./upload-guards.server");

    // Idempotent + observable: one job per (owner, document content). A retry or
    // double-click re-attaches to the existing job instead of re-running OCR/AI.
    const idempotencyKey = (doc as any).content_hash || `doc:${doc.id}`;
    const { job, existed } = await claimJob(context, {
      kind: "document_analysis",
      idempotencyKey,
      projectId: doc.project_id,
      documentId: doc.id,
      message: "Extracting document text",
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

    const failExtraction = async (message: string) => {
      await context.supabase
        .from("documents")
        .update({
          status: "extraction_failed",
          extraction_status: "failed",
          extraction_error: message,
        })
        .eq("id", data.id);
      await failJob(context, job.id, message);
      throw new Error(message);
    };

    await context.supabase
      .from("documents")
      .update({ extraction_status: "running" })
      .eq("id", data.id);

    const { downloadDocumentBlob } = await import("./storage-download.server");
    const dl = await downloadDocumentBlob(context.supabase, doc.storage_path);
    if (dl.error || !dl.data)
      await failExtraction(dl.error?.message ?? "Unable to download document for extraction.");
    const buffer = await dl.data.arrayBuffer();

    // Safety scan BEFORE any parsing: structural checks always, plus an external
    // AV/content scan when DOCUMENT_SCAN_URL is configured (fails closed).
    const scan = await scanDocument(doc.name, buffer);
    await context.supabase
      .from("documents")
      .update({
        scan_status: scan.ok ? "clean" : "rejected",
        scan_detail: `[${scan.engine}] ${scan.detail}`,
      })
      .eq("id", data.id);
    if (!scan.ok) await failExtraction(`File rejected by safety scan: ${scan.detail}`);

    const { extractFileTextWithMeta } = await import("./document-text.server");
    const extracted = await extractFileTextWithMeta(doc.name, doc.file_type, buffer);
    const pageCount = extracted.ocrTotalPages;
    // Max-pages guard with graceful messaging for very large uploads.
    if (pageCount != null && pageCount > UPLOAD_LIMITS.maxDocumentPages) {
      await context.supabase.from("documents").update({ page_count: pageCount }).eq("id", data.id);
      await failExtraction(
        `Document has ${pageCount} pages, above the ${UPLOAD_LIMITS.maxDocumentPages}-page limit for automated extraction. Split the file or request a manual review.`,
      );
    }
    // Persist per-document extraction signals so low-confidence (OCR) docs are
    // visibly flagged for analyst review before they can drive a verdict.
    await context.supabase
      .from("documents")
      .update({
        page_count: pageCount,
        ocr_confidence: extracted.ocrConfidence,
      })
      .eq("id", data.id);
    const text = extracted.text;
    if (!text.trim()) await failExtraction("No extractable text was found in this document.");

    const { getAgirModel } = await import("./ai-gateway.server");
    const { generateText } = await import("ai");
    let result: { text: string };
    try {
      result = await generateText({
        model: getAgirModel(),
        temperature: 0,
        system: "Summarize only the supplied document text. Do not infer missing financial values.",
        prompt: `Document: ${data.name}
Category: ${data.category || "uncategorized"}

TEXT:
${text.slice(0, 30000)}

Respond as compact JSON only with keys: summary, key_assumptions, risks, important_dates, financial_highlights. If a value is absent, write "Not found in document."`,
      });
    } catch (e: any) {
      // AI gateway / key failures must persist a clear, retryable failed status.
      await failExtraction(
        e?.message ?? "AI extraction is unavailable. Check the model configuration.",
      );
      return { summary: "", assumptions: "", risks: "" }; // unreachable: failExtraction throws
    }
    let parsed: {
      summary?: string;
      key_assumptions?: string;
      risks?: string;
      important_dates?: string;
      financial_highlights?: string;
    } = {};
    try {
      const m = result.text.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    } catch {
      /* keep empty */
    }
    const summary = parsed.summary ?? text.slice(0, 500);
    const assumptions = [
      parsed.key_assumptions,
      parsed.financial_highlights,
      parsed.important_dates,
    ]
      .filter(Boolean)
      .join("\n\n");
    const risks = parsed.risks ?? "";
    const { error } = await context.supabase
      .from("documents")
      .update({
        ai_summary: summary,
        ai_assumptions: assumptions,
        ai_risks: risks,
        status: "analyzed",
        extraction_status: "completed",
        extraction_error: null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    const extractionResult = { summary, assumptions, risks };
    await completeJob(context, job.id, extractionResult);
    return extractionResult;
  });
