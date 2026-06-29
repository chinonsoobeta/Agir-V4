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
