import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { project_id?: string }) => d)
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("documents").select("*").order("upload_date", { ascending: false });
    if (data?.project_id) q = q.eq("project_id", data.project_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const CreateDocSchema = z.object({
  project_id: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(255),
  file_type: z.string().max(255).optional().nullable(),
  category: z.string().max(255).optional().nullable(),
  storage_path: z.string().min(1),
  size_bytes: z.number().int().min(0).optional(),
});

export const createDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateDocSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("documents").insert({ ...data, owner_id: context.userId }).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: doc } = await context.supabase.from("documents").select("storage_path").eq("id", data.id).single();
    if (doc?.storage_path) await context.supabase.storage.from("documents").remove([doc.storage_path]);
    const { error } = await context.supabase.from("documents").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getDocumentUrl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: doc, error } = await context.supabase.from("documents").select("storage_path").eq("id", data.id).single();
    if (error) throw new Error(error.message);
    const { data: signed } = await context.supabase.storage.from("documents")
      .createSignedUrl(doc.storage_path, 3600);
    return { url: signed?.signedUrl ?? null };
  });

export const analyzeDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; name: string; category?: string | null }) =>
    z.object({ id: z.string().uuid(), name: z.string(), category: z.string().nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: doc, error: docErr } = await context.supabase
      .from("documents")
      .select("*")
      .eq("id", data.id)
      .single();
    if (docErr) throw new Error(docErr.message);

    const failExtraction = async (message: string) => {
      await context.supabase
        .from("documents")
        .update({ status: "extraction_failed", extraction_error: message })
        .eq("id", data.id);
      throw new Error(message);
    };

    const { downloadDocumentBlob } = await import("./storage-download.server");
    const dl = await downloadDocumentBlob(context.supabase, doc.storage_path);
    if (dl.error || !dl.data) await failExtraction(dl.error?.message ?? "Unable to download document for extraction.");
    const { extractFileText } = await import("./document-text.server");
    const text = await extractFileText(doc.name, doc.file_type, await dl.data.arrayBuffer());
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
      await failExtraction(e?.message ?? "AI extraction is unavailable. Check the model configuration.");
      return { summary: "", assumptions: "", risks: "" }; // unreachable: failExtraction throws
    }
    let parsed: { summary?: string; key_assumptions?: string; risks?: string; important_dates?: string; financial_highlights?: string } = {};
    try {
      const m = result.text.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    } catch { /* keep empty */ }
    const summary = parsed.summary ?? text.slice(0, 500);
    const assumptions = [parsed.key_assumptions, parsed.financial_highlights, parsed.important_dates]
      .filter(Boolean).join("\n\n");
    const risks = parsed.risks ?? "";
    const { error } = await context.supabase.from("documents").update({
      ai_summary: summary, ai_assumptions: assumptions, ai_risks: risks,
      status: "analyzed", extraction_error: null,
    }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { summary, assumptions, risks };
  });
