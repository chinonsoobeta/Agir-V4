#!/usr/bin/env node
import pg from "pg";

const { Client } = pg;
const databaseUrl =
  process.env.SCHEMA_CACHE_DATABASE_URL ??
  process.env.SCHEMA_DRIFT_DATABASE_URL ??
  process.env.SUPABASE_SERVICE_DATABASE_URL ??
  process.env.DATABASE_URL;

if (!databaseUrl) {
  console.log("[schema-cache] SKIP: set SCHEMA_CACHE_DATABASE_URL or DATABASE_URL.");
  process.exit(0);
}

const client = new Client({
  connectionString: databaseUrl,
  ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? false : { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query("notify pgrst, 'reload schema'");
  console.log("[schema-cache] Requested PostgREST schema cache reload.");
} finally {
  await client.end().catch(() => {});
}
