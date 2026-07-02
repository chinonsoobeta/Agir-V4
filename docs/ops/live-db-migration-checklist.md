# Live DB: apply pending migrations + arm the drift gate

Two operator actions need production credentials (they cannot run from a dev
laptop without them). Both are one-time and take ~5 minutes together.

## 1. Apply pending migrations to the live database

The repo's migration runner reads `supabase/migrations/`, honors BOTH ledgers
(`supabase_migrations.schema_migrations` and the runner's own
`public.schema_migrations`), and applies only what's missing, in order.

```bash
# from the repo root, with the LIVE database URL (Supabase: use the direct
# connection string or session pooler, not the transaction pooler)
DATABASE_URL="postgres://postgres:...@db.<project-ref>.supabase.co:5432/postgres" \
  npm run migrate:dry-run     # lists pending migrations, changes nothing

DATABASE_URL="..." npm run migrate          # applies them
```

Verify afterwards: the deployed `/api/health` endpoint must report
`schemaDrift: true` (no drift), and `npm run readiness:deployed -- <app-url>`
must pass.

## 2. Arm the schema-drift deploy gate

CI's "Schema drift deploy gate" job is a no-op until the secret exists. Arm it
so a deploy can never silently outrun the database again:

- GitHub -> repo **Settings -> Secrets and variables -> Actions -> New secret**
- Name: `SCHEMA_DRIFT_DATABASE_URL`
- Value: a **read-capable** URL to the prod (or staging) database. A dedicated
  read-only role is ideal; the gate only reads
  `supabase_migrations.schema_migrations`.

The scheduled ops workflow (`ops-scheduled.yml` service-probes job) picks up
the same secret and starts drift-checking on a schedule as well.

## 3. Pre-demo readiness probe (run against the DEPLOYED app)

```bash
npm run readiness:deployed -- https://<deployed-app>
```

Checks the health endpoint (env valid, schema drift clear, Supabase wired),
that the sign-in page renders, and prints the health flags (document scanner
configured, etc.). Run it the morning of any unsupervised demo.
