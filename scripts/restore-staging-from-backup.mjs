#!/usr/bin/env node
// One-command staging restore-from-backup DRILL.
//
// Validates that a backup/PITR snapshot you have already restored into a
// STAGING database is healthy and matches this commit's migrations -- the
// rehearsal you want to have done *before* you ever need it in a real incident.
//
// Usage:
//   STAGING_DATABASE_URL="postgres://...staging..." npm run restore:drill
//
// Steps (read-only / non-destructive against the staging DB):
//   1. Safety guard: refuse to run unless the target DB name looks like staging
//      (contains "staging" or "restore" or "test") -- never point this at prod.
//   2. Connectivity + migration-ledger check.
//   3. Schema-drift check vs. supabase/migrations (pending / extra).
//   4. Smoke: confirm a representative set of expected tables exist.
//
// Exit non-zero on any failure so the drill is CI-runnable.

import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const url = process.env.STAGING_DATABASE_URL?.trim();
if (!url) {
  console.error("[restore-drill] STAGING_DATABASE_URL is required.");
  process.exit(2);
}

const dbName = (() => {
  try {
    return new URL(url).pathname.replace(/^\//, "");
  } catch {
    return "";
  }
})();
if (!/(staging|restore|test)/i.test(dbName)) {
  console.error(
    `[restore-drill] Refusing to run: database "${dbName}" does not look like a staging/restore target. ` +
      "Name it with 'staging', 'restore', or 'test' to confirm intent.",
  );
  process.exit(2);
}

const EXPECTED_TABLES = [
  "projects",
  "assumptions",
  "financial_outputs",
  "documents",
  "decision_logs",
  "audit_logs",
  "memo_snapshots",
  "extraction_jobs",
];

async function localVersions() {
  const dir = resolve(process.cwd(), "supabase/migrations");
  const files = await readdir(dir);
  return files
    .filter((f) => /^\d{14}_.+\.sql$/.test(f))
    .map((f) => f.slice(0, 14))
    .sort();
}

async function main() {
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  const fail = (msg) => {
    console.error(`[restore-drill] FAIL: ${msg}`);
    process.exitCode = 1;
  };
  try {
    await client.connect();
    console.log(`[restore-drill] Connected to staging DB "${dbName}".`);

    // 2/3. Migration ledger + drift.
    const expected = await localVersions();
    const { rows } = await client.query(
      "select version from supabase_migrations.schema_migrations order by version",
    );
    const applied = rows.map((r) => String(r.version));
    const appliedSet = new Set(applied);
    const expectedSet = new Set(expected);
    const pending = expected.filter((v) => !appliedSet.has(v));
    const extra = applied.filter((v) => !expectedSet.has(v));
    console.log(
      `[restore-drill] migrations: ${applied.length} applied, ${expected.length} in repo.`,
    );
    if (pending.length) fail(`pending migrations on restored DB: ${pending.join(", ")}`);
    if (extra.length) fail(`extra migrations on restored DB: ${extra.join(", ")}`);

    // 4. Smoke: expected tables present.
    const { rows: tbls } = await client.query(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const present = new Set(tbls.map((r) => r.table_name));
    const missing = EXPECTED_TABLES.filter((t) => !present.has(t));
    if (missing.length) fail(`expected tables missing after restore: ${missing.join(", ")}`);
    else console.log(`[restore-drill] smoke: all ${EXPECTED_TABLES.length} key tables present.`);

    if (process.exitCode) {
      console.error("[restore-drill] Restore drill FAILED -- see errors above.");
    } else {
      console.log("[restore-drill] PASS: restored staging DB is healthy and in sync.");
    }
  } catch (err) {
    fail(err?.message ?? String(err));
  } finally {
    await client.end().catch(() => {});
  }
}

main();
