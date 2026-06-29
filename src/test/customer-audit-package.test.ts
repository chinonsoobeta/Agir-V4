import { describe, expect, test } from "vitest";
import { buildCustomerAuditPackage } from "@/lib/customer-audit-package";
import type { ComplianceControl } from "@/lib/compliance";

const controls: ComplianceControl[] = [
  {
    id: "audit_log_export",
    title: "Customer audit-log export",
    owner: "product",
    status: "implemented",
    evidence: ["Append-only audit log"],
  },
];

describe("customer audit package", () => {
  test("builds a deterministic manifest and complete file set", () => {
    const pkg = buildCustomerAuditPackage({
      workspaceId: "00000000-0000-0000-0000-000000000001",
      generatedAt: "2026-06-29T12:00:00.000Z",
      controls,
      auditEvents: [
        {
          id: "evt-1",
          created_at: "2026-06-29T12:00:00.000Z",
          workspace_id: "00000000-0000-0000-0000-000000000001",
          project_id: null,
          user_id: "user-1",
          entity_type: "workspace_compliance",
          entity_id: "00000000-0000-0000-0000-000000000001",
          action: "customer_audit_package_exported",
          payload: { note: 'quoted "value"', rows: 1 },
        },
      ],
      projects: [{ id: "project-1", name: "Pilot Deal", status: "underwriting" }],
      documents: [{ id: "doc-1", project_id: "project-1", name: "OM.pdf", category: "om" }],
      reports: [
        {
          id: "report-1",
          project_id: "project-1",
          report_type: "investor",
          created_at: "2026-06-29T12:01:00.000Z",
        },
      ],
      memoSnapshots: [
        { id: "snapshot-1", project_id: "project-1", version: 1, content_hash: "hash-1" },
      ],
    });

    expect(pkg.manifest).toEqual({
      schema: "agir.customer-audit-package.v1",
      workspace_id: "00000000-0000-0000-0000-000000000001",
      generated_at: "2026-06-29T12:00:00.000Z",
      counts: {
        controls: 1,
        audit_events: 1,
        projects: 1,
        documents: 1,
        reports: 1,
        memo_snapshots: 1,
      },
    });
    expect(Object.keys(pkg.files).sort()).toEqual([
      "audit-log.csv",
      "controls.json",
      "documents.json",
      "manifest.json",
      "memo-snapshots.json",
      "projects.json",
      "reports.json",
    ]);
    expect(JSON.parse(pkg.files["manifest.json"])).toEqual(pkg.manifest);
    expect(pkg.files["audit-log.csv"]).toContain(
      "id,created_at,workspace_id,project_id,user_id,entity_type,entity_id,action,payload",
    );
    expect(pkg.files["audit-log.csv"]).toContain("quoted");
    expect(pkg.files["audit-log.csv"]).toContain("value");
    expect(pkg.files["audit-log.csv"]).toContain('""rows"":1');
  });
});
