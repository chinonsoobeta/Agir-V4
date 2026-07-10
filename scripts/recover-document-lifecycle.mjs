#!/usr/bin/env node
// Non-destructive document lifecycle diagnostics. This intentionally reports
// identifiers only for dead-letter investigation and never lists final paths.
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

const supabase = createClient(url, key, { auth: { persistSession: false } });
const statuses = [
  "pending",
  "verification_queued",
  "verification_running",
  "finalized",
  "duplicate",
  "rejected",
  "failed",
  "expired",
  "cleanup_pending",
];
const byStatus = {};
for (const status of statuses) {
  const result = await supabase
    .from("pending_document_uploads")
    .select("id", { count: "exact", head: true })
    .eq("status", status);
  if (result.error) throw new Error(`Unable to count pending uploads: ${result.error.message}`);
  byStatus[status] = result.count ?? 0;
}
const oldest = await supabase
  .from("pending_document_uploads")
  .select("created_at")
  .in("status", ["pending", "verification_queued", "verification_running"])
  .order("created_at", { ascending: true })
  .limit(1)
  .maybeSingle();
if (oldest.error) throw new Error(`Unable to inspect pending upload age: ${oldest.error.message}`);

const queue = await supabase
  .from("extraction_jobs")
  .select("id, status, kind, lease_expires_at")
  .eq("kind", "document_verification")
  .in("status", ["queued", "running", "dead_lettered"])
  .order("created_at", { ascending: true })
  .limit(100);
if (queue.error) throw new Error(`Unable to inspect verification queue: ${queue.error.message}`);
const now = Date.now();
const rows = queue.data ?? [];
const deadLetters = rows.filter((row) => row.status === "dead_lettered").map((row) => row.id);
const expiredLeases = rows
  .filter(
    (row) =>
      row.status === "running" &&
      row.lease_expires_at &&
      new Date(row.lease_expires_at).getTime() < now,
  )
  .map((row) => row.id);

console.log(
  JSON.stringify({
    component: "document-lifecycle-recovery",
    status: "ok",
    pending_uploads: byStatus,
    oldest_active_upload_created_at: oldest.data?.created_at ?? null,
    verification_backlog: rows.filter((row) => row.status === "queued").length,
    lease_expiry_recovery_candidates: expiredLeases,
    dead_letter_ids: deadLetters,
    // Terminal, unreferenced rows are safe cleanup candidates; this report
    // never deletes them and never enumerates finalized document objects.
    orphan_candidate_count:
      (byStatus.rejected ?? 0) +
      (byStatus.duplicate ?? 0) +
      (byStatus.failed ?? 0) +
      (byStatus.expired ?? 0) +
      (byStatus.cleanup_pending ?? 0),
  }),
);
