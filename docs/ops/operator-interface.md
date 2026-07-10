# Operator interface

`ops:*` is the stable operator-facing surface. Existing granular commands stay
available for debugging and CI.

| Command               | Purpose                                                                                                                                     | Requirements                                                                                                       | Exit behavior                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `npm run ops:check`   | Fast static/operational gate: env validation, migration/auth/service-role/backend audits, lint, typecheck, unit tests, build, bundle audit. | Node + dependencies; Supabase config for env validation.                                                           | JSON records each check as passed, failed, or blocked. Any failed/blocked mandatory proof is non-zero.            |
| `npm run ops:release` | Release gate: migrations, type/drift proof, RLS/concurrency, audit chains, worker contract, Playwright.                                     | Fresh or explicitly supplied Supabase URL/anon/service/database values, Docker/Supabase CLI/browser as applicable. | Never skips a mandatory infrastructure proof. Missing prerequisites are `blocked` and non-zero.                   |
| `npm run ops:cleanup` | Bounded cleanup of expired pending upload objects.                                                                                          | Server URL + service role.                                                                                         | Idempotent; reports inspected/removed/failed as JSON. Never touches finalized/referenced paths.                   |
| `npm run ops:recover` | Read-only migration/worker/audit/pending-upload diagnostics.                                                                                | DB URL for audit check; server URL + service role for pending report.                                              | Missing diagnostics are `blocked`, never pass. `--confirm-remediation` currently refuses destructive remediation. |

Expected durations: check is typically minutes; release depends on migrations,
Docker, and browser installation (typically 10–25 minutes); cleanup/recover
are bounded and normally finish in seconds. Alert on non-zero exit and retain
the structured JSON log records.
