# Disaster Recovery Runbook

## Objectives

Default targets:

- RTO: 24 hours.
- RPO: 24 hours.

Customer-specific targets are tracked in workspace compliance settings and must
match production infrastructure capabilities.

## Restore Drill

1. Select a production-like backup or Supabase branch.
2. Restore to an isolated environment.
3. Point `DATABASE_URL` or `EPHEMERAL_DATABASE_URL` at the restored database.
4. Run `npm run smoke:ephemeral-db`.
5. Validate a representative project: documents, assumptions, underwriting, reports, audit export.
6. Record start time, finish time, data timestamp, RTO, RPO, evidence links, and exceptions.
7. Update `last_dr_test_at` after a successful drill.

## Failure Criteria

- Missing schema migration.
- RLS smoke failure.
- Missing document storage object.
- Inability to generate reports.
- Audit-log export failure.

## Evidence Template

| Field | Value |
| --- | --- |
| Drill date | |
| Backup timestamp | |
| Restore target | |
| RTO achieved | |
| RPO achieved | |
| Smoke command output | |
| Exceptions | |
| Owner | |
