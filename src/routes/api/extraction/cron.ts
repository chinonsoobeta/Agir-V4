import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { getServerConfig } from "@/lib/config.server";
import { claimNextQueuedJob } from "@/lib/extraction-jobs.server";
import { executeQueuedExtractionJob } from "./worker";

export const maxDuration = 60;

function authorized(request: Request, secret: string) {
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

/**
 * A bounded Vercel Cron dispatcher. It claims one job under a lease, executes
 * it in-process, then lets the database atomically apply retry/dead-letter
 * semantics. This avoids relying on a permanently running worker for the
 * production Vercel deployment.
 */
export const Route = createFileRoute("/api/extraction/cron")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.CRON_SECRET;
        if (!secret || !authorized(request, secret)) return new Response("Not found", { status: 404 });
        const config = getServerConfig(["serviceRole", "worker"]);
        // Do not claim a job which would be guaranteed to fail closed. The
        // document remains queued until an operator supplies a real AV/content
        // scanner rather than silently weakening production verification.
        if (!config.scannerUrl)
          return Response.json(
            { status: "blocked", reason: "DOCUMENT_SCAN_URL is not configured" },
            { status: 503 },
          );
        const { getServiceRoleClient } = await import("@/integrations/supabase/service-role.server");
        const supabase = getServiceRoleClient("extraction_worker");
        const workerId = `vercel-cron-${crypto.randomUUID()}`;
        const job = await claimNextQueuedJob(supabase, workerId, 55);
        if (!job) return Response.json({ status: "idle" });
        const result = await executeQueuedExtractionJob({ jobId: job.id, workerId });
        const outcome = result.status === "completed" ? "completed" : "failed";
        const { data: finalStatus, error: finishError } = await (supabase.rpc as any)(
          "finish_extraction_job",
          {
            p_job_id: job.id,
            p_worker_id: workerId,
            p_outcome: outcome,
            p_result: "result" in result ? result.result ?? null : null,
            p_error: "error" in result ? result.error ?? null : null,
            p_message: "message" in result ? result.message ?? null : null,
          } as never,
        );
        if (finishError) throw new Error("Unable to safely finish the claimed extraction job.");
        return Response.json({ status: finalStatus });
      },
    },
  },
});
