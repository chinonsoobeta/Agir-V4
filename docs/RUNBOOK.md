# Production Runbook

## Migration Recovery

### Failed or Partial Migration

`run_migrations.mjs` applies each migration in its own transaction. If a migration fails, that migration is rolled back and is not inserted into `public.schema_migrations`.

Recovery steps:

1. Stop deploys that depend on the failed migration.
2. Check the runner output for the failed filename and SQL error.
3. Verify the ledger:

```bash
POSTGRES_URL="postgresql://..." psql -c "select version, applied_at from public.schema_migrations order by version;"
```

4. Confirm the failed migration version is absent from the ledger.
5. Fix the migration or the target database precondition.
6. Run a diff preview:

```bash
POSTGRES_URL="postgresql://..." npm run migrate:dry-run
```

7. Re-run migrations:

```bash
POSTGRES_URL="postgresql://..." npm run migrate
```

If the ledger contains a version but its DDL is not present, treat it as schema drift and follow the drift incident steps below.

### Bad Successful Migration

The runner is intentionally forward-only. To roll back a migration that already committed:

1. Freeze deploys and writes if the bad schema can corrupt data.
2. Write inverse SQL and review it like a production migration.
3. Prefer a new forward migration that repairs the schema. Use rollback SQL only when an immediate reversal is safer.
4. Store worked inverse SQL examples in `docs/migration-rollbacks/<migration-version>.down.sql`. Do not place `*.down.sql` under `supabase/migrations`, because the runner applies every `.sql` file in that directory.
5. Run the inverse SQL manually against a restored staging copy first.
6. Apply to production with a direct `psql` session or the Supabase SQL editor.
7. Add a new forward migration if the application code needs to encode the corrected end state.
8. Verify `npm run migrate:dry-run` shows no unexpected pending production migrations.

Worked example: `docs/migration-rollbacks/20260627000100_audit_logs_append_only.down.sql`.

## Supabase Backup and PITR

Before a production migration:

1. Confirm the project is on a plan with backups or PITR enabled.
2. In Supabase Dashboard, open Project Settings -> Database -> Backups.
3. Record the latest backup timestamp and PITR window.
4. If Supabase offers an on-demand backup for the project tier, create one before migration.
5. Export the exact `public.schema_migrations` ledger before migration:

```bash
POSTGRES_URL="postgresql://..." psql -c "copy (select * from public.schema_migrations order by version) to stdout with csv header" > schema_migrations_before.csv
```

Restore drill:

1. Restore to a new Supabase project or branch, not over production.
2. Point `POSTGRES_URL` at the restored database.
3. Run `npm run migrate:dry-run` to list pending migrations.
4. Run smoke tests against the restored app environment.
5. Only promote or swap traffic after product and data checks pass.

## Schema Drift Incident

Signals:

- `/api/health` reports schema drift or degraded status.
- `npm run migrate:dry-run` reports unexpected pending migrations.
- Application errors mention missing relations, columns, policies, or enum values.

Incident steps:

1. Freeze schema changes.
2. Capture `/api/health` output and current commit SHA.
3. Run:

```bash
POSTGRES_URL="postgresql://..." npm run migrate:dry-run
```

4. Compare `public.schema_migrations` with files in `supabase/migrations`.
5. If migrations are pending, apply them with `npm run migrate`.
6. If the ledger claims a migration that the schema does not reflect, restore from backup/PITR or apply a reviewed repair migration.
7. Re-run `/api/health`, `npm run migrate:dry-run`, and the smoke checklist.
8. Document root cause in the incident notes and add a regression test if drift escaped CI.

## Predeploy Checklist

- Working tree contains only intended changes.
- Engine math in `src/lib/engine` is untouched unless explicitly approved.
- New migration has been reviewed for RLS, grants, idempotency, and data backfill behavior.
- Backup/PITR checkpoint recorded.
- `npm run migrate:dry-run` reviewed against the target database.
- `npm run typecheck` passes.
- `npm run test` passes.
- `npm run build` passes.
- `npm run lint` passes with zero errors.
- `/api/health` is checked after deploy.
- Harbour demo or a representative project smoke test completes extraction, conflict resolution/default acceptance, and underwriting.
