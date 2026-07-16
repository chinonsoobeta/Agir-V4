import { existsSync, readFileSync } from "node:fs";

const requiredFiles = [
  "scripts/fresh-environment-smoke.mjs",
  "scripts/extraction-worker.mjs",
  "scripts/deploy-gate.mjs",
  "scripts/refresh-schema-cache.mjs",
  "scripts/verify-audit-chains.mjs",
  "scripts/enforce-data-governance.mjs",
  "docs/pilot/unsupervised-pilot-script.md",
  "docs/pilot/pilot-deal-packages.md",
  "docs/pilot/pilot-observation-scorecard.md",
  "docs/pilot/remediation-release-gate.md",
  "docs/pilot/remediation-implementation-report.md",
  "docs/pilot/phases-3-5-rollout-runbook.md",
  "docs/architecture/property-search-pagination.md",
  "docs/security/sso-scim.md",
  "docs/security/penetration-test-readiness.md",
  "docs/compliance/soc2/evidence-binder.md",
  "docs/ops/disaster-recovery.md",
  "docs/ops/incident-response.md",
  "docs/ops/on-call-sla.md",
  "docs/ops/backend-operational-hardening.md",
  "docs/permits/pilot-requirement-traceability.md",
  "docs/permits/ui-content-audit.md",
  "docs/permits/pilot-architecture-decisions.md",
  "docs/permits/pilot-operations-and-release-report.md",
  "src/lib/pilot-readiness.ts",
  "src/lib/customer-audit-package.ts",
  "src/lib/pilot-demo-packages.ts",
  "src/lib/rate-limit.server.ts",
  "src/lib/audit-chain-verifier.server.ts",
  "src/lib/compliance-enforcement.server.ts",
];

const requiredPhrases = {
  "docs/pilot/unsupervised-pilot-script.md": [
    "Create workspace",
    "Upload source documents",
    "Generate IC memo",
    "No investment decision",
  ],
  "docs/pilot/pilot-observation-scorecard.md": [
    "time-to-underwriting",
    "trust objection",
    "support intervention",
  ],
  "docs/security/penetration-test-readiness.md": ["RLS", "signed document URL", "Retest letter"],
  "docs/ops/disaster-recovery.md": ["RTO", "RPO", "npm run smoke:ephemeral-db"],
  "docs/ops/backend-operational-hardening.md": [
    "npm run deploy:gate",
    "npm run worker:extraction",
    "npm run audit:verify-chains",
    "npm run governance:enforce",
  ],
  "docs/pilot/remediation-release-gate.md": [
    "pilot_external_signoffs",
    "read-only keyset pagination",
    "An unfilled template is not approval evidence",
    "npm run pilot:gate",
    "npm run pilot:gate -- --full",
  ],
  "docs/architecture/property-search-pagination.md": [
    "read-only keyset pagination",
    "Current authorization wins",
    "does not present",
  ],
  "docs/pilot/phases-3-5-rollout-runbook.md": [
    "DOCUMENT_DELETION_WORKER_ENABLED",
    "Stop conditions",
    "forward-only",
  ],
};

const failures = [];
for (const path of requiredFiles) {
  if (!existsSync(path)) failures.push(`Missing required file: ${path}`);
}
for (const [path, phrases] of Object.entries(requiredPhrases)) {
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  for (const phrase of phrases) {
    if (!text.includes(phrase)) failures.push(`${path} is missing phrase: ${phrase}`);
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`[pilot-readiness] ${failure}`);
  process.exit(1);
}

console.log(`[pilot-readiness] ${requiredFiles.length} readiness artifacts present.`);
