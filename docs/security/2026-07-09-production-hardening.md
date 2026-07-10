# Production-hardening phase - 2026-07-09

## Scope

This phase hardens document ingestion and deployment confidence without
changing Agir's deterministic underwriting engine, approved-input boundary, or
numeric provenance verifier.

## Findings, design, and remediation

| ID    | Severity | Threat / failure mode                                                                                                             | Design and fix                                                                                                                                                                                                     | Migration impact                                                                                   | Verification evidence                                                                                                                                                    |
| ----- | -------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PH-01 | High     | A read-then-insert rate limiter permits parallel requests to oversubscribe a bucket.                                              | `consume_rate_limit` serializes each user/bucket decision with a transaction advisory lock, sums the active window, and records consumption atomically. Production/staging fail closed if unavailable.             | Adds an RPC; existing bucket names and workspace metadata remain.                                  | Unit test verifies RPC-only consumption; RLS integration test includes a concurrent reservation race (requires local DB).                                                |
| PH-02 | High     | Upload count/byte quota was read-then-write, permitting concurrent uploads to pass together.                                      | `prepare_document_upload` locks per user and atomically checks documents plus live reservations, consumes the upload token, verifies workspace write access, and creates one 15-minute reservation.                | Adds `pending_document_uploads` and owner/status/expiry indexes.                                   | Unit suite passes; integration test races two sessions from 199 documents and expects exactly one reservation.                                                           |
| PH-03 | High     | Direct browser uploads and metadata registration permitted client-chosen paths and client-declared hashes/sizes to become usable. | Browser gets a signed URL only for a DB-bound pending path. Server re-downloads, verifies owner/path/actual size/MIME where available, scans, hashes, then creates a usable row.                                   | Authenticated `INSERT` on `documents` is removed; Storage INSERT requires a matching pending path. | Typecheck/lint/unit pass. RLS test denies arbitrary storage/document insertion; Playwright upload test asserts clean scan + server hash/path (both need local Supabase). |
| PH-04 | Medium   | Abandoned, rejected, and duplicate objects can accumulate; client hashes are not authoritative.                                   | Server SHA-256 drives transactional deduplication. Rejected and duplicate objects are removed; `uploads:cleanup` removes expired pending objects without touching finalized paths.                                 | Adds scheduled cleanup script.                                                                     | Static controls reviewed; live cleanup is environment-limited in this checkout.                                                                                          |
| PH-05 | High     | A browser-accessible finalization RPC would permit fabricated scan/hash results.                                                  | Finalization/rejection RPCs are `service_role` only through `document_upload_finalization`, after server verification.                                                                                             | No data rewrite; apply migration before deploy.                                                    | Typecheck/lint/service-role audit pass; RLS regression expects authenticated finalization denial.                                                                        |
| PH-06 | Medium   | RLS and browser checks could be treated as optional infrastructure checks.                                                        | `confidence:full` is strict: it requires URL/anon/service/database values, then runs migration, type/drift, RLS/concurrency, audit-chain, and Playwright checks. CI provisions a fresh Supabase stack and runs it. | No data change. Requires Docker/Supabase CLI/Chromium in CI.                                       | It fails clearly locally because Docker is unavailable; CI is the execution environment.                                                                                 |

## Rollback plan

Deploy the preceding application version before any schema rollback. To roll
back the schema only after that code rollback, restore the prior `documents`
and `storage.objects` insert policies from migration
`20260610160830_21c96970-2374-4b64-a278-b227b01b5567.sql`, then drop the new
functions/table/indexes in a reviewed maintenance window. This intentionally
restores weaker direct uploads and must never be routine.

## Operations

- Schedule `npm run uploads:cleanup` every 15 minutes with `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY`; alert on non-zero exit.
- Keep `DOCUMENT_SCAN_FAIL_OPEN` unset. It is ignored in staging/production
  and exists only for demo/test fixtures.
- Run `npm run confidence:full` after `supabase start` for an explicit local
  full-environment gate. It never silently skips DB/browser proof.
