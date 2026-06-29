export type PilotReadinessId =
  | "fresh_environment_install"
  | "guided_pilot_mode"
  | "pilot_deal_packages"
  | "async_extraction_worker"
  | "pilot_readiness_checklist"
  | "production_sso_saml"
  | "scim_provisioning"
  | "third_party_pen_test"
  | "operational_trust_basics"
  | "disaster_recovery_drill"
  | "soc2_readiness"
  | "first_time_ui_clarity"
  | "customer_audit_package"
  | "real_document_corpus"
  | "unsupervised_pilot_observation";

export type PilotReadinessStatus =
  | "implemented"
  | "automated"
  | "ready_for_external_execution"
  | "external_required";

export type PilotReadinessControl = {
  id: PilotReadinessId;
  title: string;
  status: PilotReadinessStatus;
  owner: "product" | "engineering" | "security" | "operations" | "legal" | "external";
  evidence: string[];
  auditCommand?: string;
  externalDependency?: string;
};

export type PilotReadinessInput = {
  freshEnvSmoke: boolean;
  guidedPilotRunbook: boolean;
  pilotDealPackages: number;
  asyncWorkerScript: boolean;
  inAppReadinessChecklist: boolean;
  ssoSamlConfigured: boolean;
  scimConfigured: boolean;
  penTestReportReceived: boolean;
  statusPageConfigured: boolean;
  onCallRotationConfigured: boolean;
  drDrillCompleted: boolean;
  soc2ObservationStarted: boolean;
  uiClarityPass: boolean;
  customerAuditPackage: boolean;
  realDocumentCorpusCount: number;
  unsupervisedPilotObserved: boolean;
};

export type PilotReadinessSummary = Record<PilotReadinessStatus, number> & {
  scoreOutOfTen: number;
  readyForUnsupervisedPilot: boolean;
};

const packageStatus = (count: number): PilotReadinessStatus =>
  count >= 5 ? "implemented" : count >= 3 ? "automated" : "ready_for_external_execution";

const corpusStatus = (count: number): PilotReadinessStatus =>
  count >= 20 ? "implemented" : count >= 10 ? "automated" : "ready_for_external_execution";

export function buildPilotReadiness(input: PilotReadinessInput): PilotReadinessControl[] {
  return [
    {
      id: "fresh_environment_install",
      title: "Fresh environment install and reset smoke",
      status: input.freshEnvSmoke ? "automated" : "ready_for_external_execution",
      owner: "engineering",
      evidence: ["scripts/fresh-environment-smoke.mjs", "npm run smoke:fresh-env"],
      auditCommand: "npm run smoke:fresh-env",
    },
    {
      id: "guided_pilot_mode",
      title: "Guided pilot workflow",
      status: input.guidedPilotRunbook ? "implemented" : "ready_for_external_execution",
      owner: "product",
      evidence: ["docs/pilot/unsupervised-pilot-script.md", "Settings readiness controls"],
    },
    {
      id: "pilot_deal_packages",
      title: "Polished pilot deal packages",
      status: packageStatus(input.pilotDealPackages),
      owner: "product",
      evidence: ["src/lib/pilot-demo-packages.ts", "docs/pilot/pilot-deal-packages.md"],
    },
    {
      id: "async_extraction_worker",
      title: "Async extraction worker path",
      status: input.asyncWorkerScript ? "automated" : "ready_for_external_execution",
      owner: "engineering",
      evidence: ["scripts/extraction-worker.mjs", "src/lib/extraction-jobs.server.ts"],
      auditCommand: "npm run worker:extraction -- --dry-run",
    },
    {
      id: "pilot_readiness_checklist",
      title: "Pilot readiness checklist",
      status: input.inAppReadinessChecklist ? "implemented" : "ready_for_external_execution",
      owner: "product",
      evidence: ["src/lib/pilot-readiness.ts", "docs/pilot/unsupervised-pilot-script.md"],
    },
    {
      id: "production_sso_saml",
      title: "Production SSO/SAML path",
      status: input.ssoSamlConfigured ? "implemented" : "ready_for_external_execution",
      owner: "security",
      evidence: ["docs/security/sso-scim.md", "workspace compliance settings"],
      externalDependency: input.ssoSamlConfigured
        ? undefined
        : "Customer IdP metadata and auth provider setup",
    },
    {
      id: "scim_provisioning",
      title: "SCIM provisioning path",
      status: input.scimConfigured ? "implemented" : "ready_for_external_execution",
      owner: "security",
      evidence: ["docs/security/sso-scim.md", "workspace compliance settings"],
      externalDependency: input.scimConfigured ? undefined : "IdP SCIM app and provisioning token",
    },
    {
      id: "third_party_pen_test",
      title: "Third-party penetration test",
      status: input.penTestReportReceived ? "implemented" : "external_required",
      owner: "external",
      evidence: ["docs/security/penetration-test-readiness.md"],
      externalDependency: input.penTestReportReceived
        ? undefined
        : "External security firm report and retest letter",
    },
    {
      id: "operational_trust_basics",
      title: "Status page, alerting, on-call, incident process",
      status:
        input.statusPageConfigured && input.onCallRotationConfigured
          ? "implemented"
          : "ready_for_external_execution",
      owner: "operations",
      evidence: ["docs/ops/on-call-sla.md", "docs/ops/incident-response.md"],
      externalDependency:
        input.statusPageConfigured && input.onCallRotationConfigured
          ? undefined
          : "Status page and paging provider",
    },
    {
      id: "disaster_recovery_drill",
      title: "Tested DR restore drill",
      status: input.drDrillCompleted ? "implemented" : "ready_for_external_execution",
      owner: "operations",
      evidence: ["docs/ops/disaster-recovery.md", "scripts/restore-staging-from-backup.mjs"],
      auditCommand: "npm run restore:drill",
      externalDependency: input.drDrillCompleted ? undefined : "Production-like backup target",
    },
    {
      id: "soc2_readiness",
      title: "SOC 2 readiness and observation",
      status: input.soc2ObservationStarted ? "ready_for_external_execution" : "external_required",
      owner: "external",
      evidence: ["docs/compliance/soc2/evidence-binder.md"],
      externalDependency: "Compliance automation plus external auditor observation window",
    },
    {
      id: "first_time_ui_clarity",
      title: "First-time professional UI clarity",
      status: input.uiClarityPass ? "implemented" : "ready_for_external_execution",
      owner: "product",
      evidence: ["docs/pilot/unsupervised-pilot-script.md"],
    },
    {
      id: "customer_audit_package",
      title: "One-click customer audit package",
      status: input.customerAuditPackage ? "implemented" : "ready_for_external_execution",
      owner: "product",
      evidence: ["src/lib/customer-audit-package.ts"],
    },
    {
      id: "real_document_corpus",
      title: "Expanded real/anonymized document corpus",
      status: corpusStatus(input.realDocumentCorpusCount),
      owner: "product",
      evidence: ["src/test/extraction-corpus.test.ts", "src/test/fixtures"],
      externalDependency:
        input.realDocumentCorpusCount >= 20
          ? undefined
          : "More anonymized customer-style documents",
    },
    {
      id: "unsupervised_pilot_observation",
      title: "Observed unsupervised pilot",
      status: input.unsupervisedPilotObserved ? "implemented" : "ready_for_external_execution",
      owner: "product",
      evidence: ["docs/pilot/pilot-observation-scorecard.md"],
      externalDependency: input.unsupervisedPilotObserved
        ? undefined
        : "Professional pilot participant",
    },
  ];
}

export function summarizePilotReadiness(controls: PilotReadinessControl[]): PilotReadinessSummary {
  const summary = controls.reduce(
    (acc, control) => {
      acc[control.status] += 1;
      return acc;
    },
    {
      implemented: 0,
      automated: 0,
      ready_for_external_execution: 0,
      external_required: 0,
      scoreOutOfTen: 0,
      readyForUnsupervisedPilot: false,
    },
  );
  const weighted =
    summary.implemented * 1 +
    summary.automated * 0.9 +
    summary.ready_for_external_execution * 0.65 +
    summary.external_required * 0.25;
  summary.scoreOutOfTen = Math.round((weighted / controls.length) * 100) / 10;
  summary.readyForUnsupervisedPilot =
    summary.external_required <= 2 &&
    controls
      .filter((control) =>
        [
          "fresh_environment_install",
          "guided_pilot_mode",
          "pilot_deal_packages",
          "pilot_readiness_checklist",
          "customer_audit_package",
        ].includes(control.id),
      )
      .every((control) => control.status !== "external_required");
  return summary;
}

export const DEFAULT_PILOT_READINESS_INPUT: PilotReadinessInput = {
  freshEnvSmoke: true,
  guidedPilotRunbook: true,
  pilotDealPackages: 5,
  asyncWorkerScript: true,
  inAppReadinessChecklist: true,
  ssoSamlConfigured: false,
  scimConfigured: false,
  penTestReportReceived: false,
  statusPageConfigured: false,
  onCallRotationConfigured: false,
  drDrillCompleted: false,
  soc2ObservationStarted: false,
  uiClarityPass: true,
  customerAuditPackage: true,
  realDocumentCorpusCount: 10,
  unsupervisedPilotObserved: false,
};
