import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { RATE_LIMIT_POLICY } from "@/lib/rate-limit.server";
import { buildErrorEvent, buildMetricEvent, classifyError } from "@/lib/observability.server";
import { BACKEND_HARDENING_CONTROLS } from "@/lib/backend-hardening-controls";
import { SERVICE_ROLE_CAPABILITIES } from "@/integrations/supabase/service-role.server";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("backend operational hardening contract", () => {
  test("queue migration adds leases, heartbeats, cancellation, and dead-lettering", () => {
    const sql = read("supabase/migrations/20260630000100_backend_operational_hardening.sql");
    expect(sql).toContain("claim_next_extraction_job");
    expect(sql).toContain("heartbeat_extraction_job");
    expect(sql).toContain("request_extraction_job_cancellation");
    expect(sql).toContain("lease_expires_at");
    expect(sql).toContain("dead_lettered");
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
  });

  test("worker uses the database queue contract instead of local ad hoc locking", () => {
    const worker = read("scripts/extraction-worker.mjs");
    expect(worker).toContain("claim_next_extraction_job");
    expect(worker).toContain("heartbeat_extraction_job");
    expect(worker).toContain("EXTRACTION_WORKER_LEASE_SECONDS");
    expect(worker).toContain("cancellation_requested");
  });

  test("rate limits cover expensive backend surfaces", () => {
    expect(Object.keys(RATE_LIMIT_POLICY).sort()).toEqual([
      "chat_completion",
      "document_analysis",
      "document_upload",
      "report_generation",
      "scim_operation",
      "signed_document_url",
      "underwriting_run",
      "workspace_invitation",
    ]);
    for (const policy of Object.values(RATE_LIMIT_POLICY)) {
      expect(policy.maxEvents).toBeGreaterThan(0);
      expect(policy.windowSeconds).toBeGreaterThan(0);
      expect(policy.description).not.toEqual("");
    }
  });

  test("deploy and compliance scripts are registered", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["deploy:gate"]).toBe("node scripts/deploy-gate.mjs");
    expect(pkg.scripts["pilot:gate"]).toBe("node scripts/pilot-confidence-gate.mjs");
    expect(pkg.scripts["audit:migrations"]).toBe("node scripts/audit-migration-safety.mjs");
    expect(pkg.scripts["smoke:ensure-ephemeral-db"]).toBe("node scripts/ensure-ephemeral-db.mjs");
    expect(pkg.scripts["schema:refresh-cache"]).toBe("node scripts/refresh-schema-cache.mjs");
    expect(pkg.scripts["audit:verify-chains"]).toBe("node scripts/verify-audit-chains.mjs");
    expect(pkg.scripts["governance:enforce"]).toBe("node scripts/enforce-data-governance.mjs");
    expect(pkg.scripts["governance:dry-run"]).toContain("--dry-run");
    expect(pkg.scripts["load:tenant-db"]).toBe("node scripts/tenant-db-concurrency-smoke.mjs");
  });

  test("deploy gate runs the backend institutional gate stack", () => {
    const gate = read("scripts/deploy-gate.mjs");
    const pilotGate = read("scripts/pilot-confidence-gate.mjs");
    const refresh = read("scripts/refresh-schema-cache.mjs");
    expect(gate).toContain("audit-migration-safety.mjs");
    expect(gate).toContain("types:check");
    expect(gate).toContain("backend:audit");
    expect(gate).toContain("lint");
    expect(gate).toContain("TENANT_DB_LOAD_DATABASE_URL");
    expect(gate).toContain("DEPLOY_GATE_E2E");
    expect(gate).toContain("schema:refresh-cache");
    expect(pilotGate).toContain("backend:audit");
    expect(pilotGate).toContain("migration safety audit");
    expect(pilotGate).toContain("pilot-blocking");
    expect(refresh).toContain("notify pgrst, 'reload schema'");
  });

  test("TanStack server functions are protected by CSRF middleware", () => {
    const start = read("src/start.ts");
    expect(start).toContain("createCsrfMiddleware");
    expect(start).toContain('ctx.handlerType === "serverFn"');
    expect(start).toContain("requestMiddleware: [csrfMiddleware, errorMiddleware]");
  });

  test("ephemeral RLS smoke creates only guarded disposable databases", () => {
    const ensureDb = read("scripts/ensure-ephemeral-db.mjs");
    const smoke = read("scripts/ephemeral-supabase-smoke.mjs");
    expect(ensureDb).toContain("assertTestDatabase");
    expect(ensureDb).toContain("create database");
    expect(smoke).toContain("ensure-ephemeral-db.mjs");
  });

  test("service-role access is capability-scoped", () => {
    const serviceRole = read("src/integrations/supabase/service-role.server.ts");
    const audit = read("scripts/audit-service-role-usage.mjs");
    expect(Object.keys(SERVICE_ROLE_CAPABILITIES).sort()).toEqual([
      "audit_chain_verification",
      "compliance_enforcement",
      "demo_seed",
      "document_ingestion_worker",
      "document_storage_recovery",
      "document_upload_finalization",
      "extraction_worker",
      "run_history_write",
      "schema_maintenance",
      "scim_provisioning",
    ]);
    expect(serviceRole).toContain("x-agir-service-role-capability");
    expect(audit).toContain("service-role.server.ts");
    expect(audit).toContain("getServiceRoleClient");
  });

  test("audit-chain and governance evidence tables are present", () => {
    const sql = read("supabase/migrations/20260630000100_backend_operational_hardening.sql");
    expect(sql).toContain("audit_chain_verifications");
    expect(sql).toContain("compliance_enforcement_runs");
    expect(sql).toContain("rate_limit_events");
  });

  test("destructive underwriting compatibility RPC is tenant-authorized", () => {
    const sql = read(
      "supabase/migrations/20260706000100_add_profiles_policies_and_fk_constraints.sql",
    );
    expect(sql).toContain("MIGRATION_SAFETY_REVIEW:");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.delete_underwriting_outputs");
    expect(sql).toContain("auth.uid() IS NULL");
    expect(sql).toContain("p.id = p_project_id");
    expect(sql).toContain("p.owner_id = auth.uid()");
    expect(sql).toContain("public.workspace_role(p.workspace_id)");
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.delete_underwriting_outputs(UUID) FROM PUBLIC",
    );
  });

  test("new rollback docs faithfully narrow restored permissions", () => {
    const runHistoryRollback = read(
      "docs/migration-rollbacks/20260704000200_lock_run_history_insert_integrity.down.sql",
    );
    const rpcRollback = read(
      "docs/migration-rollbacks/20260705000100_underwriting_run_transaction_rpc.down.sql",
    );
    expect(runHistoryRollback).toContain("run_financial_outputs_validate_insert");
    expect(runHistoryRollback).toContain('CREATE POLICY "run_financial_outputs_insert_allowed"');
    expect(runHistoryRollback).not.toContain("FOR ALL TO authenticated");
    expect(rpcRollback).toContain(
      "DROP FUNCTION IF EXISTS public.persist_underwriting_run_transaction",
    );
    expect(rpcRollback).not.toContain("GRANT UPDATE ON public.underwriting_runs");
    expect(rpcRollback).not.toContain('CREATE POLICY "underwriting_runs_all"');
  });

  test("operational metrics have a stable structured event shape", () => {
    const metric = buildMetricEvent("job.completed", 1, { jobId: "job-1" });
    expect(metric.level).toBe("metric");
    expect(metric.service).toBe("agir");
    expect(metric.name).toBe("job.completed");
    expect(metric.value).toBe(1);
    expect(metric.jobId).toBe("job-1");
  });

  test("server observability includes request ids and stable error categories", () => {
    const event = buildErrorEvent(new Error("Supabase relation missing"), { requestId: "req-1" });
    expect(event.requestId).toBe("req-1");
    expect(event.category).toBe("database");
    expect(classifyError(new Error("Origin check failed"))).toBe("csrf");
  });

  test("governance and restore scripts verify retention, deletion, storage refs, and audit hashes", () => {
    const governance = read("scripts/enforce-data-governance.mjs");
    const restore = read("scripts/restore-staging-from-backup.mjs");
    expect(governance).toContain("overdueDeletionRequests");
    expect(governance).toContain("missingStorageRefs");
    expect(governance).toContain("missingGovernedTables");
    expect(restore).toContain("storageReferences");
    expect(restore).toContain("auditHashCoverage");
    expect(restore).toContain("audit_chain_verifications");
  });

  test("backend hardening registry covers the 9-out-of-10 controls", () => {
    const ids = BACKEND_HARDENING_CONTROLS.map((control) => control.id);
    expect(ids).toContain("csrf-server-functions");
    expect(ids).toContain("migration-safety");
    expect(ids).toContain("service-role-inventory");
    expect(ids).toContain("tenant-scale-load");
    expect(BACKEND_HARDENING_CONTROLS).toHaveLength(17);
  });
});
