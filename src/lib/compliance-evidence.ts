export type EvidenceStatus = "current" | "due_soon" | "missing";

export type ComplianceEvidenceItem = {
  id: string;
  title: string;
  status: EvidenceStatus;
  evidence: string | null;
  observedAt: string | null;
  expiresAt: string | null;
  daysUntilExpiry: number | null;
  action: string;
};

export type ComplianceEvidenceInput = {
  ssoProvider: string | null;
  ssoMetadataUrl: string | null;
  scimEnabled: boolean;
  dpaStatus: "not_started" | "in_review" | "approved";
  soc2ObservationStartedAt: string | null;
  lastPenTestAt: string | null;
  lastDrTestAt: string | null;
  onCallRotationUrl: string | null;
  statusPageUrl: string | null;
  now?: string;
};

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function item(input: {
  id: string;
  title: string;
  evidence: string | null;
  observedAt: string | null;
  validityDays: number | null;
  action: string;
  now: Date;
}): ComplianceEvidenceItem {
  const observed = input.observedAt ? new Date(input.observedAt) : null;
  const expires = observed && input.validityDays ? addDays(observed, input.validityDays) : null;
  const daysUntilExpiry = expires
    ? Math.ceil((expires.getTime() - input.now.getTime()) / 86_400_000)
    : null;
  const status: EvidenceStatus =
    !input.evidence || !input.observedAt
      ? "missing"
      : daysUntilExpiry != null && daysUntilExpiry <= 30
        ? "due_soon"
        : "current";
  return {
    id: input.id,
    title: input.title,
    status,
    evidence: input.evidence,
    observedAt: input.observedAt,
    expiresAt: expires?.toISOString() ?? null,
    daysUntilExpiry,
    action: input.action,
  };
}

export function buildComplianceEvidence(input: ComplianceEvidenceInput): ComplianceEvidenceItem[] {
  const now = new Date(input.now ?? new Date().toISOString());
  return [
    item({
      id: "sso_saml",
      title: "SSO/SAML configuration",
      evidence: input.ssoProvider && input.ssoMetadataUrl ? input.ssoProvider : null,
      observedAt:
        input.ssoProvider && input.ssoMetadataUrl ? (input.now ?? now.toISOString()) : null,
      validityDays: 365,
      action: "Connect customer IdP metadata and verify enforcement policy.",
      now,
    }),
    item({
      id: "scim",
      title: "SCIM provisioning",
      evidence: input.scimEnabled ? "SCIM enabled" : null,
      observedAt: input.scimEnabled ? (input.now ?? now.toISOString()) : null,
      validityDays: 365,
      action: "Enable SCIM and validate user lifecycle provisioning.",
      now,
    }),
    item({
      id: "dpa",
      title: "DPA approval",
      evidence: input.dpaStatus === "approved" ? "DPA approved" : null,
      observedAt: input.dpaStatus === "approved" ? (input.now ?? now.toISOString()) : null,
      validityDays: 365,
      action: "Move DPA to approved after counsel/customer sign-off.",
      now,
    }),
    item({
      id: "soc2",
      title: "SOC 2 observation",
      evidence: input.soc2ObservationStartedAt ? "Observation window started" : null,
      observedAt: input.soc2ObservationStartedAt,
      validityDays: 180,
      action: "Start or refresh auditor observation evidence.",
      now,
    }),
    item({
      id: "pen_test",
      title: "Third-party penetration test",
      evidence: input.lastPenTestAt ? "Pen-test report recorded" : null,
      observedAt: input.lastPenTestAt,
      validityDays: 365,
      action: "Upload/record latest clean report and retest letter.",
      now,
    }),
    item({
      id: "dr_drill",
      title: "DR restore drill",
      evidence: input.lastDrTestAt ? "DR drill recorded" : null,
      observedAt: input.lastDrTestAt,
      validityDays: 180,
      action: "Run restore drill and record RTO/RPO result.",
      now,
    }),
    item({
      id: "on_call",
      title: "On-call and status page",
      evidence:
        input.onCallRotationUrl && input.statusPageUrl
          ? "Rotation and status page configured"
          : null,
      observedAt:
        input.onCallRotationUrl && input.statusPageUrl ? (input.now ?? now.toISOString()) : null,
      validityDays: 90,
      action: "Configure staffed rotation and public/private status page.",
      now,
    }),
  ];
}
