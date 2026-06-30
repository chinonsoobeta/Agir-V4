-- Performance indexes for high-volume, tenant-scoped backend paths.
-- Keep this migration additive: every index is safe to create on an already
-- populated database and targets query shapes used by portfolio, reports,
-- underwriting, audit export, and worker dashboards.

CREATE INDEX IF NOT EXISTS idx_projects_owner_status_updated
  ON public.projects(owner_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_projects_workspace_status_updated
  ON public.projects(workspace_id, status, updated_at DESC)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documents_project_upload
  ON public.documents(project_id, upload_date DESC);

CREATE INDEX IF NOT EXISTS idx_assumptions_project_status_key
  ON public.assumptions(project_id, status, field_key);

CREATE INDEX IF NOT EXISTS idx_financial_outputs_project_scenario_metric
  ON public.financial_outputs(project_id, scenario_key, metric_key);

CREATE INDEX IF NOT EXISTS idx_cash_flows_project_scenario_period
  ON public.cash_flows(project_id, scenario_key, period_year);

CREATE INDEX IF NOT EXISTS idx_generated_reports_project_type_generated
  ON public.generated_reports(project_id, report_type, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_project_created_desc
  ON public.audit_logs(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reconciliation_flags_project_severity
  ON public.reconciliation_flags(project_id, severity);

CREATE INDEX IF NOT EXISTS idx_risk_register_project_severity
  ON public.risk_register(project_id, severity);
