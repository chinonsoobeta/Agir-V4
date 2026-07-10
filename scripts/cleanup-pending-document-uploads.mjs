#!/usr/bin/env node
// Safe garbage collection for staged uploads. Run from a trusted scheduled
// environment with only the service-role key; it never enumerates or deletes
// finalized document paths.
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("[upload-cleanup] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const { data: uploads, error } = await supabase
  .from("pending_document_uploads")
  .select("id, object_path")
  .eq("status", "pending")
  .lt("expires_at", new Date().toISOString())
  .limit(100);
if (error) throw new Error(`Unable to list expired pending uploads: ${error.message}`);

let removed = 0;
for (const upload of uploads ?? []) {
  const deletion = await supabase.storage.from("documents").remove([upload.object_path]);
  if (deletion.error) {
    console.error(
      `[upload-cleanup] storage deletion failed for pending upload ${upload.id}: ${deletion.error.message}`,
    );
    continue;
  }
  const update = await supabase
    .from("pending_document_uploads")
    .update({ status: "expired", failure_reason: "Upload authorization expired; object removed" })
    .eq("id", upload.id)
    .eq("status", "pending");
  if (update.error)
    throw new Error(`Unable to mark pending upload expired: ${update.error.message}`);
  removed++;
}
console.log(`[upload-cleanup] removed ${removed} expired pending upload object(s).`);
