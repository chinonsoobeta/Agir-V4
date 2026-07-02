import { isAiAssistedReasoning } from "./ai-authority";

export type StatusSeverity = "neutral" | "info" | "success" | "warning" | "danger";
export type StatusDomain = "document" | "extractionJob" | "assumption" | "underwriting" | "report";

export type StatusConfig = {
  key: string;
  label: string;
  severity: StatusSeverity;
  message: string;
  actions?: string[];
  icon?: string;
};

const unknownStatus = (key: string): StatusConfig => ({
  key,
  label: humanize(key),
  severity: "neutral",
  message: "Status recorded by the workflow.",
  icon: "Circle",
});

export const STATUS_TAXONOMY: Record<StatusDomain, Record<string, StatusConfig>> = {
  document: {
    uploaded: {
      key: "uploaded",
      label: "Uploaded",
      severity: "info",
      message: "Document is available for extraction.",
      actions: ["extract"],
      icon: "FileText",
    },
    processing: {
      key: "processing",
      label: "Processing",
      severity: "info",
      message: "Document text or metadata is being processed.",
      actions: ["wait", "cancel"],
      icon: "RefreshCw",
    },
    analyzed: {
      key: "analyzed",
      label: "Analyzed",
      severity: "success",
      message: "Document analysis completed.",
      actions: ["review"],
      icon: "CheckCircle2",
    },
    extraction_failed: {
      key: "extraction_failed",
      label: "Extraction failed",
      severity: "danger",
      message: "Extraction failed and needs retry or manual review.",
      actions: ["retry", "review"],
      icon: "AlertCircle",
    },
    rejected: {
      key: "rejected",
      label: "Rejected",
      severity: "danger",
      message: "Document was rejected by quality or policy checks.",
      actions: ["replace"],
      icon: "ShieldAlert",
    },
  },
  extractionJob: {
    queued: {
      key: "queued",
      label: "Queued",
      severity: "neutral",
      message: "Job is waiting for a worker.",
      actions: ["cancel"],
      icon: "Clock",
    },
    running: {
      key: "running",
      label: "Running",
      severity: "info",
      message: "Job is in progress.",
      actions: ["cancel"],
      icon: "RefreshCw",
    },
    completed: {
      key: "completed",
      label: "Completed",
      severity: "success",
      message: "Job completed successfully.",
      icon: "CheckCircle2",
    },
    failed: {
      key: "failed",
      label: "Failed",
      severity: "danger",
      message: "Job failed and should be retried or inspected.",
      actions: ["retry"],
      icon: "AlertCircle",
    },
    canceled: {
      key: "canceled",
      label: "Canceled",
      severity: "warning",
      message: "Job was canceled before completion.",
      actions: ["retry"],
      icon: "Ban",
    },
    dead_lettered: {
      key: "dead_lettered",
      label: "Dead-lettered",
      severity: "danger",
      message: "Job exceeded retry policy and needs operator review.",
      actions: ["inspect", "requeue"],
      icon: "ShieldAlert",
    },
  },
  assumption: {
    extracted: {
      key: "extracted",
      label: "Extracted",
      severity: "info",
      message: "Candidate is extracted but not approved for underwriting.",
      actions: ["approve", "modify", "reject"],
      icon: "FileSearch",
    },
    conflicting: {
      key: "conflicting",
      label: "Conflict",
      severity: "danger",
      message: "Multiple documented values disagree; resolve before underwriting.",
      actions: ["resolve"],
      icon: "AlertTriangle",
    },
    approved: {
      key: "approved",
      label: "Approved",
      severity: "success",
      message: "Approved for deterministic underwriting.",
      actions: ["modify"],
      icon: "CheckCircle2",
    },
    modified: {
      key: "modified",
      label: "Overridden",
      severity: "warning",
      message: "Manually overridden; review provenance and approval state.",
      actions: ["history"],
      icon: "Pencil",
    },
    default_accepted: {
      key: "default_accepted",
      label: "Default accepted",
      severity: "warning",
      message: "Static default accepted for underwriting.",
      actions: ["modify"],
      icon: "SlidersHorizontal",
    },
    calculated: {
      key: "calculated",
      label: "Calculated",
      severity: "success",
      message: "Calculated deterministically from approved inputs.",
      icon: "Calculator",
    },
    missing: {
      key: "missing",
      label: "Missing",
      severity: "neutral",
      message: "Required value is not available.",
      actions: ["add"],
      icon: "CircleHelp",
    },
    rejected: {
      key: "rejected",
      label: "Rejected",
      severity: "danger",
      message: "Candidate is excluded from underwriting.",
      actions: ["history"],
      icon: "XCircle",
    },
    pending: {
      key: "pending",
      label: "Pending",
      severity: "warning",
      message: "Awaiting analyst review.",
      actions: ["review"],
      icon: "Clock",
    },
    needs_review: {
      key: "needs_review",
      label: "Needs review",
      severity: "warning",
      message: "Requires analyst review before underwriting.",
      actions: ["review"],
      icon: "AlertCircle",
    },
  },
  underwriting: {
    ready: {
      key: "ready",
      label: "Ready",
      severity: "success",
      message: "Approved/default-accepted inputs are sufficient to run underwriting.",
      actions: ["run"],
      icon: "PlayCircle",
    },
    blocked: {
      key: "blocked",
      label: "Blocked",
      severity: "danger",
      message: "Missing or conflicting inputs block deterministic underwriting.",
      actions: ["resolve"],
      icon: "Lock",
    },
    completed: {
      key: "completed",
      label: "Completed",
      severity: "success",
      message: "Deterministic underwriting completed.",
      actions: ["export", "memo"],
      icon: "CheckCircle2",
    },
    needs_review: {
      key: "needs_review",
      label: "Needs review",
      severity: "warning",
      message: "Outputs include reconciliation warnings or review flags.",
      actions: ["review"],
      icon: "AlertTriangle",
    },
  },
  report: {
    generated: {
      key: "generated",
      label: "Generated",
      severity: "success",
      message: "Report generated and provenance checks passed.",
      actions: ["download"],
      icon: "FileCheck2",
    },
    generated_deterministic: {
      key: "generated_deterministic",
      label: "Generated deterministic",
      severity: "success",
      message: "Report generated from deterministic template.",
      actions: ["download"],
      icon: "FileCheck2",
    },
    needs_review: {
      key: "needs_review",
      label: "Needs review",
      severity: "warning",
      message: "Report contains numeric provenance warnings.",
      actions: ["review"],
      icon: "AlertTriangle",
    },
    failed: {
      key: "failed",
      label: "Failed",
      severity: "danger",
      message: "Report/export failed.",
      actions: ["retry"],
      icon: "AlertCircle",
    },
  },
};

export function statusConfig(domain: StatusDomain, key: string | null | undefined): StatusConfig {
  const normalized = key || "unknown";
  return STATUS_TAXONOMY[domain][normalized] ?? unknownStatus(normalized);
}

export function statusClassName(severity: StatusSeverity) {
  switch (severity) {
    case "success":
      return "bg-success/15 text-success border-success/30";
    case "warning":
      return "bg-warning/15 text-warning border-warning/30";
    case "danger":
      return "bg-destructive/15 text-destructive border-destructive/30";
    case "info":
      return "bg-primary/15 text-primary border-primary/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export function confidenceLabel(score?: number | null, band?: string | null) {
  if (score == null || !Number.isFinite(Number(score))) return "No confidence";
  const pct = Math.round(Number(score));
  const normalizedBand = band && band !== "missing" ? humanize(band) : null;
  return normalizedBand ? `${pct}% · ${normalizedBand}` : `${pct}%`;
}

export function assumptionApprovedForUnderwriting(row: {
  status?: string | null;
  dual_control_pending?: boolean | null;
}) {
  return (
    !row.dual_control_pending &&
    ["approved", "modified", "default_accepted", "calculated"].includes(row.status ?? "")
  );
}

export function assumptionProvenance(row: {
  status?: string | null;
  source?: string | null;
  source_location?: string | null;
  source_text?: string | null;
  ai_reasoning?: string | null;
  formula_text?: string | null;
  override_reason?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  dual_control_pending?: boolean | null;
  documents?: { name?: string | null } | null;
}) {
  const status = row.status ?? "unknown";
  const source = row.source ?? "";
  let sourceType:
    | "ai_assisted"
    | "extracted"
    | "calculated"
    | "defaulted"
    | "manual"
    | "conflict"
    | "missing"
    | "unknown" = "unknown";

  if (isAiAssistedReasoning(row.ai_reasoning)) sourceType = "ai_assisted";
  else if (status === "calculated" || source === "calculated" || row.formula_text)
    sourceType = "calculated";
  else if (status === "default_accepted" || source === "default") sourceType = "defaulted";
  else if (status === "modified" || source === "analyst" || row.override_reason)
    sourceType = "manual";
  else if (status === "conflicting") sourceType = "conflict";
  else if (status === "missing") sourceType = "missing";
  else if (row.source_location || row.source_text || row.documents?.name || status === "extracted")
    sourceType = "extracted";

  const labels: Record<typeof sourceType, string> = {
    ai_assisted: "AI-assisted candidate",
    extracted: "Document extraction",
    calculated: "Calculated",
    defaulted: "Static default",
    manual: "Manual override",
    conflict: "Conflict",
    missing: "Missing",
    unknown: "Unknown source",
  };

  return {
    sourceType,
    label: labels[sourceType],
    detail:
      row.documents?.name ??
      row.source_location ??
      row.source_text?.slice(0, 120) ??
      row.formula_text ??
      row.override_reason ??
      "Not available",
    approvedForUnderwriting: assumptionApprovedForUnderwriting(row),
    approvalLabel: row.dual_control_pending
      ? "Dual control pending"
      : assumptionApprovedForUnderwriting(row)
        ? "Approved for engine"
        : "Review only",
  };
}

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
