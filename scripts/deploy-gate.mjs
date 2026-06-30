#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const hasDatabaseUrl = [
  "POSTGRES_URL",
  "DATABASE_URL",
  "SUPABASE_DB_URL",
  "SUPABASE_DATABASE_URL",
  "SUPABASE_POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
].some((key) => process.env[key]?.trim());

const checks = [
  ["schema drift", "node", ["scripts/check-schema-drift.mjs"]],
  ...(hasDatabaseUrl ? [["migration dry-run", "npm", ["run", "migrate:dry-run"]]] : []),
  ...(hasDatabaseUrl ? [["schema cache refresh", "npm", ["run", "schema:refresh-cache"]]] : []),
  ["typecheck", "npm", ["run", "typecheck"]],
  ["unit tests", "npm", ["run", "test"]],
  ["production build", "npm", ["run", "build"]],
];

if (process.env.EPHEMERAL_DATABASE_URL || process.env.SUPABASE_TEST_DATABASE_URL) {
  checks.splice(2, 0, ["ephemeral RLS smoke", "npm", ["run", "smoke:ephemeral-db"]]);
}

if (process.env.AUDIT_CHAIN_DATABASE_URL) {
  checks.push(["audit-chain verification", "npm", ["run", "audit:verify-chains"]]);
}

if (process.env.DATA_GOVERNANCE_DATABASE_URL) {
  checks.push(["data-governance enforcement", "npm", ["run", "governance:enforce"]]);
}

for (const [label, command, args] of checks) {
  console.log(`\n[deploy-gate] ${label}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`[deploy-gate] FAIL: ${label} exited ${result.status ?? "unknown"}.`);
    process.exit(result.status ?? 1);
  }
}

console.log("\n[deploy-gate] PASS: backend deploy gate completed.");
