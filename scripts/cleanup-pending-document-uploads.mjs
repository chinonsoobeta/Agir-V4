#!/usr/bin/env node
// Safe garbage collection for staged uploads. Run from a trusted scheduled
// environment with only the service-role key. Pending garbage and explicit
// finalized-document deletion requests are claimed through separate bounded
// database queues.
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const reportOnly = process.argv.includes("--report-only");
const deletionWorkerEnabled = process.env.DOCUMENT_DELETION_WORKER_ENABLED === "1";
if (!url || !key) {
  console.error("[upload-cleanup] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const claim = reportOnly
  ? await supabase
      .from("pending_document_uploads")
      .select("id, object_path")
      .in("status", ["rejected", "duplicate", "failed", "expired", "cleanup_pending"])
      .limit(100)
  : await supabase.rpc("claim_document_upload_cleanup", { p_limit: 100 });
const uploads = claim.data;
if (claim.error)
  throw new Error(
    `Unable to ${reportOnly ? "report" : "claim"} safe pending-upload cleanup: ${claim.error.message}`,
  );

let removed = 0;
let failed = 0;
let deferred = 0;
for (const upload of uploads ?? []) {
  const uploadId = upload.upload_id ?? upload.id;
  if (reportOnly) {
    deferred++;
    continue;
  }
  const deletion = await supabase.storage.from("documents").remove([upload.object_path]);
  if (deletion.error) {
    console.error(
      `[upload-cleanup] storage deletion failed for pending upload ${uploadId}: ${deletion.error.message}`,
    );
    failed++;
    continue;
  }
  const completed = await supabase.rpc("complete_document_upload_cleanup", {
    p_upload_id: uploadId,
  });
  if (completed.error || completed.data !== true) {
    console.error(
      `[upload-cleanup] database completion failed for pending upload ${uploadId}: ${completed.error?.message ?? "row was not claimable"}`,
    );
    failed++;
    continue;
  }
  removed++;
}
const deletionClaim =
  !reportOnly && !deletionWorkerEnabled
    ? { data: [], error: null }
    : reportOnly
      ? await supabase
          .from("document_deletion_requests")
          .select("id, document_id, storage_path")
          .in("status", ["pending", "retryable", "terminal_failed"])
          .limit(100)
      : await supabase.rpc("claim_document_deletions", { p_limit: 100 });
if (deletionClaim.error)
  throw new Error(`Unable to claim document deletions: ${deletionClaim.error.message}`);
let documentDeletions = 0;
for (const request of deletionClaim.data ?? []) {
  const requestId = request.request_id ?? request.id;
  if (reportOnly) {
    deferred++;
    continue;
  }
  const storageDeletion = await supabase.storage.from("documents").remove([request.storage_path]);
  if (storageDeletion.error) {
    const transition = await supabase.rpc("fail_document_deletion", {
      p_request_id: requestId,
      p_error: storageDeletion.error.message,
    });
    if (transition.error || transition.data !== true) {
      console.error(
        `[upload-cleanup] failed to record document deletion failure ${requestId}: ${transition.error?.message ?? "request was not claimed"}`,
      );
    }
    console.error(
      `[upload-cleanup] storage deletion failed for document request ${requestId}: ${storageDeletion.error.message}`,
    );
    failed++;
    continue;
  }
  const completion = await supabase.rpc("complete_document_deletion", {
    p_request_id: requestId,
  });
  if (completion.error || completion.data !== true) {
    console.error(
      `[upload-cleanup] metadata deletion failed for document request ${requestId}: ${completion.error?.message ?? "request was not claimable"}`,
    );
    failed++;
    continue;
  }
  documentDeletions++;
}
console.log(
  JSON.stringify({
    component: "upload-cleanup",
    status: failed ? "partial" : "ok",
    mode: reportOnly ? "report-only" : "cleanup",
    inspected: uploads?.length ?? 0,
    removed,
    document_deletions: documentDeletions,
    document_deletion_worker: deletionWorkerEnabled ? "enabled" : "paused",
    failed,
    deferred,
    bounded: true,
  }),
);
if (failed) process.exitCode = 1;
