#!/usr/bin/env node
// Deploy gate: BLOCK (exit 1) if the live database has drifted from the
// migrations in this commit -- i.e. there are pending migrations not yet
// applied, or migrations applied in the DB that don't exist in the repo.
//
// Behaviour:
//   * No database URL configured -> SKIP (exit 0). The gate is a no-op in
//     environments without a DB secret (e.g. fork PRs) so it never breaks CI;
//     wire a *_DATABASE_URL secret to the production/staging DB to arm it.
//   * Configured + in sync       -> PASS (exit 0).
//   * Configured + drift          -> FAIL (exit 1) with a printed diff.
//
// This is the blocking counterpart to the advisory runtime check in
// src/lib/schema-drift.server.ts (which only logs).

import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const URL_KEYS = [
  "SCHEMA_DRIFT_DATABASE_URL",
  "POSTGRES_URL",
  "DATABASE_URL",
  "SUPABASE_DB_URL",
  "SUPABASE_DATABASE_URL",
  "SUPABASE_POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
];

function resolveConnection() {
  for (const key of URL_KEYS) {
    const v = process.env[key]?.trim();
    if (v) return { connectionString: v, envVar: key };
  }
  return { connectionString: null, envVar: null };
}

async function localVersions() {
  const dir = resolve(process.cwd(), "supabase/migrations");
  const files = await readdir(dir);
  return files
    .filter((f) => /^\d{14}_.+\.sql$/.test(f))
    .map((f) => f.slice(0, 14))
    .sort();
}

async function main() {
  const expected = await localVersions();
  const { connectionString, envVar } = resolveConnection();
  if (!connectionString) {
    console.log(
      `[drift-gate] SKIP: no database URL configured (${URL_KEYS.join(", ")}). Set one to arm the gate.`,
    );
    process.exit(0);
  }

  const client = new pg.Client({
    connectionString,
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    const appliedRows = [];
    const { rows: supabaseLedger } = await client.query("select to_regclass($1) as name", [
      "supabase_migrations.schema_migrations",
    ]);
    if (supabaseLedger[0]?.name) {
      const { rows } = await client.query(
        "select version::text as version from supabase_migrations.schema_migrations",
      );
      appliedRows.push(...rows);
    }
    const { rows: publicLedger } = await client.query("select to_regclass($1) as name", [
      "public.schema_migrations",
    ]);
    if (publicLedger[0]?.name) {
      const { rows } = await client.query(
        "select left(version::text, 14) as version from public.schema_migrations",
      );
      appliedRows.push(...rows);
    }
    const applied = Array.from(
      new Set(appliedRows.map((r) => String(r.version).slice(0, 14))),
    ).sort();
    const expectedSet = new Set(expected);
    const appliedSet = new Set(applied);
    const pending = expected.filter((v) => !appliedSet.has(v));
    const extra = applied.filter((v) => !expectedSet.has(v));
    if (pending.length || extra.length) {
      console.error(`[drift-gate] FAIL: schema drift detected via ${envVar}.`);
      if (pending.length) console.error(`  pending (in repo, not applied): ${pending.join(", ")}`);
      if (extra.length) console.error(`  extra (applied, not in repo):    ${extra.join(", ")}`);
      console.error("  Apply migrations (npm run migrate) or reconcile the repo before deploying.");
      process.exit(1);
    }
    const required = [
      ["public", "underwriting_runs", "id"],
      ["public", "underwriting_runs", "run_number"],
      ["public", "underwriting_runs", "input_fingerprint"],
      ["public", "financial_outputs", "run_id"],
      ["public", "investment_memos", "run_id"],
      ["public", "decision_logs", "run_id"],
      ["public", "cash_flows", "run_id"],
      ["public", "reconciliation_flags", "run_id"],
      ["public", "risk_register", "run_id"],
    ];
    const { rows: columnRows } = await client.query(
      `
        select table_schema, table_name, column_name
        from information_schema.columns
        where table_schema = 'public'
          and (
            (table_name = 'underwriting_runs' and column_name in ('id', 'run_number', 'input_fingerprint'))
            or (table_name in (
              'financial_outputs',
              'investment_memos',
              'decision_logs',
              'cash_flows',
              'reconciliation_flags',
              'risk_register'
            ) and column_name = 'run_id')
          )
      `,
    );
    const present = new Set(
      columnRows.map((row) => `${row.table_schema}.${row.table_name}.${row.column_name}`),
    );
    const missingColumns = required
      .map(([schema, table, column]) => `${schema}.${table}.${column}`)
      .filter((key) => !present.has(key));
    if (missingColumns.length) {
      console.error(`[drift-gate] FAIL: run-version schema is incomplete via ${envVar}.`);
      for (const key of missingColumns) console.error(`  missing: ${key}`);
      console.error("  Apply migrations and refresh the schema cache before deploying.");
      process.exit(1);
    }
    console.log(`[drift-gate] PASS: ${applied.length} migrations in sync via ${envVar}.`);
    process.exit(0);
  } catch (err) {
    console.error(`[drift-gate] ERROR: could not verify schema drift: ${err?.message ?? err}`);
    // A verification error is treated as a hard stop for a deploy gate.
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

main();
