# Pilot remediation implementation report

Date: 2026-07-14

## Outcome

All seven remediation phases now have implemented product, database, monitoring,
testing, and release-gate infrastructure. Automated engineering gates pass. The
strict pilot release remains blocked, as designed, because qualified external
approvals and a production-like restored backup target have not been supplied.

## Implemented evidence

- A clean local database applied all 65 migrations from zero.
- Generated Supabase types match the clean schema.
- The live RLS suite passes 35 tests, including immutable 205-record traversal,
  tenant isolation, property-job visibility, cross-collaborator deduplication,
  retained document versions, bounded retry, and two-phase deletion.
- The unit/integration suite passes 96 files and 784 tests.
- Desktop Chromium, mobile Chromium, Firefox, and WebKit accessibility coverage
  passes WCAG, keyboard, reduced-motion, and horizontal-overflow checks.
- Desktop and mobile route smoke coverage passes for Properties and the existing
  product routes.
- A transactional 10,000-property search exercise created the immutable result
  session in 421.2 ms, returned exact first and last pages, and rolled back all
  fixtures.
- Production client and SSR builds, typecheck, lint, formatting, bundle limits,
  migration safety, backend audits, and the quick pilot preflight pass.
- Upload cleanup, document-deletion cleanup, property-search cleanup, and
  document-lifecycle recovery operators complete successfully against local.

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
