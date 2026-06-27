-- Worked rollback example for 20260627000100_audit_logs_append_only.sql.
-- Review and adapt before production use. This restores the pre-hardening
-- authenticated UPDATE/DELETE grants and broad workspace FOR ALL policy shape.

DROP TRIGGER IF EXISTS audit_logs_append_only ON public.audit_logs;
DROP FUNCTION IF EXISTS public.reject_audit_log_mutation();

DROP POLICY IF EXISTS "audit_logs_select_allowed" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert_allowed" ON public.audit_logs;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;

CREATE POLICY "owners read audit" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (auth.uid() = owner_id);

CREATE POLICY "owners insert audit" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "audit_logs_workspace_member" ON public.audit_logs
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = audit_logs.project_id
        AND p.workspace_id IS NOT NULL
        AND public.is_workspace_member(p.workspace_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = audit_logs.project_id
        AND p.workspace_id IS NOT NULL
        AND public.is_workspace_member(p.workspace_id)
    )
  );
