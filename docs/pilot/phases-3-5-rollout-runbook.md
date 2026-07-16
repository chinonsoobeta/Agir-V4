# Phases 3–5 rollout runbook

The pilot remains blocked until this sequence completes against backed-up
staging and production environments.

## Staging

1. Apply all forward-only remediation migrations to a production-like clone.
2. Run `npm run pilot:remediation:audit`; reconcile every blocking finding.
3. Run generated-type, migration, unit, RLS, browser, build, and property-search
   load gates.
4. Inject document Storage deletion failure, retry exhaustion, stale claim,
   cancellation, and concurrent replacement scenarios.
5. Confirm authenticated tenants cannot query internal operational evidence.
6. Confirm workspace revocation takes effect on the next property-search page.

## Production rollout

1. Confirm database and Storage backups and record their immutable identities.
2. Keep `DOCUMENT_DELETION_WORKER_ENABLED` unset.
3. Apply the security/search migration, then document lifecycle migration, then
   municipal snapshot/retry consistency migration.
4. Run `npm run pilot:remediation:audit` and `npm run pilot:gate`.
5. Enable the deletion worker with a small claim schedule only after the audit
   is clear.
6. Monitor deletion queue age, terminal failures, missing Storage objects, RLS
   denials, search latency, and search-session table size.
7. Roll out to internal operators, then one named pilot workspace, then the
   remaining approved pilot workspaces.

## Stop conditions

Stop rollout and disable the deletion worker if any of these occur:

- a live document row points to a missing Storage object;
- a document version fork or duplicate successor appears;
- an unauthorized tenant can read internal evidence;
- access revocation does not apply to the next search page;
- required release checks skip or pass without external approvals;
- search latency or database write volume exceeds the approved budget.

Database migrations are forward-only. Application rollback restores the prior
build, but stronger grants, constraints, and lifecycle states remain in place.
Any database correction requires a reviewed follow-up migration.
