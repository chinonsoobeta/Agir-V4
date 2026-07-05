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
    output_fingerprint: string | null;
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
  validation: DealRunAuditPackageValidation;
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

export type DealRunAuditPackageValidationCheck = {
  name: string;
  status: "passed" | "failed";
  message: string;
  counts?: Record<string, number>;
};

export type DealRunAuditPackageValidation = {
  status: "passed" | "failed";
  checked_at: string;
  run_id: string;
  input_fingerprint: string;
  output_fingerprint: string | null;
  checks: DealRunAuditPackageValidationCheck[];
};

function rowRunId(row: unknown): string | null {
  if (typeof row !== "object" || row == null) return null;
  const value = (row as { run_id?: unknown }).run_id;
  return typeof value === "string" ? value : null;
}

function runIdCheck(
  name: string,
  rows: unknown[],
  expectedRunId: string,
): DealRunAuditPackageValidationCheck {
  const mismatched = rows.filter((row) => rowRunId(row) !== expectedRunId).length;
  return {
    name,
    status: mismatched === 0 ? "passed" : "failed",
    message:
      mismatched === 0
        ? `All ${rows.length} row(s) match run ${expectedRunId}.`
        : `${mismatched} of ${rows.length} row(s) do not match run ${expectedRunId}.`,
    counts: { rows: rows.length, mismatched },
  };
}

function optionalRunIdCheck(
  name: string,
  row: { run_id?: string | null } | null,
  expectedRunId: string,
): DealRunAuditPackageValidationCheck {
  if (!row) {
    return {
      name,
      status: "passed",
      message: "No row exists for this package.",
      counts: { rows: 0, mismatched: 0 },
    };
  }
  const mismatched = row.run_id !== expectedRunId ? 1 : 0;
  return {
    name,
    status: mismatched === 0 ? "passed" : "failed",
    message:
      mismatched === 0
        ? `Row matches run ${expectedRunId}.`
        : `Row run id ${row.run_id ?? "missing"} does not match run ${expectedRunId}.`,
    counts: { rows: 1, mismatched },
  };
}

function fingerprintCheck(
  name: string,
  manifestValue: string | null,
  exportedValue: string | null,
): DealRunAuditPackageValidationCheck {
  const passed = manifestValue === exportedValue;
  return {
    name,
    status: passed ? "passed" : "failed",
    message: passed
      ? "Exported fingerprint matches the manifest."
      : "Exported fingerprint does not match the manifest.",
  };
}

function completedOutputsCheck(
  status: string,
  outputs: unknown[],
  cashFlows: unknown[],
): DealRunAuditPackageValidationCheck {
  const completed = status === "completed";
  const missingOutputs = completed && outputs.length === 0 ? 1 : 0;
  const missingCashFlows = completed && cashFlows.length === 0 ? 1 : 0;
  const failed = missingOutputs + missingCashFlows;
  return {
    name: "completed_run_required_outputs_present",
    status: failed === 0 ? "passed" : "failed",
    message:
      failed === 0
        ? "Completed run has required output and cash-flow arrays."
        : "Completed run is missing required output or cash-flow rows.",
    counts: {
      outputs: outputs.length,
      cash_flows: cashFlows.length,
      missing_required_arrays: failed,
    },
  };
}

export function validateDealRunAuditPackage(
  pkg: Omit<DealRunAuditPackage, "validation">,
): DealRunAuditPackageValidation {
  const manifest = pkg.manifest;
  const exportedInputFingerprint = pkg.payload.run.input_fingerprint;
  const exportedOutputFingerprint = pkg.payload.run.output_fingerprint ?? null;
  const checks: DealRunAuditPackageValidationCheck[] = [
    runIdCheck("financial_outputs_match_manifest_run", pkg.payload.outputs, manifest.run_id),
    runIdCheck("cash_flows_match_manifest_run", pkg.payload.cash_flows, manifest.run_id),
    runIdCheck(
      "reconciliation_flags_match_manifest_run",
      pkg.payload.reconciliation_flags,
      manifest.run_id,
    ),
    runIdCheck("risk_rows_match_manifest_run", pkg.payload.risk_register, manifest.run_id),
    fingerprintCheck(
      "input_fingerprint_matches_manifest",
      manifest.input_fingerprint,
      exportedInputFingerprint,
    ),
    fingerprintCheck(
      "output_fingerprint_matches_manifest",
      manifest.output_fingerprint,
      exportedOutputFingerprint,
    ),
    optionalRunIdCheck("memo_matches_manifest_run", pkg.payload.memo, manifest.run_id),
    optionalRunIdCheck(
      "ic_decision_matches_manifest_run",
      pkg.payload.ic_decision,
      manifest.run_id,
    ),
    completedOutputsCheck(pkg.payload.run.status, pkg.payload.outputs, pkg.payload.cash_flows),
  ];
  return {
    status: checks.every((check) => check.status === "passed") ? "passed" : "failed",
    checked_at: manifest.generated_at,
    run_id: manifest.run_id,
    input_fingerprint: manifest.input_fingerprint,
    output_fingerprint: manifest.output_fingerprint,
    checks,
  };
}

export function assertDealRunAuditPackageValid(pkg: DealRunAuditPackage): void {
  if (pkg.validation.status === "passed") return;
  const failures = pkg.validation.checks
    .filter((check) => check.status === "failed")
    .map((check) => `${check.name}: ${check.message}`)
    .join("; ");
  throw new Error(`Audit package validation failed: ${failures}`);
}

export function buildDealRunAuditPackage(input: DealRunAuditPackageInput): DealRunAuditPackage {
  const projectId =
    typeof input.project.id === "string"
      ? input.project.id
      : typeof input.project.project_id === "string"
        ? input.project.project_id
        : null;
  const manifest = {
    schema: "agir.deal-run-audit-package.v1" as const,
    project_id: projectId,
    run_id: input.run.id,
    run_number: input.run.run_number,
    input_fingerprint: input.run.input_fingerprint,
    output_fingerprint: input.run.output_fingerprint ?? null,
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
  };
  const payload = {
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
  };
  const draft = { manifest, payload };
  return {
    ...draft,
    validation: validateDealRunAuditPackage(draft),
  };
}
