# Ephemeral Supabase Smoke Test

Run this only against a disposable Postgres database whose name contains `test`
or with `RLS_ALLOW_DESTRUCTIVE=1`. The harness bootstraps Supabase-compatible
`auth` and `storage` schemas, applies every migration, and runs the live RLS
policy suite.

```bash
EPHEMERAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/agir_test \
  npm run smoke:ephemeral-db
```

CI should provision a fresh database for each run and destroy it afterwards. Do
not point this at production, staging, or any persistent shared database.

