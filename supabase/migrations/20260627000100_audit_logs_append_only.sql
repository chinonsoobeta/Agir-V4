-- Make audit logs append-only. Analysts can add/read audit events they are
-- allowed to see, but neither authenticated users nor service-role code paths
-- may mutate or delete historical entries.

CREATE OR REPLACE FUNCTION public.reject_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only; UPDATE and DELETE are not allowed'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_append_only ON public.audit_logs;
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_audit_log_mutation();

REVOKE UPDATE, DELETE ON public.audit_logs FROM authenticated;
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;

DROP POLICY IF EXISTS "audit_logs_workspace_member" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_workspace_member_select" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_workspace_member_insert" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_workspace_member_update" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_workspace_member_delete" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_workspace_write_guard_insert" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_workspace_write_guard_update" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_workspace_write_guard_delete" ON public.audit_logs;

DROP POLICY IF EXISTS "owners read audit" ON public.audit_logs;
DROP POLICY IF EXISTS "owners insert audit" ON public.audit_logs;

CREATE POLICY "audit_logs_select_allowed" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
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
      project_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.projects p
        WHERE p.id = audit_logs.project_id
          AND (
            (p.workspace_id IS NULL AND p.owner_id = auth.uid())
            OR public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
          )
      )
    )
  );
