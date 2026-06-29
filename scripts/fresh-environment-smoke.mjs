import { spawnSync } from "node:child_process";

const steps = [
  ["typecheck", "npm", ["run", "typecheck"]],
  ["unit tests", "npm", ["run", "test"]],
  ["production build", "npm", ["run", "build"]],
];

if (process.env.FRESH_ENV_DATABASE_URL || process.env.DATABASE_URL) {
  steps.unshift(["migration dry-run", "npm", ["run", "migrate:dry-run"]]);
}

if (process.env.EPHEMERAL_DATABASE_URL || process.env.SUPABASE_TEST_DATABASE_URL) {
  steps.push(["ephemeral migration + RLS smoke", "npm", ["run", "smoke:ephemeral-db"]]);
}

function run(label, command, args) {
  console.log(`\n[fresh-env] ${label}`);
  const env = { ...process.env };
  const databaseUrl = process.env.FRESH_ENV_DATABASE_URL ?? process.env.DATABASE_URL;
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

console.log("[fresh-env] Starting fresh environment smoke.");
for (const [label, command, args] of steps) run(label, command, args);
console.log("\n[fresh-env] Smoke passed.");
