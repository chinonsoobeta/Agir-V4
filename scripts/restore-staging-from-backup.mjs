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

import { readdir, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

// Optional real-restore metrics the operator measures out-of-band and passes
// in, so the evidence artifact records the actual RTO/RPO achieved, not just
// the verification duration. Backup identity is recorded for the audit trail.
const RESTORE_RTO_SECONDS = process.env.RESTORE_RTO_SECONDS;
const RESTORE_RPO_SECONDS = process.env.RESTORE_RPO_SECONDS;
const BACKUP_LABEL = process.env.BACKUP_LABEL ?? null;

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
  "audit_chain_verifications",
  "compliance_enforcement_runs",
];

async function localVersions() {
  const dir = resolve(process.cwd(), "supabase/migrations");
  const files = await readdir(dir);
  return files
    .filter((f) => /^\d{14}_.+\.sql$/.test(f))
    .map((f) => f.slice(0, 14))
    .sort();
}

async function writeEvidence(evidence) {
  const dir = resolve(process.cwd(), "docs/ops/dr-drills");
  await mkdir(dir, { recursive: true });
  const stamp = evidence.startedAt.replace(/[:.]/g, "-");
  const path = resolve(dir, `restore-drill-${stamp}.json`);
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`[restore-drill] evidence written: ${path}`);
}

async function main() {
  const started = new Date();
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  // Auditable evidence record for the DR runbook (docs/ops/disaster-recovery.md).
  const evidence = {
    drill: "restore-from-backup",
    startedAt: started.toISOString(),
    database: dbName,
    backupLabel: BACKUP_LABEL,
    rtoSeconds: RESTORE_RTO_SECONDS ? Number(RESTORE_RTO_SECONDS) : null,
    rpoSeconds: RESTORE_RPO_SECONDS ? Number(RESTORE_RPO_SECONDS) : null,
    checks: {},
    failures: [],
    result: "pass",
  };
  const fail = (msg) => {
    console.error(`[restore-drill] FAIL: ${msg}`);
    process.exitCode = 1;
    evidence.failures.push(msg);
    evidence.result = "fail";
  };
  try {
    await client.connect();
    console.log(`[restore-drill] Connected to staging DB "${dbName}".`);
    evidence.checks.connectivity = true;

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
    evidence.checks.migrations = {
      applied: applied.length,
      expected: expected.length,
      pending,
      extra,
    };
    if (pending.length) fail(`pending migrations on restored DB: ${pending.join(", ")}`);
    if (extra.length) fail(`extra migrations on restored DB: ${extra.join(", ")}`);

    // 4. Smoke: expected tables present.
    const { rows: tbls } = await client.query(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const present = new Set(tbls.map((r) => r.table_name));
    const missing = EXPECTED_TABLES.filter((t) => !present.has(t));
    evidence.checks.keyTables = { expected: EXPECTED_TABLES.length, missing };
    if (missing.length) fail(`expected tables missing after restore: ${missing.join(", ")}`);
    else console.log(`[restore-drill] smoke: all ${EXPECTED_TABLES.length} key tables present.`);

    const { rows: storageRefs } = await client.query(`
      select
        count(*)::int as documents,
        count(*) filter (where storage_path is null or length(trim(storage_path)) = 0)::int as missing_storage_refs
      from public.documents
    `);
    const storageRefSummary = storageRefs[0] ?? { documents: 0, missing_storage_refs: 0 };
    evidence.checks.storageReferences = storageRefSummary;
    if (Number(storageRefSummary.missing_storage_refs) > 0) {
      fail(`${storageRefSummary.missing_storage_refs} document row(s) missing storage_path`);
    }

    const { rows: auditRows } = await client.query(`
      select
        count(*)::int as audit_rows,
        count(*) filter (where row_hash is null)::int as missing_hashes
      from public.audit_logs
    `);
    const auditSummary = auditRows[0] ?? { audit_rows: 0, missing_hashes: 0 };
    evidence.checks.auditHashCoverage = auditSummary;
    if (Number(auditSummary.missing_hashes) > 0) {
      fail(`${auditSummary.missing_hashes} audit row(s) missing hash-chain values`);
    }

    if (process.exitCode) {
      console.error("[restore-drill] Restore drill FAILED -- see errors above.");
    } else {
      console.log("[restore-drill] PASS: restored staging DB is healthy and in sync.");
    }
  } catch (err) {
    fail(err?.message ?? String(err));
  } finally {
    await client.end().catch(() => {});
    evidence.finishedAt = new Date().toISOString();
    evidence.verificationDurationMs = Date.now() - started.getTime();
    await writeEvidence(evidence).catch((e) =>
      console.error(`[restore-drill] could not write evidence: ${e?.message ?? e}`),
    );
  }
}

main();
