#!/usr/bin/env node
// Safe garbage collection for staged uploads. Run from a trusted scheduled
// environment with only the service-role key; it never enumerates or deletes
// finalized document paths.
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const reportOnly = process.argv.includes("--report-only");
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
  if (reportOnly) {
    deferred++;
    continue;
  }
  const deletion = await supabase.storage.from("documents").remove([upload.object_path]);
  if (deletion.error) {
    console.error(
      `[upload-cleanup] storage deletion failed for pending upload ${upload.id}: ${deletion.error.message}`,
    );
    failed++;
    continue;
  }
  removed++;
}
console.log(
  JSON.stringify({
    component: "upload-cleanup",
    status: failed ? "partial" : "ok",
    mode: reportOnly ? "report-only" : "cleanup",
    inspected: uploads?.length ?? 0,
    removed,
    failed,
    deferred,
    bounded: true,
  }),
);
if (failed) process.exitCode = 1;
