export const PERMIT_UNKNOWN_DURATION = "Timeline not available yet.";
export const PERMIT_UNKNOWN_REQUIREMENT = "Not enough information to decide yet.";

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

export type PermitMentionCandidate = {
  candidateName: string;
  permitType: string;
  sourceLocation: string;
  sourceText: string;
};

export type PermitResearchCandidate = PermitMentionCandidate & {
  evidenceKind: "explicit_permit_mention" | "work_scope_signal";
  confidenceScore: number;
  description: string;
};

/** Categorize the permit phrase that is actually present in the source. This
 * is a display/workflow category only. It never infers applicability. */
export function classifyExplicitPermitMention(text: string): string {
  const value = text.toLowerCase();
  const categories: Array<[string, RegExp]> = [
    ["demolition", /\b(demolition|demolish)\b/],
    ["tenant_improvement", /\b(tenant improvement|tenant fit[ -]?out)\b/],
    ["occupancy_change_of_use", /\b(occupancy|occupant load|change of (use|occupancy))\b/],
    ["fire_life_safety", /\b(fire|life safety|sprinkler)\b/],
    ["electrical", /\b(electrical|wiring|electrical service)\b/],
    ["plumbing", /\b(plumbing|sewer|water service)\b/],
    ["mechanical_hvac", /\b(mechanical|hvac|heating|ventilation|gas)\b/],
    ["excavation_shoring_servicing", /\b(excavat|shoring|servicing)\w*\b/],
    ["zoning_land_use", /\b(zoning|rezoning|land[ -]?use|variance)\b/],
    ["development", /\bdevelopment\b/],
    ["heritage", /\bheritage\b/],
    ["environmental_site", /\b(environmental|soil|remediation|riparian)\b/],
    ["tree", /\b(tree|arborist)\b/],
    ["building", /\b(building|construction)\b/],
  ];
  return categories.find(([, pattern]) => pattern.test(value))?.[0] ?? "other";
}

/** Conservative document classifier: returns exact, review-only mentions of
 * permits/approvals/certificates. It does not infer applicability, authority,
 * duration, or permit type. */
export function extractExplicitPermitMentions(text: string): PermitMentionCandidate[] {
  const lines = text
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.replace(/\s+/g, " ").trim(), index: index + 1 }))
    .filter(({ line }) => line.length >= 8 && line.length <= 1_500)
    .filter(({ line }) => /\b(permit|approval|certificate|licen[cs]e)\b/i.test(line));
  const seen = new Set<string>();
  const candidates: PermitMentionCandidate[] = [];
  for (const { line, index } of lines) {
    const normalized = line.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const match = line.match(
      /(?:[A-Za-z][A-Za-z/&()' -]{0,70}\s)?(?:permit|approval|certificate|licen[cs]e)/i,
    );
    candidates.push({
      candidateName: (match?.[0] ?? "Permit or approval mention").trim().slice(0, 250),
      permitType: classifyExplicitPermitMention(line),
      sourceLocation: `line ${index}`,
      sourceText: line.slice(0, 10_000),
    });
    if (candidates.length >= 50) break;
  }
  return candidates;
}

const WORK_SCOPE_SIGNALS: Array<{
  permitType: string;
  label: string;
  pattern: RegExp;
}> = [
  {
    permitType: "demolition",
    label: "Demolition permit or approval",
    pattern: /\b(demolish|demolition|remove (the )?(entire )?(building|structure))\b/i,
  },
  {
    permitType: "tenant_improvement",
    label: "Tenant improvement permit or approval",
    pattern: /\b(tenant improvement|tenant fit[ -]?out|commercial fit[ -]?out)\b/i,
  },
  {
    permitType: "occupancy_change_of_use",
    label: "Occupancy or change-of-use approval",
    pattern: /\b(change of (use|occupancy)|occupancy classification|occupant load)\b/i,
  },
  {
    permitType: "fire_life_safety",
    label: "Fire or life-safety approval",
    pattern: /\b(fire alarm|fire separation|fire suppression|sprinkler|life safety)\b/i,
  },
  {
    permitType: "electrical",
    label: "Electrical permit or approval",
    pattern: /\b(electrical|wiring|breaker|service panel|distribution panel|circuit)\b/i,
  },
  {
    permitType: "plumbing",
    label: "Plumbing permit or approval",
    pattern:
      /\b(plumbing|water line|water service|sanitary sewer|drainage pipe|plumbing fixture)\b/i,
  },
  {
    permitType: "mechanical_hvac",
    label: "Mechanical or HVAC permit",
    pattern: /\b(hvac|heat pump|furnace|ventilation|ductwork|gas appliance|mechanical system)\b/i,
  },
  {
    permitType: "excavation_shoring_servicing",
    label: "Excavation, shoring, or servicing approval",
    pattern: /\b(excavation|excavate|shoring|site servicing|utility servicing)\b/i,
  },
  {
    permitType: "zoning_land_use",
    label: "Zoning or land-use approval",
    pattern: /\b(rezoning|zoning variance|development variance|land[ -]?use change)\b/i,
  },
  {
    permitType: "heritage",
    label: "Heritage approval",
    pattern: /\b(heritage building|heritage alteration|heritage designation)\b/i,
  },
  {
    permitType: "environmental_site",
    label: "Environmental or site approval",
    pattern: /\b(contaminated soil|site remediation|riparian|environmental assessment)\b/i,
  },
  {
    permitType: "tree",
    label: "Tree permit or approval",
    pattern: /\b(tree removal|remove (a |the )?tree|protected tree)\b/i,
  },
  {
    permitType: "building",
    label: "Building permit",
    pattern:
      /\b(load[ -]?bearing|structural wall|new foundation|building addition|new building|framing)\b/i,
  },
];

/** Build review-only candidates from exact permit language and explicit work
 * scope. A work clue suggests where to look; it is never a requirement. */
export function extractPermitResearchCandidates(text: string): PermitResearchCandidate[] {
  const explicit = extractExplicitPermitMentions(text).map((candidate) => ({
    ...candidate,
    evidenceKind: "explicit_permit_mention" as const,
    confidenceScore: 0.75,
    description: "The source explicitly mentions this permit or approval.",
  }));
  const seenTypes = new Set(explicit.map((candidate) => candidate.permitType));
  const lines = text
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.replace(/\s+/g, " ").trim(), index: index + 1 }))
    .filter(({ line }) => line.length >= 8 && line.length <= 1_500);
  const signals: PermitResearchCandidate[] = [];
  for (const signal of WORK_SCOPE_SIGNALS) {
    if (seenTypes.has(signal.permitType)) continue;
    const source = lines.find(({ line }) => signal.pattern.test(line));
    if (!source) continue;
    signals.push({
      candidateName: signal.label,
      permitType: signal.permitType,
      sourceLocation: `line ${source.index}`,
      sourceText: source.line.slice(0, 10_000),
      evidenceKind: "work_scope_signal",
      confidenceScore: 0.55,
      description:
        "The source describes related work. Review the current authority source before deciding whether an approval applies.",
    });
  }
  return [...explicit, ...signals].slice(0, 50);
}
