# Standalone Permits release runbook

## Pre-deployment

1. Take and label a database backup and record restoration instructions.
2. Keep Permit mode disabled for end users.
3. Record counts using `docs/sql/permit-release-verification.sql`.
4. Run a fresh local migration, generated-type check, migration audit, live RLS suite, and full release gate.
5. Confirm no required gate is skipped.

## Deployment

1. Deploy migrations before application code.
2. Validate the migration ledger and backfill counts.
3. Deploy application code with Permit mode disabled.
4. Run owner, member, viewer, and outsider smoke tests.
5. Enable internal users, then a named pilot cohort.

## Recovery

If validation fails, disable Permit mode immediately. Restore the labelled backup for integrity failures. Do not delete or move Storage objects. The migration preserves permit IDs; project pointers can be restored from `permit_cases.project_id`. Exercise this procedure on a database copy before production release.

## External gates

General availability remains blocked until counsel approves limitations, privacy, and retention wording; qualified municipal reviewers approve the pilot catalogue; representative users complete usability review; and an independent security assessment has no unresolved critical or high-severity findings.
