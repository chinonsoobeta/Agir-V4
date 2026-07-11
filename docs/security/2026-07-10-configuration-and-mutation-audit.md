# Configuration and mutation audit - 2026-07-10

## Findings

| ID | Severity | Affected area | Threat / failure mode | Impact | Fix |
| --- | --- | --- | --- | --- | --- |
| CMA-01 | Medium | Server runtime configuration | Server modules independently read aliases and secrets, making validation and redaction inconsistent. | A deployment could validate one name while a runtime uses another, or diagnostics could accidentally expose a value. | Expanded `config.server.ts` as the runtime boundary for AI, SCIM, OCR, extraction limits, scanner timeout, audit signing, observability, and service-role checks. Shared client/server modules retain only the bounded public extraction-limit read to avoid importing server-only code into browser bundles. |
| CMA-02 | High | Pending-upload authorization RPC | `prepare_document_upload` had an unqualified `expires_at` reference that was ambiguous with its `RETURNS TABLE` output on Postgres 17. | All staged upload authorization could fail at runtime. | Forward-only migration `20260710000200` replaces the RPC with qualified table columns; fresh-stack RLS proof exercises both the normal and concurrent paths. |
| CMA-03 | High | Verification enqueue mutation | The owner-checked enqueue RPC was `SECURITY INVOKER`, but browser roles intentionally lack `UPDATE` on pending rows. | Authorized finalization could never enqueue verification. | `20260710000300` changes only this auth.uid()-checked, search-path-pinned RPC to `SECURITY DEFINER`; direct browser row mutation remains denied and is asserted by live RLS tests. |
| CMA-04 | Medium | Demo fixture mutation | Hard-coded demo seeders used browser-scoped storage/document writes that the staged-upload policy correctly rejects. | Fresh browser proof could fail or encourage policy exceptions. | Seeders now use only the named `demo_seed` capability after authentication, writing repository-defined bytes and the caller’s owner ID/path. The service-role audit explicitly reviews this bridge. |
| CMA-05 | High | Append-only audit chain | On fresh Postgres 17 stacks, the historical implicit `text` → `bytea` cast for `digest` no longer resolves; `SECURITY DEFINER` functions also pin `search_path` away from Supabase's `extensions` schema. Audit-event insertions roll back instead of producing a chain row. | Verification rejection/finalization and any other audited mutation can fail closed, blocking lifecycle completion and leaving no durable evidence. | Forward-only migrations `20260710000400`/`00500` explicitly UTF-8 encode the canonical hash input and schema-qualify pgcrypto. They preserve the existing hash algorithm and stored-chain compatibility. |
| CMA-06 | Medium | Fresh release schema contract | The custom migration ledger was created opportunistically by `npm run migrate`, after a fresh reset's generated-type check could run. | A release could report generated types out of date solely because the gate itself created an undeclared table. | Migration `20260710000600` declares and locks down the ledger with RLS; deployment processes retain the only needed access. |

## Mutation review

Reviewed paths: staged upload/verification, queue claim/completion/failure,
underwriting run persistence, report generation, workspace membership/invites,
and governance requests. Existing auth middleware, role/RLS controls,
append-only audit triggers, dual-control controls, and deterministic engine
boundary were preserved. The idempotency audit now additionally requires the
verification queue uniqueness/advisory-lock/lease controls.

## Migration and rollback

All five migrations are additive hardening repairs. Apply them in order after
`20260710000100`. Roll back application/worker code first. Do not restore
browser UPDATE/INSERT permissions on pending uploads or documents; if an
emergency rollback is necessary, keep the owner-checked RPC and restrict access
through a reviewed maintenance window.

## Verification evidence

- Fresh `supabase db reset` applied all migrations, including both repairs.
- `npm run test:rls` passed 11/11 against the disposable local database.
- Live loopback scanner fixture passed clean, infected, malformed, and timeout
  cases with real HTTP, not mocked fetch.
- Generated types were regenerated from the fresh schema after both additive
  RPC migrations, and `types:check` passed. The audit-chain compatibility
  migration is verified by the fresh lifecycle and chain-verification gates.
- A clean local Supabase reset applied all 39 migrations. The complete browser
  release suite passed 22/22 with the protected worker, and the final live RLS
  suite passed 11/11; audit-chain verification passed afterward.

## Blocked verification

The desktop command stream can detach from a long-running `ops:release` child
before its final JSON summary is returned. Completion was verified from the
Playwright 22/22 marker plus independently rerun RLS, audit-chain, types, and
operator gates. CI must retain `ops:release` as the authoritative single
process/exit-code gate.
