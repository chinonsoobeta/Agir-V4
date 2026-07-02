import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

// Execution endpoint for the external extraction worker
// (scripts/extraction-worker.mjs in HTTP handler mode). The worker claims a
// queued extraction_jobs row directly in Postgres (lease + heartbeat), then
// POSTs { job } here; this handler runs the same document-analysis pipeline
// the in-request path uses (extraction-executor.server.ts) under the
// service-role client, scoped to the job's owner. The worker - not this
// handler - finalizes the job row from the returned status, so the two sides
// never race on the same columns.
//
// Security: disarmed (404) unless EXTRACTION_WORKER_TOKEN is configured, and
// every request must carry the token in x-worker-token (constant-time
// comparison). The job is re-read from the database - the posted body only
// names the job id, it is never trusted for ownership or state.

function tokenMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/extraction/worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.EXTRACTION_WORKER_TOKEN?.trim();
        if (!expected) return new Response("Not found", { status: 404 });
        if (!tokenMatches(request.headers.get("x-worker-token"), expected)) {
          return new Response("Unauthorized", { status: 401 });
        }

        let jobId: string | undefined;
        try {
          const body = (await request.json()) as { job?: { id?: string } };
          jobId = body?.job?.id;
        } catch {
          /* fall through to the 400 below */
        }
        if (!jobId) {
          return Response.json(
            { status: "failed", error: "Request body must be { job: { id } }." },
            { status: 400 },
          );
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // Source of truth is the database row, not the posted payload.
        const { data: job, error: jobErr } = await supabaseAdmin
          .from("extraction_jobs")
          .select("*")
          .eq("id", jobId)
          .maybeSingle();
        if (jobErr) return Response.json({ status: "failed", error: jobErr.message });
        if (!job) return Response.json({ status: "failed", error: `Unknown job ${jobId}.` });
        if (job.status !== "running") {
          return Response.json({
            status: "failed",
            error: `Job ${jobId} is ${job.status}, not running (claim it first).`,
          });
        }
        if (job.kind !== "document_analysis" || !job.document_id) {
          return Response.json({
            status: "failed",
            error: `Job kind ${job.kind} is not executable by this handler.`,
          });
        }

        const { data: doc, error: docErr } = await supabaseAdmin
          .from("documents")
          .select("*")
          .eq("id", job.document_id)
          .eq("owner_id", job.owner_id)
          .maybeSingle();
        if (docErr || !doc) {
          return Response.json({
            status: "failed",
            error: docErr?.message ?? `Document ${job.document_id} not found for job owner.`,
          });
        }

        const { executeDocumentAnalysis, ExtractionFailure } =
          await import("@/lib/extraction-executor.server");
        try {
          const result = await executeDocumentAnalysis(
            { supabase: supabaseAdmin, userId: job.owner_id },
            doc,
          );
          return Response.json({
            status: "completed",
            message: "Document analyzed by extraction worker.",
            ...result,
          });
        } catch (err) {
          const message =
            err instanceof ExtractionFailure || err instanceof Error
              ? err.message
              : "Document analysis failed.";
          return Response.json({ status: "failed", error: message });
        }
      },
    },
  },
});
