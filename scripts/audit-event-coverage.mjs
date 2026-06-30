#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const requirements = [
  { file: "src/lib/assumptions.functions.ts", phrases: ["auditLog(", 'from("audit_logs")'] },
  {
    file: "src/lib/underwriting.functions.ts",
    phrases: ["accept_defaults", "resolve_conflict", "run_full_underwriting"],
  },
  { file: "src/lib/documents.functions.ts", phrases: ["signed_url_created", "writeAuditEvent"] },
  {
    file: "src/lib/compliance.functions.ts",
    phrases: [
      "compliance_settings_updated",
      "audit_log_exported",
      "customer_audit_package_exported",
    ],
  },
  { file: "src/lib/operating-layer.functions.ts", phrases: ["cast_vote", 'from("audit_logs")'] },
  {
    file: "src/lib/operating-depth.functions.ts",
    phrases: ["relationship_contact_created", "audit("],
  },
];

const failures = [];
for (const requirement of requirements) {
  const text = await readFile(requirement.file, "utf8");
  for (const phrase of requirement.phrases) {
    if (!text.includes(phrase)) failures.push(`${requirement.file} is missing ${phrase}`);
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`[audit-event-coverage] ${failure}`);
  process.exit(1);
}

console.log(
  `[audit-event-coverage] ${requirements.length} critical mutation modules emit audit events.`,
);
