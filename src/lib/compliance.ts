export type ComplianceControlId =
  | "soc2_type_ii"
  | "third_party_pen_test"
  | "role_permission_ui"
  | "sso_saml"
  | "scim_provisioning"
  | "audit_log_export"
  | "data_governance"
  | "incident_response"
  | "on_call_sla"
  | "disaster_recovery"
  | "dpa"
  | "tenant_encryption";

export type ComplianceControlStatus = "implemented" | "ready_for_vendor" | "external_required";

export type ComplianceControl = {
  id: ComplianceControlId;
  title: string;
  owner: "product" | "security" | "operations" | "legal" | "external";
  status: ComplianceControlStatus;
  evidence: string[];
  externalDependency?: string;
};

export type ComplianceReadinessInput = {
  rolePermissionUi: boolean;
  ssoSamlConfigured: boolean;
  scimConfigured: boolean;
  auditLogExport: boolean;
  dataGovernanceWorkflow: boolean;
  incidentRunbook: boolean;
  onCallRotation: boolean;
  disasterRecoveryDrill: boolean;
  dpaApproved: boolean;
  tenantEncryptionAvailable: boolean;
  soc2ObservationStarted: boolean;
  penTestCompleted: boolean;
};

export type AuditExportEvent = {
  id: string;
  created_at: string;
  project_id: string | null;
  workspace_id?: string | null;
  user_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  payload?: unknown;
};

const csvCell = (value: unknown): string => {
  if (value == null) return "";
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  // Quoting alone does not stop spreadsheet formula evaluation on CSV import.
  // Preserve audit evidence as text even when an action or identifier begins
  // with a formula sigil.
  const safe = /^[\t\r\n ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
};

export function renderAuditExportCsv(events: AuditExportEvent[]): string {
  const header = [
    "id",
    "created_at",
    "workspace_id",
    "project_id",
    "user_id",
    "entity_type",
    "entity_id",
    "action",
    "payload",
  ];
  const rows = events.map((event) =>
    [
      event.id,
      event.created_at,
      event.workspace_id ?? "",
      event.project_id ?? "",
      event.user_id ?? "",
      event.entity_type,
      event.entity_id ?? "",
      event.action,
      event.payload ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

export function buildComplianceReadiness(input: ComplianceReadinessInput): ComplianceControl[] {
  return [
    {
      id: "role_permission_ui",
      title: "Role and permission administration",
      owner: "product",
      status: input.rolePermissionUi ? "implemented" : "external_required",
      evidence: ["Settings team/member administration", "Workspace role matrix tests"],
    },
    {
      id: "sso_saml",
      title: "SSO/SAML configuration",
      owner: "security",
      status: input.ssoSamlConfigured ? "implemented" : "ready_for_vendor",
      evidence: ["Workspace SSO configuration record", "SSO/SCIM runbook"],
      externalDependency: input.ssoSamlConfigured ? undefined : "Identity-provider metadata",
    },
    {
      id: "scim_provisioning",
      title: "SCIM provisioning",
      owner: "security",
      status: input.scimConfigured ? "implemented" : "ready_for_vendor",
      evidence: ["SCIM enablement flag", "Provisioning runbook"],
      externalDependency: input.scimConfigured ? undefined : "SCIM token exchange and IdP app",
    },
    {
      id: "audit_log_export",
      title: "Customer audit-log export",
      owner: "product",
      status: input.auditLogExport ? "implemented" : "external_required",
      evidence: ["Append-only audit log", "Workspace CSV export"],
    },
    {
      id: "data_governance",
      title: "Data governance requests",
      owner: "operations",
      status: input.dataGovernanceWorkflow ? "implemented" : "external_required",
      evidence: ["Retention policy", "Data request tracking table"],
    },
    {
      id: "incident_response",
      title: "Incident response runbook",
      owner: "operations",
      status: input.incidentRunbook ? "implemented" : "external_required",
      evidence: ["Severity matrix", "Post-incident review template"],
    },
    {
      id: "on_call_sla",
      title: "On-call rotation and SLA",
      owner: "operations",
      status: input.onCallRotation ? "implemented" : "ready_for_vendor",
      evidence: ["On-call policy", "SLA/SLO draft"],
      externalDependency: input.onCallRotation ? undefined : "Paging vendor and staffed rotation",
    },
    {
      id: "disaster_recovery",
      title: "Disaster recovery drill",
      owner: "operations",
      status: input.disasterRecoveryDrill ? "implemented" : "ready_for_vendor",
      evidence: ["RTO/RPO policy", "Restore drill evidence template"],
      externalDependency: input.disasterRecoveryDrill
        ? undefined
        : "Production backup restore drill",
    },
    {
      id: "dpa",
      title: "DPA and security exhibit",
      owner: "legal",
      status: input.dpaApproved ? "implemented" : "ready_for_vendor",
      evidence: ["DPA review status", "Data governance policy"],
      externalDependency: input.dpaApproved ? undefined : "Counsel-approved customer terms",
    },
    {
      id: "tenant_encryption",
      title: "Tenant encryption posture",
      owner: "security",
      status: input.tenantEncryptionAvailable ? "implemented" : "ready_for_vendor",
      evidence: ["Encryption configuration", "Customer-managed key decision record"],
      externalDependency: input.tenantEncryptionAvailable
        ? undefined
        : "KMS/provider architecture decision",
    },
    {
      id: "soc2_type_ii",
      title: "SOC 2 Type II",
      owner: "external",
      status: input.soc2ObservationStarted ? "ready_for_vendor" : "external_required",
      evidence: ["SOC 2 evidence binder", "Control owner matrix"],
      externalDependency: "Vanta/Drata plus external auditor observation window",
    },
    {
      id: "third_party_pen_test",
      title: "Third-party penetration test",
      owner: "external",
      status: input.penTestCompleted ? "implemented" : "ready_for_vendor",
      evidence: ["Pen-test readiness checklist", "Remediation tracker"],
      externalDependency: input.penTestCompleted ? undefined : "External penetration-testing firm",
    },
  ];
}

export function complianceSummary(controls: ComplianceControl[]) {
  return controls.reduce(
    (summary, control) => {
      summary[control.status] += 1;
      return summary;
    },
    { implemented: 0, ready_for_vendor: 0, external_required: 0 },
  );
}
