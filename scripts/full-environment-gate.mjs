#!/usr/bin/env node
// Intentionally strict local/CI confidence gate. Unlike deploy:gate, this
// command never silently skips database or browser proof: provision a fresh
// Supabase stack first, export its values, then run this command.
import { spawnSync } from "node:child_process";

const required = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL"];
const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length) {
  console.error(
    `[full-environment-gate] Missing required infrastructure: ${missing.join(", ")}. ` +
      "Run `supabase start`, export `supabase status -o env` into these names, then retry.",
  );
  process.exit(1);
}

const checks = [
  ["migrations", "npm", ["run", "migrate"]],
  ["migration safety", "npm", ["run", "audit:migrations"]],
  ["generated database types", "npm", ["run", "types:check"]],
  ["schema drift", "npm", ["run", "drift:check"]],
  ["RLS policy + atomic upload concurrency", "npm", ["run", "test:rls"]],
  ["audit chain verification", "npm", ["run", "audit:verify-chains"]],
  ["browser login/workspace/upload/underwriting/report flows", "npm", ["run", "test:e2e"]],
];

for (const [label, command, args] of checks) {
  console.log(`\n[full-environment-gate] ${label}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      SCHEMA_DRIFT_DATABASE_URL: process.env.SCHEMA_DRIFT_DATABASE_URL || process.env.DATABASE_URL,
      AUDIT_CHAIN_DATABASE_URL: process.env.AUDIT_CHAIN_DATABASE_URL || process.env.DATABASE_URL,
    },
  });
  if (result.status !== 0) {
    console.error(`[full-environment-gate] FAIL: ${label} exited ${result.status ?? "unknown"}.`);
    process.exit(result.status ?? 1);
  }
}

console.log(
  "\n[full-environment-gate] PASS: all database and browser confidence checks completed.",
);
