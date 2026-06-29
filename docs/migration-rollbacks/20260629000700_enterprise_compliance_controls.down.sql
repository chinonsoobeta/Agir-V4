-- Rollback for 20260629000700_enterprise_compliance_controls.
-- Restores the prior audit_logs policies (from 20260629000200 / append-only set)
-- and drops the compliance additions.
DROP TRIGGER IF EXISTS data_governance_requests_updated_at ON public.data_governance_requests;
DROP TABLE IF EXISTS public.data_governance_requests;

ALTER TABLE public.workspace_settings
  DROP COLUMN IF EXISTS sso_provider,
  DROP COLUMN IF EXISTS sso_metadata_url,
  DROP COLUMN IF EXISTS sso_enforced,
  DROP COLUMN IF EXISTS scim_enabled,
  DROP COLUMN IF EXISTS data_residency_region,
  DROP COLUMN IF EXISTS dpa_status,
  DROP COLUMN IF EXISTS tenant_encryption_mode,
  DROP COLUMN IF EXISTS audit_log_retention_days,
  DROP COLUMN IF EXISTS backup_rto_hours,
  DROP COLUMN IF EXISTS backup_rpo_hours,
  DROP COLUMN IF EXISTS incident_severity_policy,
  DROP COLUMN IF EXISTS on_call_rotation_url,
  DROP COLUMN IF EXISTS status_page_url,
  DROP COLUMN IF EXISTS soc2_observation_started_at,
  DROP COLUMN IF EXISTS last_pen_test_at,
  DROP COLUMN IF EXISTS last_dr_test_at;

DROP INDEX IF EXISTS public.audit_logs_workspace_idx;
ALTER TABLE public.audit_logs DROP COLUMN IF EXISTS workspace_id;
-- NOTE: re-apply 20260629000200 audit_logs policies after this rollback.
