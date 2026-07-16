import { describe, expect, test } from "vitest";
import {
  buildComplianceReadiness,
  complianceSummary,
  renderAuditExportCsv,
} from "@/lib/compliance";

describe("enterprise compliance readiness model", () => {
  test("separates in-product controls from vendor/legal/auditor dependencies", () => {
    const controls = buildComplianceReadiness({
      rolePermissionUi: true,
      ssoSamlConfigured: false,
      scimConfigured: false,
      auditLogExport: true,
      dataGovernanceWorkflow: true,
      incidentRunbook: true,
      onCallRotation: false,
      disasterRecoveryDrill: false,
      dpaApproved: false,
      tenantEncryptionAvailable: false,
      soc2ObservationStarted: false,
      penTestCompleted: false,
    });

    expect(controls.find((control) => control.id === "role_permission_ui")?.status).toBe(
      "implemented",
    );
    expect(controls.find((control) => control.id === "audit_log_export")?.status).toBe(
      "implemented",
    );
    expect(controls.find((control) => control.id === "soc2_type_ii")?.externalDependency).toContain(
      "external auditor",
    );
    expect(controls.find((control) => control.id === "third_party_pen_test")?.status).toBe(
      "ready_for_vendor",
    );
    expect(complianceSummary(controls)).toEqual({
      implemented: 4,
      ready_for_vendor: 7,
      external_required: 1,
    });
  });

  test("renders audit exports as CSV without losing JSON payload detail", () => {
    const csv = renderAuditExportCsv([
      {
        id: "evt-1",
        created_at: "2026-06-29T12:00:00.000Z",
        workspace_id: "ws-1",
        project_id: null,
        user_id: "user-1",
        entity_type: "workspace_compliance",
        entity_id: "ws-1",
        action: "audit_log_exported",
        payload: { rows: 12, note: 'quoted "value"' },
      },
    ]);

    expect(csv.split("\n")[0]).toBe(
      "id,created_at,workspace_id,project_id,user_id,entity_type,entity_id,action,payload",
    );
    expect(csv).toContain('"workspace_compliance"');
    expect(csv).toContain('""rows"":12');
    expect(csv).toContain("quoted");
    expect(csv).toContain("value");
  });

  test("renders formula-like audit text as literal spreadsheet text", () => {
    const csv = renderAuditExportCsv([
      {
        id: "=cmd()",
        created_at: "2026-06-29T12:00:00.000Z",
        project_id: null,
        user_id: null,
        entity_type: "audit",
        entity_id: null,
        action: "@SUM(1,1)",
      },
    ]);
    expect(csv).toContain("'=cmd()");
    expect(csv).toContain("'@SUM(1,1)");
  });
});
