# Vercel Deployment

This app deploys as a TanStack Start/Nitro app using Vercel's Build Output API.

## Vercel settings

- Framework preset: Other
- Install command: `npm install`
- Build command: `npm run build`
- Output directory: leave blank

The build generates `.vercel/output`, which Vercel deploys directly.

## Environment variables

Add these in Vercel Project Settings -> Environment Variables for Production, Preview, and Development as needed:

```bash
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
POSTGRES_URL=
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
ANTHROPIC_API_KEY=
AGIR_AI_MODEL=claude-sonnet-4-6
ERROR_WEBHOOK_URL=
```

`VITE_SUPABASE_URL` should equal `SUPABASE_URL`.
`VITE_SUPABASE_PUBLISHABLE_KEY` should equal `SUPABASE_PUBLISHABLE_KEY`.

Never expose `SUPABASE_SERVICE_ROLE_KEY` with a `VITE_` prefix.

`POSTGRES_URL` is the direct Supabase Postgres connection string used by migrations and schema
drift checks. If your host provides a different name, the app also accepts `DATABASE_URL`,
`SUPABASE_DB_URL`, `SUPABASE_DATABASE_URL`, `SUPABASE_POSTGRES_URL`, `POSTGRES_PRISMA_URL`, and
`POSTGRES_URL_NON_POOLING`.

## Error monitoring

Every server-side error is emitted to stderr as a single structured JSON line
prefixed `[agir-error]` (see `src/lib/observability.server.ts`). Vercel captures
stderr, so the lowest-effort production monitoring is to attach a **log drain**
(Vercel Project Settings -> Log Drains: Sentry, Logflare, Axiom, Datadog) and
alert on `level":"error"`. For direct push instead, set `ERROR_WEBHOOK_URL` to an
ingest endpoint and each error event is POSTed there (fire-and-forget). Reporting
never throws and never blocks a request.

## Supabase auth URLs

After the first Vercel deployment, copy the Vercel URL and update Supabase:

Supabase Dashboard -> Authentication -> URL Configuration

- Site URL: `https://your-project.vercel.app`
- Redirect URLs:
  - `https://your-project.vercel.app/**`
  - `http://localhost:8080/**`
  - `http://127.0.0.1:8080/**`

If you use Google sign-in, configure Google as a Supabase OAuth provider and add the Supabase callback URL shown in the Supabase provider screen to Google Cloud Console.

## Migrations & schema discipline

Operational recovery procedures live in [docs/RUNBOOK.md](docs/RUNBOOK.md), including failed
migration recovery, rollback conventions, backup/PITR steps, schema drift incidents, and the
predeploy checklist.

Apply every migration in `supabase/migrations` to the target Supabase project **before** deploying new code. Two ways:

```bash
# Option A: connection string (idempotent; runs every file in order)
POSTGRES_URL="postgresql://…supabase.co:5432/postgres" npm run migrate

# Option B: paste each new .sql into the Supabase dashboard SQL editor
```

The app is written **migration-safe** (`src/lib/db-compat.ts`): if a newer build runs against an
older schema, list endpoints return empty, writes fail closed, and deal create/update strip
not-yet-applied columns and retry. So a staged deploy degrades gracefully: but features that need
the new tables (workspaces/teams, milestones, market signals, integration persistence,
preferences) stay inert until their migration is applied.

CI should gate on schema + types staying in sync:

```bash
npm run migrate        # apply migrations
npx supabase gen types typescript --linked > src/integrations/supabase/types.ts   # regenerate types
npm run typecheck      # tsc --noEmit must pass
npm run test
npm run build
```

## Database and storage

Before testing production:

1. Make sure all migrations in `supabase/migrations` have been applied to the Supabase project (see above).
2. Make sure the `documents` storage bucket exists.
3. Upload the shared Harbour demo files if you want the seeded Harbour demo to work for every account:

```bash
node scripts/upload-shared-harbour-docs.mjs
```

That script requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` locally.

## Verify after deploy

1. Sign up or sign in.
2. Create or seed the Harbour Centre demo.
3. Open the project and run extraction.
4. Resolve the exit-cap conflict or choose conservative.
5. Accept available defaults.
6. Run underwriting.

Expected behavior: server functions should return JSON errors, not HTML payloads, and unauthenticated actions should fail as `401`.
