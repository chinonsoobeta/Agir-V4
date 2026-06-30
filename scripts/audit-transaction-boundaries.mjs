#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const requirements = [
  {
    file: "run_migrations.mjs",
    phrases: [
      'await client.query("BEGIN")',
      'await client.query("COMMIT")',
      'await client.query("ROLLBACK")',
    ],
  },
  {
    file: "src/test/rls/workspace-policies.rls.ts",
    phrases: [
      'await client.query("BEGIN")',
      'await client.query("COMMIT")',
      'await client.query("ROLLBACK")',
    ],
  },
];

const failures = [];
for (const requirement of requirements) {
  const text = await readFile(requirement.file, "utf8");
  for (const phrase of requirement.phrases) {
    if (!text.includes(phrase)) failures.push(`${requirement.file} is missing ${phrase}`);
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`[transaction-audit] ${failure}`);
  process.exit(1);
}

console.log(
  "[transaction-audit] migration and live-RLS harness writes retain transaction boundaries.",
);
