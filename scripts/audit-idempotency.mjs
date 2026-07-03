#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const requirements = [
  {
    file: "src/lib/extraction-jobs.server.ts",
    phrases: ["idempotency_key", 'eq("idempotency_key"', "claimJob"],
  },
  {
    file: "src/lib/documents.functions.ts",
    phrases: ["content_hash", "idempotencyKey", "claimJob"],
  },
  {
    file: "src/lib/underwriting.server.ts",
    phrases: ["stableJsonHash", "runKey", "idempotencyKey"],
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
  for (const failure of failures) console.error(`[idempotency-audit] ${failure}`);
  process.exit(1);
}

console.log(
  `[idempotency-audit] ${requirements.length} critical mutation paths have idempotency markers.`,
);
