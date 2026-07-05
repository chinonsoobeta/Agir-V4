
-- Add missing INSERT/DELETE policies on profiles table (fixes C1, C2)
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_delete_own" ON public.profiles
  FOR DELETE TO authenticated
  USING (auth.uid() = id);

-- Add missing FK constraints on owner_id columns (fixes H2)
ALTER TABLE public.assumptions
  ADD CONSTRAINT assumptions_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.financial_outputs
  ADD CONSTRAINT financial_outputs_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.risk_register
  ADD CONSTRAINT risk_register_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.decision_logs
  ADD CONSTRAINT decision_logs_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Transactional delete RPC for compatibility-path deletes (fixes N-M2)
--
-- MIGRATION_SAFETY_REVIEW: these DELETE statements are scoped to one project
-- after an authenticated owner/workspace-member authorization check. The RPC
-- only refreshes latest compatibility tables; immutable run history remains
-- append-only.
CREATE OR REPLACE FUNCTION public.delete_underwriting_outputs(p_project_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'delete_underwriting_outputs requires the authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = p_project_id
      AND (
        (p.workspace_id IS NULL AND p.owner_id = auth.uid())
        OR public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
      )
  ) THEN
    RAISE EXCEPTION 'permission denied for underwriting output delete'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.financial_outputs WHERE project_id = p_project_id;
  DELETE FROM public.cash_flows WHERE project_id = p_project_id;
  DELETE FROM public.reconciliation_flags WHERE project_id = p_project_id;
  DELETE FROM public.risk_register WHERE project_id = p_project_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_underwriting_outputs(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_underwriting_outputs TO authenticated;
