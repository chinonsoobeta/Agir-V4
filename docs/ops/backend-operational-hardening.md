# Backend Operational Hardening

This runbook covers the backend controls added for system-of-record readiness.

## Deploy Gate

Run `npm run deploy:gate` before release. In environments with database
secrets, the gate blocks on schema drift and migration dry-run failures. In
environments without database secrets, those live checks are skipped and the
static gates still run.

Required live checks:

- `npm run drift:check`
- `npm run migrate:dry-run`
- `npm run schema:refresh-cache`
- `npm run smoke:ephemeral-db` when `EPHEMERAL_DATABASE_URL` is present

## Pilot Confidence Gate

Run `npm run ops:release` against a disposable Supabase environment before a
customer demo or pilot sandbox handoff. It executes migrations, schema and type
drift, unit and browser tests, accessibility checks, live RLS, scans, build, and
audit-chain verification without a skip path. `npm run pilot:gate -- --quick`
is a developer preflight only. The default pilot gate exits nonzero when a
required database or browser check is skipped.

## Queue Worker

Run `npm run worker:extraction` with:

- `WORKER_DATABASE_URL` or `SUPABASE_SERVICE_DATABASE_URL`
- `EXTRACTION_WORKER_HANDLER_URL`
- Optional `EXTRACTION_WORKER_LEASE_SECONDS`

Workers claim jobs through `public.claim_next_extraction_job`, heartbeat through
`public.heartbeat_extraction_job`, and respect `cancellation_requested`.
Expired leases are reclaimable; exhausted jobs are marked `dead_lettered`.

## Rate Limits

`src/lib/rate-limit.server.ts` defines the backend policy. It records events in
`public.rate_limit_events` for document uploads, document analysis, underwriting
runs, report generation, and signed document URLs.

## Audit Chain Verification

Run `npm run audit:verify-chains` on a schedule with
`AUDIT_CHAIN_DATABASE_URL`. Results are written to
`public.audit_chain_verifications`; any invalid chain exits nonzero.

## Data Governance Enforcement

Run `npm run governance:dry-run` for evidence-only checks, and
`npm run governance:enforce` for a failing operational gate. Results are written
to `public.compliance_enforcement_runs`.

The current enforcement checks:

- Audit-log retention per workspace policy
- Overdue deletion requests

## Observability

Server errors emit `[agir-error]` JSON lines. Operational metrics emit
`[agir-metric]` JSON lines and optionally POST to `METRICS_WEBHOOK_URL` or
`ERROR_WEBHOOK_URL`.
