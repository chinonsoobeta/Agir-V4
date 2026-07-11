#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";

const status = execFileSync("supabase", ["status", "-o", "env"], { encoding: "utf8" });
const local = Object.fromEntries(
  status
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Z_]+)="(.*)"$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2]]),
);
for (const required of ["API_URL", "ANON_KEY", "SERVICE_ROLE_KEY", "DB_URL"]) {
  if (!local[required]) throw new Error(`Local Supabase status omitted ${required}.`);
}
const env = {
  ...process.env,
  SUPABASE_URL: local.API_URL,
  SUPABASE_ANON_KEY: local.ANON_KEY,
  SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY ?? local.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
  VITE_SUPABASE_URL: local.API_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY ?? local.ANON_KEY,
  DATABASE_URL: local.DB_URL,
  PGSSLMODE: "disable",
};
const result = spawnSync("npm", ["run", "dev"], { stdio: "inherit", env });
process.exit(result.status ?? 1);
