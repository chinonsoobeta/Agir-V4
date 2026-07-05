-- Reverse of 20260704000200_lock_run_history_insert_integrity.sql
-- Restores GRANT INSERT and broad FOR ALL policies on history tables.

-- Drop triggers and functions
DROP TRIGGER IF EXISTS prevent_direct_insert_on_run_financial_outputs ON public.run_financial_outputs;
DROP FUNCTION IF EXISTS public.reject_direct_run_history_insert();
DROP TRIGGER IF EXISTS prevent_direct_insert_on_run_cash_flows ON public.run_cash_flows;
DROP FUNCTION IF EXISTS public.reject_direct_cf_history_insert();
DROP TRIGGER IF EXISTS prevent_direct_insert_on_run_reconciliation_flags ON public.run_reconciliation_flags;
DROP FUNCTION IF EXISTS public.reject_direct_flag_history_insert();
DROP TRIGGER IF EXISTS prevent_direct_insert_on_run_risk_register ON public.run_risk_register;
DROP FUNCTION IF EXISTS public.reject_direct_risk_history_insert();

-- Restore GRANT INSERT on history tables
GRANT INSERT ON public.run_financial_outputs TO authenticated;
GRANT INSERT ON public.run_cash_flows TO authenticated;
GRANT INSERT ON public.run_reconciliation_flags TO authenticated;
GRANT INSERT ON public.run_risk_register TO authenticated;

-- Restore broad FOR ALL policies
DROP POLICY IF EXISTS "run_financial_outputs_workspace_member" ON public.run_financial_outputs;
DROP POLICY IF EXISTS "run_cash_flows_workspace_member" ON public.run_cash_flows;
DROP POLICY IF EXISTS "run_reconciliation_flags_workspace_member" ON public.run_reconciliation_flags;
DROP POLICY IF EXISTS "run_risk_register_workspace_member" ON public.run_risk_register;

CREATE POLICY "run_financial_outputs_all" ON public.run_financial_outputs
  FOR ALL TO authenticated
  USING (public.is_workspace_member(
    (SELECT workspace_id FROM public.projects WHERE id = project_id)
  ));

CREATE POLICY "run_cash_flows_all" ON public.run_cash_flows
  FOR ALL TO authenticated
  USING (public.is_workspace_member(
    (SELECT workspace_id FROM public.projects WHERE id = project_id)
  ));

CREATE POLICY "run_reconciliation_flags_all" ON public.run_reconciliation_flags
  FOR ALL TO authenticated
  USING (public.is_workspace_member(
    (SELECT workspace_id FROM public.projects WHERE id = project_id)
  ));

CREATE POLICY "run_risk_register_all" ON public.run_risk_register
  FOR ALL TO authenticated
  USING (public.is_workspace_member(
    (SELECT workspace_id FROM public.projects WHERE id = project_id)
  ));
