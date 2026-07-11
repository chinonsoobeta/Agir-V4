#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const requirements = [
  {
    file: "src/lib/extraction-jobs.server.ts",
    phrases: ["idempotency_key", 'eq("idempotency_key"', "claimJob"],
  },
  {
    file: "src/lib/documents.functions.ts",
    phrases: ["content_hash", "idempotencyKey", "claimJob", "enqueue_document_verification"],
  },
  {
    file: "supabase/migrations/20260710000100_async_document_verification.sql",
    phrases: [
      "uq_extraction_jobs_pending_upload_verification",
      "pg_advisory_xact_lock",
      "lease_owner <> p_worker_id",
    ],
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
