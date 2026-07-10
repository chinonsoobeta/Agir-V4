# Canonical production document lifecycle

Production and staging have exactly one document lifecycle:

```text
authorize upload → signed pending object → server finalize/verify/hash/scan
→ durable extraction job → worker extraction → analyst approval → deterministic run
```

The browser may upload only to the signed path created by
`prepare_document_upload`. Finalization verifies the pending owner/path, actual
size, stored MIME when available, structural signature, external AV verdict,
and a server-computed SHA-256. The finalization RPC atomically creates the
usable document or records a duplicate keyed by that server hash. Rejected,
duplicate, and expired objects are removed; `ops:cleanup` is bounded to 100
expired pending objects and never enumerates finalized paths.

`AGIR_ENV=production` and `staging` force asynchronous extraction. The request
handler records/attaches to the idempotent job and returns; only the extraction
worker performs OCR, parsing, and AI work. Queue claims use `FOR UPDATE SKIP
LOCKED`, leases, heartbeats, cancellation checks, retry attempts, and
dead-lettering. A lost worker lease is never overwritten by a stale worker.

An external scanner is mandatory in staging/production. Structural checks stay
enabled as defense in depth. Missing scanner configuration, malformed scanner
responses, non-2xx results, timeouts, and network errors all reject the file.
`DOCUMENT_SCAN_FAIL_OPEN=1` is accepted only in `development`, `demo`, or
`test` and must not be used for customer data.

The legacy direct registration and inline extraction compatibility bridge is
only for explicitly local/demo/test schema fixtures. It is not a deployment
fallback: strict production/staging configuration throws when the required
schema or queue is missing.

## Ownership and scheduling

- Worker owner: platform operations; continuous worker process or an external
  scheduler invoking `npm run worker:extraction -- --once` at least every minute.
- Pending cleanup: every 15 minutes via `npm run ops:cleanup`.
- Audit-chain/queue diagnostics: daily via `npm run ops:recover` with a page on
  non-zero exit or any `blocked`/`failed` structured event.
- Dead letters: alert on rows with `status=dead_lettered`; investigate with
  `ops:recover`, then use the existing explicit retry UI after remediation.

All task invocations are idempotent and bounded. Do not run cleanup with a
browser key, and do not grant the worker a general application service role.
