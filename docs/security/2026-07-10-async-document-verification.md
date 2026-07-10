# Async document verification hardening - 2026-07-10

## Finding

| ID | Severity | Affected area | Threat / failure mode | Impact | Design / fix |
| --- | --- | --- | --- | --- | --- |
| IDV-01 | High | Upload finalization request path | `finalizeDocumentUpload` downloaded up to 75 MB, buffered it, hashed it, structurally parsed it, and called external AV inline. | Request exhaustion/timeouts and an inconsistent production boundary where scanner work happened before durable ownership/lease control. | The handler now validates only authenticated owner/path/state facts and calls `enqueue_document_verification`. A one-to-one, pending-upload-bound durable job performs download, server SHA-256, structural scan, required external scan, and atomic finalization under a live lease. |
| IDV-02 | High | Verification completion / dedup | A stale worker or concurrent finalizer could otherwise write after lease loss or race duplicate creation. | Duplicate documents, inconsistent pending states, or a late worker overwriting a recovered job. | `complete_document_verification` locks job then pending row, requires lease owner and unexpired lease, serializes the owner/project/hash tuple with an advisory lock, and creates the document plus extraction job atomically. `reject_document_verification` is equivalently lease-bound. |
| IDV-03 | Medium | Scanner protocol and cleanup | A 2xx scanner response without a recognizable verdict was accepted; cleanup did not report verification queue state. | Scanner protocol regressions could authorize unknown content; operators lacked durable visibility. | Unknown scanner responses now fail closed. Bounded cleanup claims only unreferenced terminal pending objects. `ops:recover` reports upload state/age, queue backlog, expired leases, dead-letter IDs, orphan candidates, and separately runs audit-chain verification. |

## Migration impact

`20260710000100_async_document_verification.sql` extends pending-upload states,
adds `extraction_jobs.pending_upload_id`, adds the `document_verification` job
kind, and introduces narrowly granted RPCs. It does not rewrite existing
documents, extraction jobs, RLS policies, or underwriting formulas. Apply it
before deploying the application/worker that calls the new RPCs, then restart
the worker with `EXTRACTION_WORKER_TOKEN` and its reviewed queue credential.

## Rollback considerations

First roll back application and worker code to the prior release. Do not
restore direct document insertion or arbitrary storage insert policies. The
additive columns/indexes/RPCs can then remain inert or be removed only in a
reviewed maintenance window after draining `document_verification` jobs and
pending verification rows. A schema-only rollback that re-enables direct
browser registration is prohibited.

## Verification evidence

- `src/test/async-verification-lifecycle.test.ts` proves the finalization
  handler has no download, scan, or hash call and that the worker sends only
  identifiers.
- `src/test/safety-and-integrity.test.ts` verifies malformed scanner success
  responses fail closed, in addition to clean/infected/network scanner cases.
- Static type/lint/server-auth/service-role/migration audits pass locally.

## Blocked verification

Live fresh-Supabase RLS/concurrency/browser verification remains blocked in
this checkout because the local Supabase type generator cannot connect to a
local stack. The mandatory CI release tier provisions a fresh stack and must
run the staged-upload verification scenarios before release. This change adds
the required queue/schema contract but does not claim a local live pass.
