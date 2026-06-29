import { existsSync, readFileSync } from "node:fs";

const requiredFiles = [
  "scripts/fresh-environment-smoke.mjs",
  "scripts/extraction-worker.mjs",
  "docs/pilot/unsupervised-pilot-script.md",
  "docs/pilot/pilot-deal-packages.md",
  "docs/pilot/pilot-observation-scorecard.md",
  "docs/security/sso-scim.md",
  "docs/security/penetration-test-readiness.md",
  "docs/compliance/soc2/evidence-binder.md",
  "docs/ops/disaster-recovery.md",
  "docs/ops/incident-response.md",
  "docs/ops/on-call-sla.md",
  "src/lib/pilot-readiness.ts",
  "src/lib/customer-audit-package.ts",
  "src/lib/pilot-demo-packages.ts",
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
