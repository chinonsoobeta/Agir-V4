# Async document extraction (worker mode)

In production and staging, document analysis (`analyzeDocument`) always queues
the whole pipeline: storage download, AV scan, OCR/text extraction, and AI
summarization outside the HTTP request. A slow OCR or model call must never
pin a production request. Development/demo/test can explicitly set
`EXTRACTION_ASYNC=1` to exercise the same queue; their inline path exists only
for local fixtures and is never a production fallback.

Worker mode moves execution off the request path using infrastructure that is
already in the schema: the `extraction_jobs` queue (leases, heartbeats,
retries with dead-lettering, cancellation) and `scripts/extraction-worker.mjs`.

## How it fits together

```
analyzeDocument (server fn)          worker process                the app
  rate-limit + idempotent claim  ->  claim_next_extraction_job -> POST /api/extraction/worker
  insert job status=queued           (lease + heartbeat, pg)       runs extraction-executor
  doc extraction_status=queued       finishes the job row          updates the documents row
  returns { queued: true }                                          (scan, OCR, AI, status)
```

- The **same pipeline code** (`src/lib/extraction-executor.server.ts`) runs in
  both modes, so results are identical; only _where_ it executes changes.
- Idempotency is unchanged: one job per (owner, content hash); a re-click
  re-attaches to the existing job.
- The UI needs no polling changes: every pipeline step persists to the
  `documents` row (`extraction_status`: queued -> running -> completed/failed)
  and realtime refresh picks the transitions up; the Documents page shows
  "queued" / "extracting…" badges.
- On a database without the `extraction_jobs` table, production/staging fail
  closed. Only explicitly local/demo/test compatibility can run inline.

## Enabling it

1. Generate a shared secret and set it on **both** sides:
   ```
   EXTRACTION_WORKER_TOKEN=<long random string>   # app AND worker env
   ```
   The `/api/extraction/worker` endpoint returns 404 until this is set, and
   401 for a wrong token (constant-time comparison).
2. Turn on queueing in the app environment:
   ```
   EXTRACTION_ASYNC=1
   ```
3. Run the worker somewhere long-lived (a VM, container sidecar, or a dev
   laptop for local testing):
   ```
   WORKER_DATABASE_URL=postgres://...        # direct Postgres URL (job claims)
   EXTRACTION_WORKER_TOKEN=<same secret>
   EXTRACTION_WORKER_APP_ORIGIN=https://<deployed-app>   # default http://127.0.0.1:8081
   npm run worker:extraction
   ```
   The worker claims jobs straight from Postgres (`claim_next_extraction_job`,
   `FOR UPDATE SKIP LOCKED`), heartbeats its lease, POSTs each job to the app
   endpoint for execution, and finalizes the job row from the response.
   `--once` processes a single tick (useful for cron-style execution);
   `--dry-run` prints the contract without connecting.

## Failure behavior

- Worker crash mid-job: the lease expires (default 300s) and the next claim
  re-runs the job, up to `max_attempts` (3), after which it is dead-lettered.
- App endpoint unreachable: the job is marked failed with the HTTP status;
  retry by re-clicking "Run AI analysis" (idempotent claim) after the app is
  back.
- AI provider hang: each platform-provider attempt is bounded by a 120s
  timeout. When a second configured provider is allowed, the shared gateway
  tries it before completing with a clearly audited deterministic text excerpt,
  so a provider outage cannot discard successful document parsing or pin the
  worker indefinitely.
- `EXTRACTION_ASYNC=1` with no worker running: jobs sit visibly "queued" -
  the badge makes the misconfiguration observable. Production deployment gates
  require the token and worker contract; alert on queue age and dead letters.
