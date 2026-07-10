# Agir code audit - 2026-07-09

## Scope and method

Reviewed the tracked application, server, engine, migration, route, script, and
test surfaces (460 source/script/migration artifacts). The audit focused on
deterministic underwriting boundaries, input/provenance handling, authorization
and service-role use, document ingestion, operational controls, and deployment
configuration. Static checks and the complete automated test suite were used to
validate each finding and remediation.

## Findings and remediation

| ID                 | Severity | Finding                                                                                                                                                                                                                                                                                                                               | Resolution                                                                                                                             |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A-01               | High     | `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` were accepted by environment validation but were not consistently accepted by Vite's browser bridge, authenticated server functions, the chat route, service-role client, or run-history writer. A documented VITE-only setup could pass a readiness check and then fail at runtime. | Normalized all supported Supabase URL/key aliases across these entry points and added a missing-configuration guard in the chat route. |
| A-02               | Medium   | Vitest loaded the production TanStack Start/Nitro plugins, leaving a server lifecycle alive after tests completed. The suite reported a shutdown timeout despite passing assertions.                                                                                                                                                  | The shared Vite config now excludes production-only plugins in test mode. The full suite exits cleanly.                                |
| A-03               | High     | The upload quota returned successfully when its database read failed, bypassing per-user file-count and byte limits during a transient database/RLS failure.                                                                                                                                                                          | The quota boundary now fails closed with a retryable error. A regression test covers the failure path.                                 |
| A-04               | Medium   | Duplicate document registrations consumed rate-limit and quota capacity before deduplication was checked; the direct-to-storage duplicate object was left orphaned.                                                                                                                                                                   | Deduplication now happens before resource consumption, and the UI removes the just-uploaded duplicate object.                          |
| A-05               | High     | `createDocument` accepted any metadata storage path. Storage RLS still constrained normal browser uploads, but a hand-crafted server-function request could register an unsafe path for later privileged recovery.                                                                                                                    | The server now requires a path in the authenticated user's folder and rejects traversal/backslash paths.                               |
| A-06 / PH-01–PH-06 | High     | The first audit's follow-up candidates (non-atomic resource controls, direct upload, and optional full-environment gates) were confirmed as production control gaps.                                                                                                                                                                  | Remediated in the staged-upload/atomic-controls phase; see [production-hardening log](2026-07-09-production-hardening.md).             |

## Verification evidence

- `npm run typecheck` - pass
- `npm run lint` - pass, zero warnings
- `npm run test` - 77 files / 652 tests pass; clean process shutdown
- `npm run build` - pass
- `npm run bundle:audit` - pass
- `npm run backend:audit` - pass
- `npm run audit:migrations` - 32 migrations pass destructive-operation review
- `npm run audit:server-auth` - pass

## Environment-limited checks

`npm run env:validate` correctly fails in this local checkout because no
Supabase URL or browser key is configured. Live RLS, migration, worker, and
browser E2E checks require a provisioned disposable/local Supabase database and
were not run against any external environment during this audit.

## Follow-up hardening candidates

These are product/infrastructure improvements, not unresolved defects in the
audited change set: use server-issued signed upload URLs with object metadata
verification, make rate-limit consumption atomic in Postgres, and run the RLS
and browser suites against an ephemeral database on every protected branch.
