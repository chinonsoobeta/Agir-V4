#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const root = "src/lib";
const publicExamples = new Set(["src/lib/api/example.functions.ts"]);

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else if (entry.name.endsWith(".functions.ts")) result.push(path);
  }
  return result;
}

const violations = [];
for (const file of await files(root)) {
  const rel = relative(process.cwd(), file);
  const text = await readFile(file, "utf8");
  if (!text.includes("createServerFn")) continue;
  if (publicExamples.has(rel)) continue;
  if (
    !text.includes("requireSupabaseAuth") ||
    !text.includes(".middleware([requireSupabaseAuth])")
  ) {
    violations.push(rel);
  }
}

if (violations.length) {
  for (const file of violations) {
    console.error(
      `[server-auth-audit] server functions need requireSupabaseAuth middleware: ${file}`,
    );
  }
  process.exit(1);
}

console.log("[server-auth-audit] all non-public server function modules require Supabase auth.");
