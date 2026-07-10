# Agir Local Setup

## Human prerequisite

Create a new Supabase project in the product owner's own Supabase organization before pushing any migrations. Use a region near users, preferably US-West or Canada. Do not reuse the Lovable-managed project. Collect the project ref, publishable key, service-role key, and database password.

## Local-first workflow

```bash
npm install
cp .env.example .env.local
supabase start
supabase db reset
npm run dev
```

`VITE_SUPABASE_URL` should match `SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY` should match `SUPABASE_PUBLISHABLE_KEY`. The `VITE_` copies are required because the browser-side Supabase client can only read Vite-exposed environment variables.

After local migrations and tests pass, link and push to the owned project:

```bash
supabase link --project-ref <project-ref>
supabase db push
```

## Backup before remote migration

```bash
mkdir -p backups
supabase db dump --linked --file backups/pre-development-engine.sql
```

## Verification

```bash
npm run test
npm run build
```

## Full local Supabase confidence gate

This is intentionally opt-in for local development and mandatory in CI. It
requires a running Docker-backed Supabase stack and Chromium; it never skips
database or browser checks.

```bash
supabase start
eval "$(supabase status -o env)"
export SUPABASE_URL="$API_URL"
export SUPABASE_ANON_KEY="$ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export DATABASE_URL="$DB_URL"
node scripts/ensure-demo-user.mjs
npx playwright install chromium
npm run ops:release
```

Use `npm run ops:check` for the fast static/operator gate, `npm run ops:cleanup`
for bounded expired pending-upload cleanup, and `npm run ops:recover` for
non-destructive queue/migration/audit diagnostics. See
[docs/ops/operator-interface.md](docs/ops/operator-interface.md).
