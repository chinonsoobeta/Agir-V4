#!/usr/bin/env node
import pg from "pg";

const keys = [
  "POSTGRES_URL",
  "DATABASE_URL",
  "SUPABASE_DB_URL",
  "SUPABASE_DATABASE_URL",
  "SUPABASE_POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
];
const databaseUrl = keys.map((key) => process.env[key]?.trim()).find(Boolean);
if (!databaseUrl) {
  console.error(`[pilot-external-gates] Set one database URL env var: ${keys.join(", ")}`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: databaseUrl, statement_timeout: 15_000 });
await client.connect();
try {
  const external = await client.query(
    "select required_count,approved_count,release_ready from public.pilot_external_release_gate",
  );
  const municipal = await client.query(
    `select jurisdiction_name,active_category_count,approved_category_count,
      current_evidence_category_count,sources_current,release_ready
     from public.municipal_catalogue_release_gate where not release_ready order by jurisdiction_name`,
  );
  const gate = external.rows[0];
  const failures = [];
  if (!gate?.release_ready) {
    failures.push(
      `external approvals ${Number(gate?.approved_count ?? 0)}/${Number(gate?.required_count ?? 0)}`,
    );
  }
  if (municipal.rows.length)
    failures.push(`${municipal.rows.length} municipal catalogues not approved`);
  console.log(
    JSON.stringify({
      component: "pilot-external-gates",
      status: failures.length ? "blocked" : "passed",
      external: gate,
      municipal_blockers: municipal.rows,
    }),
  );
  if (failures.length) {
    console.error(`[pilot-external-gates] BLOCKED: ${failures.join("; ")}`);
    process.exitCode = 1;
  }
} finally {
  await client.end();
}
