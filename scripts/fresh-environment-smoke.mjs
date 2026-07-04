#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import pg from "pg";

const databaseUrl =
  process.env.FRESH_ENV_DATABASE_URL ??
  process.env.DATABASE_URL ??
  process.env.SUPABASE_TEST_DATABASE_URL ??
  process.env.EPHEMERAL_DATABASE_URL;

const requiredColumns = [
  ["public", "underwriting_runs", "id"],
  ["public", "underwriting_runs", "run_number"],
  ["public", "underwriting_runs", "input_fingerprint"],
  ["public", "financial_outputs", "run_id"],
  ["public", "cash_flows", "run_id"],
  ["public", "reconciliation_flags", "run_id"],
  ["public", "risk_register", "run_id"],
  ["public", "investment_memos", "run_id"],
  ["public", "decision_logs", "run_id"],
  ["public", "memo_snapshots", "run_id"],
  ["public", "run_financial_outputs", "run_id"],
  ["public", "run_cash_flows", "run_id"],
  ["public", "run_reconciliation_flags", "run_id"],
  ["public", "run_risk_register", "run_id"],
  ["public", "generated_reports", "run_id"],
  ["public", "generated_reports", "input_fingerprint"],
  ["public", "generated_reports", "output_fingerprint"],
];

function run(label, command, args, envPatch = {}) {
  console.log(`\n[fresh-env] ${label}`);
  const env = { ...process.env, ...envPatch };
  if (databaseUrl) env.DATABASE_URL = databaseUrl;
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
  }
}

async function verifyDatabase() {
  if (!databaseUrl) {
    console.log("[fresh-env] SKIP database checks: no fresh environment database URL configured.");
    return;
  }
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const { rows } = await client.query(
      `
        select table_schema, table_name, column_name
        from information_schema.columns
        where table_schema = 'public'
      `,
    );
    const present = new Set(
      rows.map((row) => `${row.table_schema}.${row.table_name}.${row.column_name}`),
    );
    const missing = requiredColumns
      .map(([schema, table, column]) => `${schema}.${table}.${column}`)
      .filter((key) => !present.has(key));
    if (missing.length) {
      throw new Error(`Missing required run-version columns:\n${missing.join("\n")}`);
    }

    const userCount = await client
      .query("select count(*)::int as count from auth.users")
      .catch(() => ({ rows: [{ count: 0 }] }));
    if (Number(userCount.rows[0]?.count ?? 0) === 0) {
      throw new Error("No auth user exists. Seed a demo or smoke user before deploy.");
    }

    const projectId = process.env.FRESH_ENV_SMOKE_PROJECT_ID;
    if (projectId) {
      const checks = [
        [
          "completed underwriting run",
          "select id, input_fingerprint from public.underwriting_runs where project_id = $1 and status = 'completed' limit 1",
        ],
        [
          "normalized outputs",
          "select id from public.run_financial_outputs where project_id = $1 limit 1",
        ],
        [
          "memo bound to run",
          "select id from public.investment_memos where project_id = $1 and run_id is not null limit 1",
        ],
        [
          "IC decision bound to run",
          "select id from public.decision_logs where project_id = $1 and run_id is not null limit 1",
        ],
        ["audit events", "select id from public.audit_logs where project_id = $1 limit 1"],
      ];
      for (const [label, sql] of checks) {
        const result = await client.query(sql, [projectId]);
        if (!result.rows.length) throw new Error(`Smoke project is missing ${label}.`);
      }
    } else {
      console.log("[fresh-env] SKIP seeded deal workflow checks: set FRESH_ENV_SMOKE_PROJECT_ID.");
    }
  } finally {
    await client.end().catch(() => {});
  }
}

console.log("[fresh-env] Starting fresh environment smoke.");

if (databaseUrl) {
  run("migration dry-run", "npm", ["run", "migrate:dry-run"]);
  run("schema drift", "npm", ["run", "drift:check"]);
  run("PostgREST schema reload", "npm", ["run", "schema:refresh-cache"], {
    SCHEMA_CACHE_DATABASE_URL: databaseUrl,
  });
}

run("generated Supabase types", "npm", ["run", "types:check"]);
run("typecheck", "npm", ["run", "typecheck"]);
run("unit tests", "npm", ["run", "test"]);
run("production build", "npm", ["run", "build"]);

await verifyDatabase();

if (process.env.FRESH_ENV_SEEDED_DEAL_SMOKE === "1") {
  run("seeded deal evidence path", "npm", ["run", "test:e2e", "--", "e2e/seed-workflow.spec.ts"]);
} else {
  console.log("[fresh-env] SKIP seeded deal E2E evidence path: set FRESH_ENV_SEEDED_DEAL_SMOKE=1.");
}

console.log("\n[fresh-env] Smoke passed.");
