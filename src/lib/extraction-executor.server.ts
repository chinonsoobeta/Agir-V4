// The document-analysis pipeline, extracted from the request path so the SAME
// code runs in two places:
//   - in-request (legacy default): analyzeDocument calls this directly, and
//     the HTTP response waits for the result;
//   - async worker: analyzeDocument only enqueues an extraction_jobs row
//     (EXTRACTION_ASYNC=1) and the worker executes this via the token-guarded
//     /api/extraction/worker endpoint.
// Every step persists its progress to the documents row (scan verdict, page
// count, OCR confidence, extraction_status), so the UI shows live status via
// realtime refresh regardless of which path ran the work.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Ctx = { supabase: SupabaseClient<Database>; userId: string };

export type DocumentAnalysisResult = { summary: string; assumptions: string; risks: string };

/** Thrown after the failure has already been persisted to the documents row. */
export class ExtractionFailure extends Error {}

type DocumentRowLike = {
  id: string;
  name: string;
  category?: string | null;
  storage_path: string;
  file_type?: string | null;
};

/**
 * Run the full analysis pipeline for one document: download -> safety scan ->
 * text/OCR extraction -> AI summarization -> persist. On failure the document
 * row is marked extraction_failed with the reason BEFORE ExtractionFailure is
 * thrown, so callers only need to map the outcome onto their job row.
 */
export async function executeDocumentAnalysis(
  ctx: Ctx,
  doc: DocumentRowLike,
): Promise<DocumentAnalysisResult> {
  const fail = async (message: string): Promise<never> => {
    await ctx.supabase
      .from("documents")
      .update({
        status: "extraction_failed",
        extraction_status: "failed",
        extraction_error: message,
      })
      .eq("id", doc.id);
    throw new ExtractionFailure(message);
  };

  await ctx.supabase.from("documents").update({ extraction_status: "running" }).eq("id", doc.id);

  const { downloadDocumentBlob } = await import("./storage-download.server");
  const dl = await downloadDocumentBlob(ctx.supabase, doc.storage_path);
  if (dl.error || !dl.data) {
    await fail(dl.error?.message ?? "Unable to download document for extraction.");
  }
  const buffer = await dl.data!.arrayBuffer();

  // Safety scan BEFORE any parsing: structural checks always, plus an external
  // AV/content scan when DOCUMENT_SCAN_URL is configured (fails closed).
  const { scanDocument, UPLOAD_LIMITS } = await import("./upload-guards.server");
  const scan = await scanDocument(doc.name, buffer);
  await ctx.supabase
    .from("documents")
    .update({
      scan_status: scan.ok ? "clean" : "rejected",
      scan_detail: `[${scan.engine}] ${scan.detail}`,
    })
    .eq("id", doc.id);
  if (!scan.ok) await fail(`File rejected by safety scan: ${scan.detail}`);

  const { extractFileTextWithMeta } = await import("./document-text.server");
  const extracted = await extractFileTextWithMeta(doc.name, doc.file_type ?? null, buffer);
  const pageCount = extracted.ocrTotalPages;
  // Max-pages guard with graceful messaging for very large uploads.
  if (pageCount != null && pageCount > UPLOAD_LIMITS.maxDocumentPages) {
    await ctx.supabase.from("documents").update({ page_count: pageCount }).eq("id", doc.id);
    await fail(
      `Document has ${pageCount} pages, above the ${UPLOAD_LIMITS.maxDocumentPages}-page limit for automated extraction. Split the file or request a manual review.`,
    );
  }
  // Persist per-document extraction signals so low-confidence (OCR) docs are
  // visibly flagged for analyst review before they can drive a verdict.
  await ctx.supabase
    .from("documents")
    .update({
      page_count: pageCount,
      ocr_confidence: extracted.ocrConfidence,
    })
    .eq("id", doc.id);
  const text = extracted.text;
  if (!text.trim()) await fail("No extractable text was found in this document.");

  const { getAgirModel } = await import("./ai-gateway.server");
  const { generateText } = await import("ai");
  let result: { text: string };
  try {
    result = await generateText({
      model: getAgirModel(),
      temperature: 0,
      // Bound the model call: a hung provider must fail the job (retryable)
      // instead of pinning a request/worker slot indefinitely.
      abortSignal: AbortSignal.timeout(120_000),
      system: "Summarize only the supplied document text. Do not infer missing financial values.",
      prompt: `Document: ${doc.name}
Category: ${doc.category || "uncategorized"}

TEXT:
${text.slice(0, 30000)}

Respond as compact JSON only with keys: summary, key_assumptions, risks, important_dates, financial_highlights. If a value is absent, write "Not found in document."`,
    });
  } catch (e) {
    // AI gateway / key failures must persist a clear, retryable failed status.
    return await fail(
      e instanceof Error
        ? e.message
        : "AI extraction is unavailable. Check the model configuration.",
    );
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
  const assumptions = [parsed.key_assumptions, parsed.financial_highlights, parsed.important_dates]
    .filter(Boolean)
    .join("\n\n");
  const risks = parsed.risks ?? "";
  const { error } = await ctx.supabase
    .from("documents")
    .update({
      ai_summary: summary,
      ai_assumptions: assumptions,
      ai_risks: risks,
      status: "analyzed",
      extraction_status: "completed",
      extraction_error: null,
    })
    .eq("id", doc.id);
  if (error) throw new Error(error.message);
  return { summary, assumptions, risks };
}
