# SOC 2 Evidence Binder

This binder is the in-repo control map for SOC 2 readiness. It is not a SOC 2
report. A Type II report requires an external auditor and an observation window.

## Control Owners

| Area | Owner | Evidence |
| --- | --- | --- |
| Access reviews | Security / Operations | Workspace member exports, quarterly review sign-off |
| Change management | Engineering | PRs, CI runs, migration dry-runs, deploy approvals |
| Logical access | Engineering | RLS tests, role-matrix tests, auth middleware |
| Audit logging | Engineering | Append-only audit migration, audit export CSV |
| Incident response | Operations | Incident runbook, PIRs, severity records |
| Vendor management | Operations / Legal | Vendor inventory, DPA/subprocessor reviews |
| Data governance | Operations / Legal | Request log, retention/deletion evidence |
| Backups and DR | Operations | Backup validation, restore drill evidence |
| Security testing | Security | Pen-test report, remediation tracker |

## Evidence Cadence

- Weekly: CI evidence, deploy log, failed-control review.
- Monthly: access review sample, audit-log export sample, backup status screenshot.
- Quarterly: vendor review, incident tabletop, DR restore drill or documented exception.
- Annually: external penetration test, policy review, SOC 2 auditor request list.

## Required External Evidence

- Signed auditor engagement.
- Observation-window start date.
- Auditor request list and responses.
- Final SOC 2 Type II report.
- Management assertion and complementary user-entity controls.

## Repo Evidence Pointers

- RLS smoke harness: `npm run smoke:ephemeral-db`
- Workspace role tests: `src/test/workspace-rls-roles.test.ts`
- Compliance tests: `src/test/compliance-readiness.test.ts`
- Migration ledger and recovery: `docs/RUNBOOK.md`
- Enterprise controls migration: `supabase/migrations/20260629000200_enterprise_compliance_controls.sql`
