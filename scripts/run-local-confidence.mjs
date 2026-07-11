#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from "node:child_process";

const status = execFileSync("supabase", ["status", "-o", "env"], { encoding: "utf8" });
const local = Object.fromEntries(
  status
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Z_]+)="(.*)"$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2]]),
);
for (const required of ["API_URL", "DB_URL", "ANON_KEY", "SERVICE_ROLE_KEY"]) {
  if (!local[required]) throw new Error(`Local Supabase status omitted ${required}.`);
}
const env = {
  ...process.env,
  SUPABASE_URL: local.API_URL,
  SUPABASE_ANON_KEY: local.ANON_KEY,
  SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY ?? local.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
  VITE_SUPABASE_URL: local.API_URL,
  VITE_SUPABASE_ANON_KEY: local.ANON_KEY,
  VITE_SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY ?? local.ANON_KEY,
  DATABASE_URL: local.DB_URL,
  SCHEMA_DRIFT_DATABASE_URL: local.DB_URL,
  AUDIT_CHAIN_DATABASE_URL: local.DB_URL,
  PGSSLMODE: "disable",
  E2E_BASE_URL: "http://127.0.0.1:8081",
  E2E_WEB_SERVER_CMD: "npm run dev",
  E2E_REUSE_EXISTING_SERVER: "1",
  EXTRACTION_WORKER_TOKEN: "local-confidence-worker-token",
  EXTRACTION_WORKER_POLL_MS: "250",
};

function run(label, command, args) {
  console.log(`\n[local-confidence] ${label}`);
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.status !== 0) throw new Error(`${label} failed (${result.status ?? "unknown"}).`);
}

run("restore local demo user", "node", ["scripts/ensure-demo-user.mjs"]);
run("generated types", "npm", ["run", "types:check"]);
run("schema drift", "npm", ["run", "drift:check"]);
run("audit chains", "npm", ["run", "audit:verify-chains"]);
console.log("\n[local-confidence] start extraction/verification worker");
const app = spawn("npm", ["run", "dev"], { stdio: "inherit", env });
async function waitForApp() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(env.E2E_BASE_URL);
      if (response.ok) return;
    } catch {
      // Startup connection failures are expected until Vite is listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Local Agir preview did not become ready within 60 seconds.");
}
await waitForApp();
const worker = spawn("npm", ["run", "worker:extraction"], { stdio: "inherit", env });
try {
  run("authenticated browser flows", "npm", ["run", "test:e2e"]);
} finally {
  worker.kill("SIGTERM");
  app.kill("SIGTERM");
}
console.log("\n[local-confidence] PASS");
