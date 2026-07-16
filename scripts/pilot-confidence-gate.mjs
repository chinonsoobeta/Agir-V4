#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const quick = args.has("--quick");
const full = args.has("--full");
const skipRls = args.has("--skip-rls");

const hasAny = (keys) => keys.some((key) => process.env[key]?.trim());
const hasSchemaDriftDatabase = hasAny([
  "SCHEMA_DRIFT_DATABASE_URL",
  "POSTGRES_URL",
  "DATABASE_URL",
  "SUPABASE_DB_URL",
  "SUPABASE_DATABASE_URL",
  "SUPABASE_POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
]);
const hasDatabaseUrl = hasAny([
  "POSTGRES_URL",
  "DATABASE_URL",
  "SUPABASE_DB_URL",
  "SUPABASE_DATABASE_URL",
  "SUPABASE_POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
]);
const hasRemediationDatabase = hasAny([
  "PILOT_REMEDIATION_DATABASE_URL",
  "POSTGRES_URL",
  "DATABASE_URL",
  "SUPABASE_DB_URL",
  "SUPABASE_DATABASE_URL",
  "SUPABASE_POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
]);
const hasRlsDatabase = hasAny(["EPHEMERAL_DATABASE_URL", "SUPABASE_TEST_DATABASE_URL"]);
const hasAuditChainDatabase = hasAny(["AUDIT_CHAIN_DATABASE_URL"]);
const hasGovernanceDatabase = hasAny(["DATA_GOVERNANCE_DATABASE_URL"]);
const hasTenantDbLoadDatabase = hasAny(["TENANT_DB_LOAD_DATABASE_URL"]);
const hasPropertySearchLoadDatabase = hasAny([
  "PROPERTY_SEARCH_LOAD_DATABASE_URL",
  "TENANT_DB_LOAD_DATABASE_URL",
]);
const shouldRunE2e = process.env.PILOT_GATE_E2E === "1" || process.env.E2E_BASE_URL || full;

const checks = [
  {
    name: "schema drift",
    command: "npm",
    args: ["run", "drift:check"],
    required: true,
    scope: "pilot-blocking when DB is configured",
    armedEnv: [
      "SCHEMA_DRIFT_DATABASE_URL",
      "POSTGRES_URL",
      "DATABASE_URL",
      "SUPABASE_DB_URL",
      "SUPABASE_DATABASE_URL",
      "SUPABASE_POSTGRES_URL",
      "POSTGRES_PRISMA_URL",
      "POSTGRES_URL_NON_POOLING",
    ],
    skip:
      hasSchemaDriftDatabase || full
        ? null
        : "no SCHEMA_DRIFT_DATABASE_URL, POSTGRES_URL, DATABASE_URL, SUPABASE_DB_URL, SUPABASE_DATABASE_URL, SUPABASE_POSTGRES_URL, POSTGRES_PRISMA_URL, or POSTGRES_URL_NON_POOLING",
  },
  {
    name: "migration safety audit",
    command: "npm",
    args: ["run", "audit:migrations"],
    required: true,
    scope: "pilot-blocking",
  },
  {
    name: "backend hardening audits",
    command: "npm",
    args: ["run", "backend:audit"],
    required: true,
    scope: "pilot-blocking",
  },
  {
    name: "pilot readiness artifacts",
    command: "npm",
    args: ["run", "pilot:audit"],
    required: true,
    scope: "pilot-blocking",
  },
  {
    name: "pilot remediation state",
    command: "npm",
    args: ["run", "pilot:remediation:audit"],
    required: true,
    scope: "pilot-blocking data integrity",
    armedEnv: [
      "PILOT_REMEDIATION_DATABASE_URL",
      "POSTGRES_URL",
      "DATABASE_URL",
      "SUPABASE_DB_URL",
      "SUPABASE_DATABASE_URL",
      "SUPABASE_POSTGRES_URL",
      "POSTGRES_PRISMA_URL",
      "POSTGRES_URL_NON_POOLING",
    ],
    skip: hasRemediationDatabase ? null : "no database URL configured for remediation audit",
  },
  {
    name: "qualified external and municipal approvals",
    command: "npm",
    args: ["run", "pilot:external-gates"],
    required: true,
    scope: "pilot-blocking external evidence",
    armedEnv: [
      "POSTGRES_URL",
      "DATABASE_URL",
      "SUPABASE_DB_URL",
      "SUPABASE_DATABASE_URL",
      "SUPABASE_POSTGRES_URL",
      "POSTGRES_PRISMA_URL",
      "POSTGRES_URL_NON_POOLING",
    ],
  },
  {
    name: "typecheck",
    command: "npm",
    args: ["run", "typecheck"],
    required: true,
    scope: "pilot-blocking",
  },
  {
    name: "pilot remediation regressions",
    command: "npm",
    args: ["run", "pilot:remediation:regression"],
    required: true,
    scope: "pilot-blocking",
  },
  {
    name: quick ? "unit tests (quick contract subset)" : "unit tests",
    command: "npm",
    args: quick
      ? [
          "run",
          "test",
          "--",
          "src/test/concurrency-scale.test.ts",
          "src/test/engine-golden.test.ts",
          "src/test/extraction-corpus.test.ts",
          "src/test/professional-workflow.integration.test.ts",
        ]
      : ["run", "test"],
    required: true,
    scope: "pilot-blocking",
  },
  {
    name: "production build",
    command: "npm",
    args: ["run", "build"],
    required: true,
    scope: "pilot-blocking",
    skip: quick ? "skipped by --quick" : null,
  },
  {
    name: "bundle audit",
    command: "npm",
    args: ["run", "bundle:audit"],
    required: true,
    scope: "pilot-blocking",
    skip: quick ? "skipped by --quick" : null,
  },
  {
    name: "rls workspace policies",
    command: "npm",
    args: ["run", "test:rls"],
    required: true,
    scope: "pilot-blocking when test DB is configured",
    armedEnv: ["EPHEMERAL_DATABASE_URL", "SUPABASE_TEST_DATABASE_URL"],
    skip: skipRls
      ? "skipped by --skip-rls"
      : hasRlsDatabase || full
        ? null
        : "no EPHEMERAL_DATABASE_URL or SUPABASE_TEST_DATABASE_URL",
  },
  {
    name: "migration dry-run",
    command: "npm",
    args: ["run", "migrate:dry-run"],
    required: true,
    scope: "pilot-blocking when DB is configured",
    armedEnv: [
      "POSTGRES_URL",
      "DATABASE_URL",
      "SUPABASE_DB_URL",
      "SUPABASE_DATABASE_URL",
      "SUPABASE_POSTGRES_URL",
      "POSTGRES_PRISMA_URL",
      "POSTGRES_URL_NON_POOLING",
    ],
    skip: hasDatabaseUrl || full ? null : "no database URL configured",
  },
  {
    name: "audit-chain verification",
    command: "npm",
    args: ["run", "audit:verify-chains"],
    required: false,
    scope: "production evidence",
    armedEnv: ["AUDIT_CHAIN_DATABASE_URL"],
    skip: hasAuditChainDatabase || full ? null : "no AUDIT_CHAIN_DATABASE_URL",
  },
  {
    name: "data-governance dry run",
    command: "npm",
    args: ["run", "governance:dry-run"],
    required: false,
    scope: "production evidence",
    armedEnv: ["DATA_GOVERNANCE_DATABASE_URL"],
    skip: hasGovernanceDatabase || full ? null : "no DATA_GOVERNANCE_DATABASE_URL",
  },
  {
    name: "tenant DB concurrency smoke",
    command: "npm",
    args: ["run", "load:tenant-db"],
    required: false,
    scope: "scale evidence",
    armedEnv: ["TENANT_DB_LOAD_DATABASE_URL"],
    skip: hasTenantDbLoadDatabase || full ? null : "no TENANT_DB_LOAD_DATABASE_URL",
  },
  {
    name: "property search database load",
    command: "npm",
    args: ["run", "load:property-search-db"],
    required: true,
    scope: "pilot-blocking search scale and read-only evidence",
    armedEnv: ["PROPERTY_SEARCH_LOAD_DATABASE_URL", "TENANT_DB_LOAD_DATABASE_URL"],
    skip:
      hasPropertySearchLoadDatabase || full
        ? null
        : "no PROPERTY_SEARCH_LOAD_DATABASE_URL or TENANT_DB_LOAD_DATABASE_URL",
  },
  {
    name: "browser E2E",
    command: "npm",
    args: ["run", "test:e2e"],
    required: true,
    scope: "pilot-blocking",
    armedEnv: ["PILOT_GATE_E2E", "E2E_BASE_URL"],
    skip: shouldRunE2e ? null : "set PILOT_GATE_E2E=1 or E2E_BASE_URL to run",
  },
];

function fmtMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function printSummary(results) {
  const rows = [
    ["Check", "Mode", "Scope", "Status", "Duration", "Reason"],
    ...results.map((r) => [r.name, r.mode, r.scope, r.status, fmtMs(r.durationMs), r.reason ?? ""]),
  ];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)));
  console.log("\n[pilot-gate] summary");
  for (const [idx, row] of rows.entries()) {
    console.log(row.map((cell, i) => cell.padEnd(widths[i])).join(" | "));
    if (idx === 0) console.log(widths.map((w) => "-".repeat(w)).join("-|-"));
  }
  const dbSkips = results.filter(
    (r) =>
      r.status === "SKIP" &&
      r.armedEnv?.length &&
      /database|POSTGRES|SUPABASE|URL/i.test(`${r.reason} ${r.armedEnv.join(" ")}`),
  );
  if (dbSkips.length) {
    console.log(
      "\n[pilot-gate] DB-backed checks skipped only because their database URL env vars are not configured:",
    );
    for (const r of dbSkips) {
      console.log(`  - ${r.name}: set one of ${r.armedEnv.join(", ")}`);
    }
  }
}

const results = [];
let exitCode = 0;

for (const check of checks) {
  const start = Date.now();
  const mode = check.skip ? "SKIPPED" : check.armedEnv?.length ? "ARMED" : "ALWAYS";
  if (check.skip) {
    results.push({
      ...check,
      mode,
      status: "SKIP",
      durationMs: Date.now() - start,
      reason: check.skip,
    });
    continue;
  }

  console.log(`\n[pilot-gate] ${check.name}`);
  const result = spawnSync(check.command, check.args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  const failed = result.status !== 0;
  results.push({
    ...check,
    mode,
    status: failed ? "FAIL" : "PASS",
    durationMs: Date.now() - start,
    reason: failed ? `exited ${result.status ?? "unknown"}` : "",
  });
  if (failed && check.required) {
    exitCode = result.status ?? 1;
    break;
  }
}

printSummary(results);
if (exitCode) {
  console.error("\n[pilot-gate] FAIL: required pilot confidence check failed.");
  process.exit(exitCode);
}
const skippedRequired = results.filter((result) => result.required && result.status === "SKIP");
if (skippedRequired.length) {
  const labels = skippedRequired.map((result) => result.name).join(", ");
  if (quick) {
    console.log(
      `\n[pilot-gate] QUICK CHECK COMPLETE: ${labels} skipped. This is not release evidence.`,
    );
    process.exit(0);
  }
  console.error(`\n[pilot-gate] INCOMPLETE: required checks skipped: ${labels}.`);
  process.exit(1);
}
console.log("\n[pilot-gate] PASS: every required pilot confidence check completed.");
