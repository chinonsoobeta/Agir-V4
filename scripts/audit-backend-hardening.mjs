#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const artifacts = [
  ".github/workflows/ci.yml",
  ".github/workflows/ops-scheduled.yml",
  "scripts/check-generated-types.mjs",
  "scripts/ensure-ephemeral-db.mjs",
  "scripts/extraction-worker.mjs",
  "scripts/extraction-worker-local-handler.mjs",
  "scripts/audit-migration-safety.mjs",
  "scripts/audit-service-role-usage.mjs",
  "scripts/audit-server-function-auth.mjs",
  "scripts/audit-idempotency.mjs",
  "scripts/audit-transaction-boundaries.mjs",
  "scripts/audit-event-coverage.mjs",
  "scripts/audit-db-indexes.mjs",
  "scripts/validate-env.mjs",
  "scripts/tenant-scale-load.mjs",
  "scripts/tenant-db-concurrency-smoke.mjs",
  "src/start.ts",
  "src/integrations/supabase/service-role.server.ts",
  "src/lib/backend-hardening-controls.ts",
  "src/lib/env.server.ts",
  "src/lib/health.server.ts",
  "src/lib/repositories/project-inputs.repository.ts",
  "supabase/migrations/20260630000200_backend_performance_indexes.sql",
  "docs/migration-rollbacks/20260630000200_backend_performance_indexes.down.sql",
];

const requiredScripts = [
  "backend:audit",
  "types:check",
  "audit:service-role",
  "audit:server-auth",
  "audit:idempotency",
  "audit:transactions",
  "audit:events",
  "audit:indexes",
  "audit:migrations",
  "env:validate",
  "load:tenant-scale",
  "load:tenant-db",
];

const failures = [];
for (const artifact of artifacts) {
  if (!existsSync(artifact)) failures.push(`Missing artifact: ${artifact}`);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
for (const script of requiredScripts) {
  if (!pkg.scripts?.[script]) failures.push(`Missing package script: ${script}`);
}

if (failures.length) {
  for (const failure of failures) console.error(`[backend-hardening] ${failure}`);
  process.exit(1);
}

console.log(
  `[backend-hardening] ${artifacts.length} artifacts and ${requiredScripts.length} scripts present.`,
);
