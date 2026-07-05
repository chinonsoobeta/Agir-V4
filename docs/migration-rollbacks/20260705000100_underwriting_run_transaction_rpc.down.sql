-- Reverse of 20260705000100_underwriting_run_transaction_rpc.sql
-- Drops the RPC and restores prior grants.

DROP FUNCTION IF EXISTS public.persist_underwriting_run_transaction;

-- Restore prior grants on underwriting_runs
GRANT INSERT ON public.underwriting_runs TO authenticated;
GRANT UPDATE ON public.underwriting_runs TO authenticated;

DROP POLICY IF EXISTS "underwriting_runs_workspace_member_insert" ON public.underwriting_runs;

CREATE POLICY "underwriting_runs_all" ON public.underwriting_runs
  FOR ALL TO authenticated
  USING (public.is_workspace_member(
    (SELECT workspace_id FROM public.projects WHERE id = project_id)
  ));
