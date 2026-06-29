-- Enterprise compliance controls: SSO/SCIM readiness, audit export scope,
-- data-governance request tracking, and workspace-level audit events.
--
-- This is additive. Existing workspace settings remain valid and existing
-- project-scoped audit events stay append-only.

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS audit_logs_workspace_idx
  ON public.audit_logs(workspace_id, created_at DESC);

ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS sso_provider TEXT,
  ADD COLUMN IF NOT EXISTS sso_metadata_url TEXT,
  ADD COLUMN IF NOT EXISTS sso_enforced BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scim_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS data_residency_region TEXT,
  ADD COLUMN IF NOT EXISTS dpa_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (dpa_status IN ('not_started', 'in_review', 'approved')),
  ADD COLUMN IF NOT EXISTS tenant_encryption_mode TEXT NOT NULL DEFAULT 'platform_managed'
    CHECK (tenant_encryption_mode IN ('platform_managed', 'per_tenant', 'customer_managed')),
  ADD COLUMN IF NOT EXISTS audit_log_retention_days INTEGER NOT NULL DEFAULT 2555
    CHECK (audit_log_retention_days >= 365),
  ADD COLUMN IF NOT EXISTS backup_rto_hours INTEGER NOT NULL DEFAULT 24
    CHECK (backup_rto_hours BETWEEN 1 AND 168),
  ADD COLUMN IF NOT EXISTS backup_rpo_hours INTEGER NOT NULL DEFAULT 24
    CHECK (backup_rpo_hours BETWEEN 1 AND 168),
  ADD COLUMN IF NOT EXISTS incident_severity_policy TEXT NOT NULL DEFAULT 'docs/ops/incident-response.md',
  ADD COLUMN IF NOT EXISTS on_call_rotation_url TEXT,
  ADD COLUMN IF NOT EXISTS status_page_url TEXT,
  ADD COLUMN IF NOT EXISTS soc2_observation_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_pen_test_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_dr_test_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.data_governance_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  requester_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL CHECK (
    request_type IN (
      'data_export',
      'deletion',
      'retention_exception',
      'dpa_review',
      'audit_export',
      'residency_review'
    )
  ),
  status TEXT NOT NULL DEFAULT 'open' CHECK (
    status IN ('open', 'in_review', 'completed', 'rejected')
  ),
  subject TEXT NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 240),
  reason TEXT,
  due_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '30 days',
  completed_at TIMESTAMPTZ,
  evidence_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS data_governance_requests_workspace_idx
  ON public.data_governance_requests(workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS data_governance_requests_requester_idx
  ON public.data_governance_requests(requester_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.data_governance_requests TO authenticated;
GRANT ALL ON public.data_governance_requests TO service_role;
ALTER TABLE public.data_governance_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "data_governance_requests_member_select" ON public.data_governance_requests;
DROP POLICY IF EXISTS "data_governance_requests_member_insert" ON public.data_governance_requests;
DROP POLICY IF EXISTS "data_governance_requests_admin_update" ON public.data_governance_requests;

CREATE POLICY "data_governance_requests_member_select" ON public.data_governance_requests
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "data_governance_requests_member_insert" ON public.data_governance_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requester_id = auth.uid()
    AND public.is_workspace_member(workspace_id)
  );

CREATE POLICY "data_governance_requests_admin_update" ON public.data_governance_requests
  FOR UPDATE TO authenticated
  USING (public.workspace_role(workspace_id) IN ('owner', 'admin'))
  WITH CHECK (public.workspace_role(workspace_id) IN ('owner', 'admin'));

DROP TRIGGER IF EXISTS data_governance_requests_updated_at ON public.data_governance_requests;
CREATE TRIGGER data_governance_requests_updated_at
  BEFORE UPDATE ON public.data_governance_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP POLICY IF EXISTS "audit_logs_select_allowed" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert_allowed" ON public.audit_logs;

CREATE POLICY "audit_logs_select_allowed" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR (
      workspace_id IS NOT NULL
      AND public.is_workspace_member(workspace_id)
    )
    OR EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = audit_logs.project_id
        AND p.workspace_id IS NOT NULL
        AND public.is_workspace_member(p.workspace_id)
    )
  );

CREATE POLICY "audit_logs_insert_allowed" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND user_id = auth.uid()
    AND (
      (
        project_id IS NULL
        AND workspace_id IS NULL
      )
      OR (
        project_id IS NULL
        AND workspace_id IS NOT NULL
        AND public.workspace_role(workspace_id) IN ('owner', 'admin', 'member')
      )
      OR EXISTS (
        SELECT 1
        FROM public.projects p
        WHERE p.id = audit_logs.project_id
          AND (
            (p.workspace_id IS NULL AND p.owner_id = auth.uid())
            OR public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
          )
          AND (
            audit_logs.workspace_id IS NULL
            OR audit_logs.workspace_id = p.workspace_id
          )
      )
    )
  );
