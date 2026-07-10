# Canonical lifecycle and operations hardening - 2026-07-09

## Findings and remediation

| ID    | Severity | Affected area        | Threat/failure mode                                                                                                               | Fix                                                                                                                                   |
| ----- | -------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| CL-01 | High     | Extraction lifecycle | Production could leave `EXTRACTION_ASYNC` unset and execute OCR/AI inside an HTTP request.                                        | Typed config now forces queue mode in staging/production and fails when the durable queue schema is absent.                           |
| CL-02 | High     | AV configuration     | Production validation only warned when no external scanner was configured, allowing structural-only acceptance.                   | Production/staging require `DOCUMENT_SCAN_URL`; scanner absence/outage/malformed response fails closed.                               |
| CL-03 | High     | Extraction worker    | HTTP worker did not send `x-worker-token`; long work did not heartbeat, and a stale worker could finalize after losing its lease. | Worker sends the token, heartbeats during work, rechecks cancellation, and conditions final updates on its lease owner.               |
| CL-04 | Medium   | Operations           | Operators had many overlapping scripts and missing local infrastructure could be mistaken for a partial success.                  | Added structured `ops:check`, `ops:release`, `ops:cleanup`, and `ops:recover`; mandatory unavailable proof is `blocked` and non-zero. |

## Impact, migration, rollback

No deterministic underwriting formulas or existing RLS policies changed. This
change has no database migration. Deploy application code with the existing
upload/queue migrations applied, then set the production scanner, worker token,
worker database/handler settings, and observability sink before setting
`AGIR_ENV=staging|production`. Roll back application code before relaxing any
schema policy; do not re-enable direct document insertion as a routine rollback.

## Verification evidence

Configuration and worker behavior have unit/static coverage and are included in
the CI release gate. Live RLS/browser/worker verification remains explicitly
blocked until a Docker-backed Supabase environment and browser dependencies are
available; `ops:release` is the non-skipping CI/local path.
