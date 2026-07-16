# Pilot remediation implementation report

Date: 2026-07-14

## Outcome

The original implementation result is superseded by the Phase 0–2 corrective
program. The pilot remains blocked until the containment inventory is clear,
the forward-only security and lifecycle migrations pass staging, and qualified
external approvals are supplied.

## Phase 3–5 completion

- Municipal snapshots use an explicit optional observation key; multiple
  observations in one transaction no longer collide on `now()`.
- Upload retry eligibility is a generated database field with a canonical
  three-retry constraint. Clients display the database decision.
- Property document queries are scoped by property/workspace cache identity,
  extraction jobs are indexed once per render, and duplicate filenames produce
  a pre-upload warning while server hashes remain authoritative.
- The property and document remediation paths use generated database types
  without `as any` or `as never` RPC escapes.
- The accepted search ADR records live, read-only keyset semantics, access
  revocation behavior, count semantics, and the threshold for reconsidering
  snapshots.
- The pilot gate requires remediation-state audit, focused regression coverage,
  RLS, and the large read-only property-search traversal before release.

## Implemented evidence

- A clean local database applied all 65 migrations from zero.
- Generated Supabase types match the clean schema.
- The live RLS suite covers access-safe 205-record keyset traversal,
  tenant isolation, property-job visibility, cross-collaborator deduplication,
  retained document versions, bounded retry, and two-phase deletion.
- The unit/integration suite passes 96 files and 784 tests.
- Desktop Chromium, mobile Chromium, Firefox, and WebKit accessibility coverage
  passes WCAG, keyboard, reduced-motion, and horizontal-overflow checks.
- Desktop and mobile route smoke coverage passes for Properties and the existing
  product routes.
- The property-search load exercise now traverses the complete fixture with
  read-only keyset pages and rolls back all fixtures.
- Production client and SSR builds, typecheck, lint, formatting, bundle limits,
  migration safety, backend audits, and the quick pilot preflight pass.
- Finalized-document deletion is paused by default until the Phase 0 inventory
  and Phase 2 failure-injection checks pass.

## Source-monitor observation

The all-source monitor checked all 22 recorded municipal URLs. Nineteen were
retrievable. Vancouver, Kelowna, and West Vancouver rejected or failed automated
retrieval during this run. The monitor exited non-zero and those sources remain
manual-review blockers; an automated retrieval failure is not evidence that the
municipal page itself is unavailable to a person.

## Strict deployment-gate result

The full gate passed schema drift, migration safety, backend hardening, and
readiness-artifact checks, then stopped at the external evidence boundary:

- Qualified external approvals: 0 of 6 recorded.
- Qualified municipal catalogue approvals: none recorded.
- Production restoration drill: not executable without an approved restored
  staging/test database and measured backup identity, RTO, and RPO.

This failure is the correct release decision. Repository automation must not
replace municipal, legal/privacy, accessibility, security, recovery, or support
accountability evidence.
