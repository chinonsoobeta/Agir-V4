import { renderAuditExportCsv, type AuditExportEvent, type ComplianceControl } from "./compliance";

export type CustomerAuditPackageInput = {
  workspaceId: string;
  generatedAt: string;
  controls: ComplianceControl[];
  auditEvents: AuditExportEvent[];
  projects: Array<{ id: string; name: string; status?: string | null }>;
  documents: Array<{
    id: string;
    project_id: string | null;
    name: string;
    category?: string | null;
  }>;
  reports: Array<{ id: string; project_id: string; report_type: string; created_at: string }>;
  memoSnapshots: Array<{ id: string; project_id: string; version: number; content_hash: string }>;
};

export type CustomerAuditPackage = {
  manifest: {
    schema: "agir.customer-audit-package.v1";
    workspace_id: string;
    generated_at: string;
    counts: {
      controls: number;
      audit_events: number;
      projects: number;
      documents: number;
      reports: number;
      memo_snapshots: number;
    };
  };
  files: Record<string, string>;
};

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export function buildCustomerAuditPackage(input: CustomerAuditPackageInput): CustomerAuditPackage {
  const manifest = {
    schema: "agir.customer-audit-package.v1" as const,
    workspace_id: input.workspaceId,
    generated_at: input.generatedAt,
    counts: {
      controls: input.controls.length,
      audit_events: input.auditEvents.length,
      projects: input.projects.length,
      documents: input.documents.length,
      reports: input.reports.length,
      memo_snapshots: input.memoSnapshots.length,
    },
  };
  return {
    manifest,
    files: {
      "manifest.json": json(manifest),
      "controls.json": json(input.controls),
      "audit-log.csv": renderAuditExportCsv(input.auditEvents),
      "projects.json": json(input.projects),
      "documents.json": json(input.documents),
      "reports.json": json(input.reports),
      "memo-snapshots.json": json(input.memoSnapshots),
    },
  };
}

export type DealRunAuditPackageInput = {
  generatedAt: string;
  project: Record<string, unknown>;
  run: {
    id: string;
    run_number: number;
    run_mode: string;
    status: string;
    input_fingerprint: string;
    output_fingerprint?: string | null;
    accepted_defaults_used?: unknown;
    conflict_resolutions_used?: unknown;
  };
  approvedInputs: unknown[];
  defaultAcceptedInputs: unknown[];
  acceptedDefaults: unknown[];
  staticDefaultsUsed: unknown[];
  conflictResolutions: unknown[];
  outputs: unknown[];
  cashFlows: unknown[];
  reconciliationFlags: unknown[];
  risks: unknown[];
  memo: { id: string; status?: string | null; run_id?: string | null } | null;
  decision: { id: string; decision?: string | null; run_id?: string | null } | null;
  auditEvents: Array<{
    id: string;
    action: string;
    entity_type?: string | null;
    entity_id?: string | null;
    created_at?: string;
    payload?: unknown;
  }>;
};

export type DealRunAuditPackage = {
  manifest: {
    schema: "agir.deal-run-audit-package.v1";
    project_id: string | null;
    run_id: string;
    run_number: number;
    input_fingerprint: string;
    generated_at: string;
    counts: {
      approved_inputs: number;
      default_accepted_inputs: number;
      accepted_defaults: number;
      static_defaults_used: number;
      conflict_resolutions: number;
      outputs: number;
      cash_flows: number;
      reconciliation_flags: number;
      risks: number;
      audit_events: number;
    };
  };
  payload: {
    project: Record<string, unknown>;
    run: DealRunAuditPackageInput["run"];
    approved_inputs: unknown[];
    default_accepted_inputs: unknown[];
    accepted_defaults: unknown[];
    static_defaults_used: unknown[];
    conflict_resolutions: unknown[];
    outputs: unknown[];
    cash_flows: unknown[];
    reconciliation_flags: unknown[];
    risk_register: unknown[];
    memo: DealRunAuditPackageInput["memo"];
    ic_decision: DealRunAuditPackageInput["decision"];
    audit_events: DealRunAuditPackageInput["auditEvents"];
  };
};

export function buildDealRunAuditPackage(input: DealRunAuditPackageInput): DealRunAuditPackage {
  const projectId =
    typeof input.project.id === "string"
      ? input.project.id
      : typeof input.project.project_id === "string"
        ? input.project.project_id
        : null;
  return {
    manifest: {
      schema: "agir.deal-run-audit-package.v1",
      project_id: projectId,
      run_id: input.run.id,
      run_number: input.run.run_number,
      input_fingerprint: input.run.input_fingerprint,
      generated_at: input.generatedAt,
      counts: {
        approved_inputs: input.approvedInputs.length,
        default_accepted_inputs: input.defaultAcceptedInputs.length,
        accepted_defaults: input.acceptedDefaults.length,
        static_defaults_used: input.staticDefaultsUsed.length,
        conflict_resolutions: input.conflictResolutions.length,
        outputs: input.outputs.length,
        cash_flows: input.cashFlows.length,
        reconciliation_flags: input.reconciliationFlags.length,
        risks: input.risks.length,
        audit_events: input.auditEvents.length,
      },
    },
    payload: {
      project: input.project,
      run: input.run,
      approved_inputs: input.approvedInputs,
      default_accepted_inputs: input.defaultAcceptedInputs,
      accepted_defaults: input.acceptedDefaults,
      static_defaults_used: input.staticDefaultsUsed,
      conflict_resolutions: input.conflictResolutions,
      outputs: input.outputs,
      cash_flows: input.cashFlows,
      reconciliation_flags: input.reconciliationFlags,
      risk_register: input.risks,
      memo: input.memo,
      ic_decision: input.decision,
      audit_events: input.auditEvents,
    },
  };
}
