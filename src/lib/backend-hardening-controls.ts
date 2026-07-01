export type BackendHardeningControl = {
  id: string;
  title: string;
  status: "enforced" | "operationalized";
  artifacts: readonly string[];
};

export const BACKEND_HARDENING_CONTROLS = [
  {
    id: "csrf-server-functions",
    title: "CSRF protection for TanStack server functions",
    status: "enforced",
    artifacts: ["src/start.ts", "src/test/backend-operational-hardening.test.ts"],
  },
  {
    id: "ephemeral-supabase-ci",
    title: "Mandatory ephemeral Supabase/RLS CI",
    status: "enforced",
    artifacts: [
      ".github/workflows/ci.yml",
      "scripts/ensure-ephemeral-db.mjs",
      "scripts/ephemeral-supabase-smoke.mjs",
    ],
  },
  {
    id: "migration-safety",
    title: "Forward-only migration destructive-operation audit",
    status: "enforced",
    artifacts: ["scripts/audit-migration-safety.mjs", "scripts/deploy-gate.mjs"],
  },
  {
    id: "generated-types-drift",
    title: "Generated Supabase types drift gate",
    status: "enforced",
    artifacts: [".github/workflows/ci.yml", "scripts/check-generated-types.mjs"],
  },
  {
    id: "worker-execution",
    title: "Queue-backed worker execution contract",
    status: "enforced",
    artifacts: ["scripts/extraction-worker.mjs", "scripts/extraction-worker-local-handler.mjs"],
  },
  {
    id: "job-lease-recovery",
    title: "Job lease recovery and dead-letter proof",
    status: "enforced",
    artifacts: [
      "supabase/migrations/20260630000100_backend_operational_hardening.sql",
      "src/test/backend-operational-hardening.test.ts",
    ],
  },
  {
    id: "db-index-audit",
    title: "High-volume database index audit",
    status: "enforced",
    artifacts: [
      "supabase/migrations/20260630000200_backend_performance_indexes.sql",
      "scripts/audit-db-indexes.mjs",
    ],
  },
  {
    id: "service-role-inventory",
    title: "Capability-scoped service-role usage inventory",
    status: "enforced",
    artifacts: [
      "src/integrations/supabase/service-role.server.ts",
      "scripts/audit-service-role-usage.mjs",
    ],
  },
  {
    id: "server-function-permissions",
    title: "Server-function permission contract",
    status: "enforced",
    artifacts: ["scripts/audit-server-function-auth.mjs"],
  },
  {
    id: "mutation-idempotency",
    title: "Critical mutation idempotency contract",
    status: "enforced",
    artifacts: ["scripts/audit-idempotency.mjs"],
  },
  {
    id: "transaction-boundaries",
    title: "Transactional write-boundary contract",
    status: "enforced",
    artifacts: ["scripts/audit-transaction-boundaries.mjs"],
  },
  {
    id: "audit-event-coverage",
    title: "Structured audit-event coverage",
    status: "enforced",
    artifacts: ["scripts/audit-event-coverage.mjs", "src/lib/audit.server.ts"],
  },
  {
    id: "restore-drill-schedule",
    title: "Scheduled backup/restore verification",
    status: "operationalized",
    artifacts: [".github/workflows/ops-scheduled.yml", "scripts/restore-staging-from-backup.mjs"],
  },
  {
    id: "health-check-depth",
    title: "Production health checks beyond uptime",
    status: "enforced",
    artifacts: ["src/routes/api/health.ts", "src/lib/health.server.ts"],
  },
  {
    id: "typed-repositories",
    title: "Typed backend repository boundaries",
    status: "enforced",
    artifacts: ["src/lib/repositories/project-inputs.repository.ts"],
  },
  {
    id: "env-validation",
    title: "Deployment-mode environment validation",
    status: "enforced",
    artifacts: ["src/lib/env.server.ts", "scripts/validate-env.mjs"],
  },
  {
    id: "tenant-scale-load",
    title: "Tenant-scale backend load harness",
    status: "enforced",
    artifacts: ["scripts/tenant-scale-load.mjs", "scripts/tenant-db-concurrency-smoke.mjs"],
  },
] as const satisfies readonly BackendHardeningControl[];
