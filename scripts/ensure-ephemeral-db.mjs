#!/usr/bin/env node
import pg from "pg";
import { assertTestDatabase } from "../src/test/rls/assert-test-db.mjs";

const { Client } = pg;

const EPHEMERAL_URL_KEYS = [
  "EPHEMERAL_DATABASE_URL",
  "EPHEMERAL_SUPABASE_DB_URL",
  "SUPABASE_TEST_DATABASE_URL",
  "DATABASE_URL",
];

function resolveDatabaseUrl() {
  for (const key of EPHEMERAL_URL_KEYS) {
    const value = process.env[key]?.trim();
    if (value) return { key, value };
  }
  throw new Error(`Set one disposable database URL env var: ${EPHEMERAL_URL_KEYS.join(", ")}`);
}

function maintenanceUrl(connectionString) {
  const url = new URL(connectionString);
  const targetDb = url.pathname.replace(/^\//, "");
  assertTestDatabase(connectionString);
  if (!targetDb) throw new Error("Disposable database URL must include a database name.");
  url.pathname = "/postgres";
  return { connectionString: url.toString(), targetDb };
}

function quoteIdent(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

const resolved = resolveDatabaseUrl();
const { connectionString, targetDb } = maintenanceUrl(resolved.value);
const client = new Client({
  connectionString,
  ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
});

try {
  await client.connect();
  const { rows } = await client.query("select 1 from pg_database where datname = $1", [targetDb]);
  if (!rows.length) {
    await client.query(`create database ${quoteIdent(targetDb)}`);
    console.log(`[ephemeral-db] created disposable database "${targetDb}" via ${resolved.key}.`);
  } else {
    console.log(`[ephemeral-db] disposable database "${targetDb}" already exists.`);
  }
} finally {
  await client.end().catch(() => {});
}
