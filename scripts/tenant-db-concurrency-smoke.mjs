#!/usr/bin/env node
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.TENANT_DB_LOAD_DATABASE_URL?.trim();

if (!databaseUrl) {
  console.log(
    "[tenant-db-load] SKIP: set TENANT_DB_LOAD_DATABASE_URL to run DB concurrency smoke.",
  );
  process.exit(0);
}

const concurrency = Number(process.env.TENANT_DB_LOAD_CONCURRENCY ?? 12);
const iterations = Number(process.env.TENANT_DB_LOAD_ITERATIONS ?? 8);
const maxMs = Number(process.env.TENANT_DB_LOAD_MAX_MS ?? 5000);

function sslFor(url) {
  return /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false };
}

async function runProbe(worker) {
  const client = new Client({ connectionString: databaseUrl, ssl: sslFor(databaseUrl) });
  await client.connect();
  try {
    for (let i = 0; i < iterations; i += 1) {
      await client.query(`
        select
          (select count(*)::int from public.projects) as projects,
          (select count(*)::int from public.assumptions) as assumptions,
          (select count(*)::int from public.financial_outputs) as outputs
      `);
    }
  } finally {
    await client.end().catch(() => {});
  }
  return worker;
}

const started = performance.now();
await Promise.all(Array.from({ length: concurrency }, (_, index) => runProbe(index)));
const elapsedMs = performance.now() - started;

console.log(
  `[tenant-db-load] concurrency=${concurrency} iterations=${iterations} elapsedMs=${elapsedMs.toFixed(1)}`,
);

if (elapsedMs > maxMs) {
  console.error(`[tenant-db-load] exceeded ${maxMs}ms budget.`);
  process.exit(1);
}
