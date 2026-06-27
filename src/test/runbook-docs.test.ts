import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

describe("production runbook docs", () => {
  test("deployment docs link the migration recovery runbook and rollback example", () => {
    const deployment = readFileSync("DEPLOYMENT.md", "utf8");
    const runbook = readFileSync("docs/RUNBOOK.md", "utf8");
    const downExample = readFileSync(
      "docs/migration-rollbacks/20260627000100_audit_logs_append_only.down.sql",
      "utf8",
    );

    expect(deployment).toContain("docs/RUNBOOK.md");
    expect(runbook).toContain("Failed or Partial Migration");
    expect(runbook).toContain("Bad Successful Migration");
    expect(runbook).toContain("Supabase Backup and PITR");
    expect(runbook).toContain("Schema Drift Incident");
    expect(runbook).toContain("Predeploy Checklist");
    expect(runbook).toContain(
      "docs/migration-rollbacks/20260627000100_audit_logs_append_only.down.sql",
    );
    expect(downExample).toContain("DROP TRIGGER IF EXISTS audit_logs_append_only");
    expect(downExample).not.toContain("public.schema_migrations");
  });
});
