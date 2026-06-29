import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

describe("enterprise compliance contract", () => {
  test("migration adds governed request tracking and workspace audit scope", () => {
    const sql = read("supabase/migrations/20260629000200_enterprise_compliance_controls.sql");

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.data_governance_requests");
    expect(sql).toContain("ALTER TABLE public.audit_logs");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS workspace_id");
    expect(sql).toContain("public.workspace_role(workspace_id) IN ('owner', 'admin')");
    expect(sql).toContain('CREATE POLICY "data_governance_requests_member_select"');
    expect(sql).toContain('CREATE POLICY "audit_logs_insert_allowed"');
  });

  test("procurement and operating docs cover required external controls", () => {
    const docs = [
      "docs/compliance/readiness-gap-assessment.md",
      "docs/compliance/soc2/evidence-binder.md",
      "docs/compliance/data-governance.md",
      "docs/security/penetration-test-readiness.md",
      "docs/security/sso-scim.md",
      "docs/ops/incident-response.md",
      "docs/ops/on-call-sla.md",
      "docs/ops/disaster-recovery.md",
    ].map(read);
    const bundle = docs.join("\n");

    for (const phrase of [
      "SOC 2 Type II",
      "external penetration test",
      "SSO",
      "SCIM",
      "DPA",
      "RTO",
      "RPO",
      "status page",
      "post-incident",
      "Customer-managed keys",
    ]) {
      expect(bundle.toLowerCase()).toContain(phrase.toLowerCase());
    }
  });
});
