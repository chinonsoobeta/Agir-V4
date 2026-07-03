# Pilot Readiness Checklist

Run before granting a sandbox workspace to an external evaluator.

## Automated Gates

- `npm run pilot:gate`
- `npm run smoke:fresh-env`
- `npm run pilot:audit`
- `npm run backend:audit`
- `npm run types:check`
- `npm run typecheck`
- `npm run test`
- `npm run lint`
- `npm run build`
- `npm run test:e2e`
- `npm run test:rls`

Use `npm run pilot:gate -- --quick` for a faster local preflight. Use
`npm run pilot:gate -- --full` when the pilot environment has database and E2E
targets configured; the summary marks DB/browser checks as skipped when their
required environment variables are absent.

Armed DB-backed checks:

- Schema drift / migration dry-run: set one of `SCHEMA_DRIFT_DATABASE_URL`,
  `POSTGRES_URL`, `DATABASE_URL`, `SUPABASE_DB_URL`, `SUPABASE_DATABASE_URL`,
  `SUPABASE_POSTGRES_URL`, `POSTGRES_PRISMA_URL`, or `POSTGRES_URL_NON_POOLING`.
- RLS workspace policies: set `EPHEMERAL_DATABASE_URL` or
  `SUPABASE_TEST_DATABASE_URL`.
- Audit-chain verification: set `AUDIT_CHAIN_DATABASE_URL`.
- Data-governance dry run: set `DATA_GOVERNANCE_DATABASE_URL`.
- Tenant DB concurrency smoke: set `TENANT_DB_LOAD_DATABASE_URL`.
- Browser workflow: set `PILOT_GATE_E2E=1` or `E2E_BASE_URL`.

## Product Gates

- Pilot package selected.
- Demo workspace created.
- Demo user sign-in tested with the exact sandbox credentials.
- Dashboard "Unsupervised demo guide" visible.
- Workspace roles reviewed.
- Enterprise trust controls reviewed.
- Document upload and extraction path smoke-tested.
- Report and memo generation smoke-tested.
- Customer audit package export smoke-tested.

## External Gates

- Pilot data approved for upload.
- Professional participant briefed.
- Support escalation path assigned.
- No production investment decisions allowed.
- Feedback and scorecard owner assigned.
