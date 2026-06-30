#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const migration = "supabase/migrations/20260630000200_backend_performance_indexes.sql";
const text = await readFile(migration, "utf8");
const requiredIndexes = [
  "idx_projects_owner_status_updated",
  "idx_projects_workspace_status_updated",
  "idx_documents_project_upload",
  "idx_assumptions_project_status_key",
  "idx_financial_outputs_project_scenario_metric",
  "idx_cash_flows_project_scenario_period",
  "idx_generated_reports_project_type_generated",
  "idx_audit_logs_project_created_desc",
  "idx_reconciliation_flags_project_severity",
  "idx_risk_register_project_severity",
];

const missing = requiredIndexes.filter((index) => !text.includes(index));
if (missing.length) {
  for (const index of missing) console.error(`[db-index-audit] missing index: ${index}`);
  process.exit(1);
}

console.log(`[db-index-audit] ${requiredIndexes.length} high-volume indexes declared.`);
