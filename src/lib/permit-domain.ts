export const PERMIT_UNKNOWN_DURATION = "Processing duration: Not found in verified sources.";
export const PERMIT_UNKNOWN_REQUIREMENT =
  "Requirement status: Cannot be determined from the available project information.";

export type PermitFactKind =
  | "verified_source"
  | "analyst"
  | "extracted"
  | "reported"
  | "unknown"
  | "needs_review"
  | "not_applicable";
export type PermitApplicability =
  | "unknown"
  | "potentially_required"
  | "required"
  | "not_required"
  | "not_applicable"
  | "needs_review";

export function displayDuration(row: { processing_duration_text?: string | null }) {
  return row.processing_duration_text?.trim() || PERMIT_UNKNOWN_DURATION;
}
export function displayRequirement(row: { applicability_status: PermitApplicability }) {
  return row.applicability_status === "unknown"
    ? PERMIT_UNKNOWN_REQUIREMENT
    : row.applicability_status;
}
export function validatePermitFact(row: {
  processing_duration_days?: number | null;
  duration_source?: string | null;
  source_kind: PermitFactKind;
  required_reason?: string | null;
  notes?: string | null;
  is_required?: boolean | null;
  applicability_status: PermitApplicability;
}) {
  const errors: string[] = [];
  if (row.processing_duration_days != null && !row.duration_source)
    errors.push("A numeric duration requires a traceable source.");
  if (row.source_kind === "analyst" && !row.required_reason && !row.notes)
    errors.push("Analyst-provided facts require a reason or note.");
  if (
    row.is_required != null &&
    !(["required", "not_required"] as string[]).includes(row.applicability_status)
  )
    errors.push("Required state must agree with applicability.");
  return errors;
}
export function ruleMatchesMunicipality(
  rule: { jurisdiction_id: string },
  project: { jurisdiction_id?: string | null },
) {
  return !!project.jurisdiction_id && rule.jurisdiction_id === project.jurisdiction_id;
}
