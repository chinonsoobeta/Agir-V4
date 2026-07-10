import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("asynchronous document verification contract", () => {
  it("keeps request finalization metadata-only and queues a pending-upload-bound job", async () => {
    const source = await readFile("src/lib/documents.functions.ts", "utf8");
    const finalizer = source.slice(source.indexOf("export const finalizeDocumentUpload"));
    expect(finalizer).toContain("enqueue_document_verification");
    expect(finalizer).not.toContain("downloadDocumentBlob");
    expect(finalizer).not.toContain("scanDocument(");
    expect(finalizer).not.toContain("sha256Hex(");
  });

  it("binds verification to one pending upload and live worker lease in the migration", async () => {
    const migration = await readFile(
      "supabase/migrations/20260710000100_async_document_verification.sql",
      "utf8",
    );
    expect(migration).toContain("uq_extraction_jobs_pending_upload_verification");
    expect(migration).toContain("complete_document_verification");
    expect(migration).toContain("lease_owner <> p_worker_id");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("claim_document_upload_cleanup");
  });

  it("sends only identifiers from the worker to the protected handler", async () => {
    const worker = await readFile("scripts/extraction-worker.mjs", "utf8");
    expect(worker).toContain("job_id: job.id");
    expect(worker).toContain("worker_id: workerId");
    expect(worker).not.toContain("JSON.stringify({ job })");
  });
});
