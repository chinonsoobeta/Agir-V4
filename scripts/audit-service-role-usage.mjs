#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const roots = ["src"];
const allowed = new Set([
  "src/integrations/supabase/client.server.ts",
  "src/lib/documents.functions.ts",
  "src/lib/env.server.ts",
  "src/lib/health.server.ts",
  "src/lib/scim/supabase-store.server.ts",
  "src/lib/storage-download.server.ts",
]);
const patterns = [/supabaseAdmin\b/, /SUPABASE_SERVICE_ROLE_KEY\b/, /service_role\b/i];

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
