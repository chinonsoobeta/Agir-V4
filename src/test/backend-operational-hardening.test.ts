import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { RATE_LIMIT_POLICY } from "@/lib/rate-limit.server";
import { buildMetricEvent } from "@/lib/observability.server";

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
      "document_analysis",
      "document_upload",
      "report_generation",
      "signed_document_url",
      "underwriting_run",
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
    expect(pkg.scripts["schema:refresh-cache"]).toBe("node scripts/refresh-schema-cache.mjs");
    expect(pkg.scripts["audit:verify-chains"]).toBe("node scripts/verify-audit-chains.mjs");
    expect(pkg.scripts["governance:enforce"]).toBe("node scripts/enforce-data-governance.mjs");
    expect(pkg.scripts["governance:dry-run"]).toContain("--dry-run");
  });

  test("deploy gate refreshes the PostgREST schema cache when armed", () => {
    const gate = read("scripts/deploy-gate.mjs");
    const refresh = read("scripts/refresh-schema-cache.mjs");
    expect(gate).toContain("schema:refresh-cache");
    expect(refresh).toContain("notify pgrst, 'reload schema'");
  });

  test("audit-chain and governance evidence tables are present", () => {
    const sql = read("supabase/migrations/20260630000100_backend_operational_hardening.sql");
    expect(sql).toContain("audit_chain_verifications");
    expect(sql).toContain("compliance_enforcement_runs");
    expect(sql).toContain("rate_limit_events");
  });

  test("operational metrics have a stable structured event shape", () => {
    const metric = buildMetricEvent("job.completed", 1, { jobId: "job-1" });
    expect(metric.level).toBe("metric");
    expect(metric.service).toBe("agir");
    expect(metric.name).toBe("job.completed");
    expect(metric.value).toBe(1);
    expect(metric.jobId).toBe("job-1");
  });
});
