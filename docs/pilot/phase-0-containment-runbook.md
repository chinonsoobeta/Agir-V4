# Phase 0 containment runbook

The pilot remains blocked until the Phase 0 inventory is clear and the Phase 1
and Phase 2 corrective migrations have passed staging verification.

1. Pause finalized-document deletion by leaving
   `DOCUMENT_DELETION_WORKER_ENABLED` unset. Pending-upload garbage collection
   remains available.
2. Confirm a restorable database backup and a storage inventory exist.
3. Run `npm run pilot:remediation:audit` with
   `PILOT_REMEDIATION_DATABASE_URL` pointed at the target environment.
4. Reconcile every reported evidence-chain fork manually. Never infer which
   document is authoritative or rewrite an evidence edge automatically.
5. Reconcile missing Storage objects against backup and audit history.
6. Apply the Phase 1 and Phase 2 migrations to staging and rerun the audit.
7. Exercise storage-failure, stale-claim, retry, cancellation, and concurrent
   replacement tests.
8. Set `DOCUMENT_DELETION_WORKER_ENABLED=1` only after those checks pass. Start
   with a small schedule and alert on queue age and terminal failures.

The audit is read-only. A non-zero exit means manual reconciliation is required
before unique invariants can be installed safely.
