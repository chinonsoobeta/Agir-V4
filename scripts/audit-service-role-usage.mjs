#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const roots = ["src"];
const allowed = new Set([
  "src/integrations/supabase/client.server.ts",
  "src/integrations/supabase/service-role.server.ts",
  "src/lib/documents.functions.ts",
  "src/lib/env.server.ts",
  "src/lib/health.server.ts",
  "src/lib/scim/supabase-store.server.ts",
  "src/lib/storage-download.server.ts",
  // Reviewed 2026-07-04: normalized underwriting run-history writes.
  // Server permission checks run before underwriting, and database triggers
  // verify run/project/owner consistency before each immutable history insert.
  "src/lib/underwriting.server.ts",
  // Reviewed 2026-07-02: extraction-worker execution endpoint. Disarmed (404)
  // without EXTRACTION_WORKER_TOKEN; constant-time token check; the job row is
  // re-read from the DB and execution is scoped to the job's owner_id.
  "src/routes/api/extraction/worker.ts",
]);
const patterns = [
  /supabaseAdmin\b/,
  /SUPABASE_SERVICE_ROLE_KEY\b/,
  /service_role\b/i,
  /getServiceRoleClient\b/,
];

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (path.includes("src/test/")) continue;
    if (entry.isDirectory()) result.push(...(await files(path)));
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) result.push(path);
  }
  return result;
}

const violations = [];
for (const root of roots) {
  for (const file of await files(root)) {
    const rel = relative(process.cwd(), file);
    if (rel === "src/integrations/supabase/types.ts") continue;
    const text = await readFile(file, "utf8");
    if (!patterns.some((pattern) => pattern.test(text))) continue;
    if (!allowed.has(rel)) violations.push(rel);
  }
}

if (violations.length) {
  for (const file of violations) {
    console.error(`[service-role-audit] unreviewed service-role usage: ${file}`);
  }
  process.exit(1);
}

console.log(`[service-role-audit] ${allowed.size} reviewed service-role entry points.`);
