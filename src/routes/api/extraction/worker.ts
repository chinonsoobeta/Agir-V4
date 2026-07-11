import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { getServerConfig } from "@/lib/config.server";

// This endpoint is deliberately disarmed without a configured token. Posted
// values are identifiers only; the authoritative job, lease, pending upload,
// storage path, and expected metadata are re-read from the database.
function tokenMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function redactedVerificationReason(reason: string): string {
  if (/size/i.test(reason)) return "Uploaded object size did not match the authorized size";
  if (/mime|type/i.test(reason)) return "Uploaded object type did not match the authorized type";
  if (/scan|infect|malformed|timeout|network|scanner/i.test(reason))
    return "Document verification scanner rejected the object";
  return "Document verification failed closed";
}

// The protected endpoint never returns implementation errors, scanner output,
// paths, or object metadata. A stable class is enough for the durable worker
// record and lets operators distinguish retryable infrastructure failures from
// bad uploads without disclosing sensitive details.
function verificationFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/lease|cancell/i.test(message)) return "lease_lost";
  if (/download/i.test(message)) return "object_download_failed";
  if (/size/i.test(message)) return "object_size_mismatch";
  if (/mime/i.test(message)) return "object_mime_mismatch";
  if (/scanner|scan/i.test(message)) return "scanner_rejected_or_unavailable";
  if (/finalization/i.test(message)) return "atomic_finalization_failed";
  if (/reject/i.test(message)) return "atomic_rejection_failed";
  return "verification_failed_closed";
}

async function stillOwnsLiveLease(supabase: any, jobId: string, workerId: string) {
  const { data } = await supabase
    .from("extraction_jobs")
    .select("status, lease_owner, lease_expires_at, cancellation_requested")
    .eq("id", jobId)
    .maybeSingle();
  return Boolean(
    data &&
    data.status === "running" &&
    data.lease_owner === workerId &&
    !data.cancellation_requested &&
    data.lease_expires_at &&
    new Date(data.lease_expires_at).getTime() > Date.now(),
  );
}

async function executeDocumentVerification(args: { jobId: string; workerId: string }) {
  const { getServiceRoleClient } = await import("@/integrations/supabase/service-role.server");
  const supabase = getServiceRoleClient("document_ingestion_worker");
  const { data: job, error: jobError } = await supabase
    .from("extraction_jobs")
    .select(
      "id, owner_id, kind, pending_upload_id, status, lease_owner, lease_expires_at, cancellation_requested",
    )
    .eq("id", args.jobId)
    .maybeSingle();
  if (jobError || !job || job.kind !== "document_verification" || job.pending_upload_id == null)
    throw new Error("Verification job is unavailable.");
  if (!(await stillOwnsLiveLease(supabase, args.jobId, args.workerId)))
    throw new Error("Verification worker no longer holds the job lease.");

  const { data: upload, error: uploadError } = await supabase
    .from("pending_document_uploads")
    .select("id, owner_id, object_path, file_name, expected_size_bytes, status, expires_at")
    .eq("id", job.pending_upload_id)
    .eq("owner_id", job.owner_id)
    .maybeSingle();
  if (uploadError || !upload) throw new Error("Pending upload is unavailable.");
  if (
    !upload.object_path.startsWith(`${upload.owner_id}/pending/${upload.id}/`) ||
    !["verification_queued", "verification_running"].includes(upload.status) ||
    new Date(upload.expires_at).getTime() <= Date.now()
  ) {
    throw new Error("Pending upload is not eligible for verification.");
  }
  await supabase
    .from("pending_document_uploads")
    .update({ status: "verification_running" })
    .eq("id", upload.id)
    .in("status", ["verification_queued", "verification_running"]);

  let rejection: string | null = null;
  try {
    const { downloadDocumentBlob } = await import("@/lib/storage-download.server");
    const downloaded = await downloadDocumentBlob(supabase, upload.object_path);
    if (downloaded.error || !downloaded.data)
      throw new Error("Uploaded object could not be downloaded");
    const blob = downloaded.data;
    if (blob.size !== upload.expected_size_bytes) throw new Error("Object size mismatch");
    const { isCompatibleVerifiedMime, scanDocument } = await import("@/lib/upload-guards.server");
    if (!isCompatibleVerifiedMime(upload.file_name, blob.type))
      throw new Error("Object MIME mismatch");
    const buffer = await blob.arrayBuffer();
    if (!(await stillOwnsLiveLease(supabase, args.jobId, args.workerId)))
      throw new Error("Verification worker lost its lease before scan");
    const scan = await scanDocument(upload.file_name, buffer);
    if (!scan.ok) throw new Error(`Scanner rejected object: ${scan.detail}`);
    if (!(await stillOwnsLiveLease(supabase, args.jobId, args.workerId)))
      throw new Error("Verification worker lost its lease after scan");
    const { sha256Hex } = await import("@/lib/hash.server");
    const finalized = await supabase.rpc("complete_document_verification", {
      p_job_id: args.jobId,
      p_worker_id: args.workerId,
      p_content_hash: await sha256Hex(buffer),
      p_actual_size_bytes: blob.size,
      p_verified_content_type: blob.type || null,
      p_scan_detail: `[${scan.engine}] clean`,
    } as never);
    if (finalized.error) throw new Error("Atomic document finalization failed");
    const result = finalized.data?.[0];
    if (!result?.document_id) throw new Error("Atomic document finalization returned no document");
    if (result.deduped) await supabase.storage.from("documents").remove([upload.object_path]);
    const { emitOperationalMetric } = await import("@/lib/observability.server");
    emitOperationalMetric("document.verification.completed", 1, {
      outcome: result.deduped ? "duplicate" : "finalized",
    });
    return {
      status: "completed",
      message: result.deduped
        ? "Document verification found duplicate content."
        : "Document verified and queued for extraction.",
      result: { document_id: result.document_id, deduped: result.deduped },
    };
  } catch (error) {
    rejection = redactedVerificationReason(
      error instanceof Error ? error.message : "unknown verification error",
    );
  }
  const rejected = await supabase.rpc("reject_document_verification", {
    p_job_id: args.jobId,
    p_worker_id: args.workerId,
    p_reason: rejection,
  } as never);
  if (rejected.error || !rejected.data)
    throw new Error("Verification failed and could not be safely rejected.");
  await supabase.storage.from("documents").remove([upload.object_path]);
  const { emitOperationalMetric } = await import("@/lib/observability.server");
  emitOperationalMetric("document.verification.rejected", 1, { reason: rejection });
  return {
    status: "completed",
    message: "Document verification rejected the object.",
    result: { rejected: true },
  };
}

export const Route = createFileRoute("/api/extraction/worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const config = getServerConfig();
        if (!config.workerToken) return new Response("Not found", { status: 404 });
        if (!tokenMatches(request.headers.get("x-worker-token"), config.workerToken))
          return new Response("Unauthorized", { status: 401 });
        let jobId: string | undefined;
        let workerId: string | undefined;
        try {
          const body = (await request.json()) as { job_id?: string; worker_id?: string };
          jobId = body.job_id;
          workerId = body.worker_id;
        } catch {
          /* response below */
        }
        if (!jobId || !workerId)
          return Response.json(
            { status: "failed", error: "Request body must name job_id and worker_id." },
            { status: 400 },
          );

        const { getServiceRoleClient } =
          await import("@/integrations/supabase/service-role.server");
        const supabase = getServiceRoleClient("extraction_worker");
        const { data: job, error } = await supabase
          .from("extraction_jobs")
          .select("kind, status, lease_owner")
          .eq("id", jobId)
          .maybeSingle();
        if (error || !job || job.status !== "running" || job.lease_owner !== workerId)
          return Response.json({ status: "failed", error: "Job is not owned by this worker." });
        if (job.kind === "document_verification") {
          try {
            return Response.json(await executeDocumentVerification({ jobId, workerId }));
          } catch (error) {
            return Response.json({
              status: "failed",
              error: "Document verification could not complete safely.",
              code: verificationFailureCode(error),
            });
          }
        }
        if (job.kind !== "document_analysis")
          return Response.json({
            status: "failed",
            error: "Job kind is not executable by this handler.",
          });
        const { data: fullJob } = await supabase
          .from("extraction_jobs")
          .select("owner_id, document_id")
          .eq("id", jobId)
          .maybeSingle();
        if (!fullJob?.document_id)
          return Response.json({ status: "failed", error: "Document job is invalid." });
        const { data: doc } = await supabase
          .from("documents")
          .select("*")
          .eq("id", fullJob.document_id)
          .eq("owner_id", fullJob.owner_id)
          .maybeSingle();
        if (!doc) return Response.json({ status: "failed", error: "Document is unavailable." });
        const { executeDocumentAnalysis, ExtractionFailure } =
          await import("@/lib/extraction-executor.server");
        try {
          const result = await executeDocumentAnalysis({ supabase, userId: fullJob.owner_id }, doc);
          return Response.json({
            status: "completed",
            message: "Document analyzed by worker.",
            result,
          });
        } catch (err) {
          return Response.json({
            status: "failed",
            error:
              err instanceof ExtractionFailure || err instanceof Error
                ? err.message
                : "Document analysis failed.",
          });
        }
      },
    },
  },
});
