#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const migrationsDir = "supabase/migrations";

const dangerousPatterns = [
  { label: "drop table", pattern: /\bdrop\s+table\b/i },
  { label: "drop column", pattern: /\bdrop\s+column\b/i },
  { label: "truncate", pattern: /\btruncate\b/i },
  { label: "delete without explicit review", pattern: /\bdelete\s+from\b/i },
  { label: "alter type drop", pattern: /\balter\s+type\b[\s\S]*\bdrop\b/i },
];

const reviewMarker = /MIGRATION_SAFETY_REVIEW:/;

const files = (await readdir(migrationsDir)).filter((file) => /^\d{14}_.+\.sql$/.test(file)).sort();

const violations = [];
for (const file of files) {
  const path = join(migrationsDir, file);
  const text = await readFile(path, "utf8");
  for (const { label, pattern } of dangerousPatterns) {
    if (pattern.test(text) && !reviewMarker.test(text)) {
      violations.push(`${path}: ${label} requires MIGRATION_SAFETY_REVIEW.`);
    }
  }
}

if (violations.length) {
  for (const violation of violations) console.error(`[migration-safety] ${violation}`);
  process.exit(1);
}

console.log(`[migration-safety] ${files.length} migrations passed destructive-operation review.`);
