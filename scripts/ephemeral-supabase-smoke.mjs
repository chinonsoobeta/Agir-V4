import { spawnSync } from "node:child_process";

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
  return null;
}

function run(label, command, args, env) {
  console.log(`\n[ephemeral-db] ${label}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
  }
}

const resolved = resolveDatabaseUrl();
if (!resolved) {
  throw new Error(
    `Set one disposable database URL env var before running this smoke test: ${EPHEMERAL_URL_KEYS.join(", ")}`,
  );
}

const env = {
  ...process.env,
  DATABASE_URL: resolved.value,
  PGSSLMODE: process.env.PGSSLMODE ?? "disable",
};

console.log(`[ephemeral-db] Using ${resolved.key}; database name must satisfy the RLS test guard.`);
run("ensure disposable database exists", "node", ["scripts/ensure-ephemeral-db.mjs"], env);
run(
  "bootstrap Supabase-compatible auth/storage schemas",
  "node",
  ["src/test/rls/bootstrap-db.mjs"],
  env,
);
run("apply all migrations", "node", ["run_migrations.mjs"], env);
run("run live RLS policy suite", "npm", ["run", "test:rls"], env);
console.log("\n[ephemeral-db] Migration + RLS smoke test passed.");
