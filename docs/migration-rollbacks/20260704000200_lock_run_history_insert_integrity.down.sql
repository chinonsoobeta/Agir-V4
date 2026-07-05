-- Reverse of 20260704000200_lock_run_history_insert_integrity.sql.
-- Restores the insert grants and insert policies created by
-- 20260704000100_normalized_run_history_and_report_binding.sql.

DROP TRIGGER IF EXISTS run_financial_outputs_validate_insert ON public.run_financial_outputs;
DROP TRIGGER IF EXISTS run_cash_flows_validate_insert ON public.run_cash_flows;
DROP TRIGGER IF EXISTS run_reconciliation_flags_validate_insert ON public.run_reconciliation_flags;
DROP TRIGGER IF EXISTS run_risk_register_validate_insert ON public.run_risk_register;
DROP FUNCTION IF EXISTS public.validate_run_history_insert();

GRANT INSERT ON public.run_financial_outputs TO authenticated;
GRANT INSERT ON public.run_cash_flows TO authenticated;
GRANT INSERT ON public.run_reconciliation_flags TO authenticated;
GRANT INSERT ON public.run_risk_register TO authenticated;

DROP POLICY IF EXISTS "run_financial_outputs_insert_allowed" ON public.run_financial_outputs;
CREATE POLICY "run_financial_outputs_insert_allowed" ON public.run_financial_outputs
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = run_financial_outputs.project_id
        AND (
          (p.workspace_id IS NULL AND p.owner_id = auth.uid())
          OR public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
        )
    )
  );

DROP POLICY IF EXISTS "run_cash_flows_insert_allowed" ON public.run_cash_flows;
CREATE POLICY "run_cash_flows_insert_allowed" ON public.run_cash_flows
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = run_cash_flows.project_id
        AND (
          (p.workspace_id IS NULL AND p.owner_id = auth.uid())
          OR public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
        )
    )
  );

DROP POLICY IF EXISTS "run_reconciliation_flags_insert_allowed" ON public.run_reconciliation_flags;
CREATE POLICY "run_reconciliation_flags_insert_allowed" ON public.run_reconciliation_flags
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = run_reconciliation_flags.project_id
        AND (
          (p.workspace_id IS NULL AND p.owner_id = auth.uid())
          OR public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
        )
    )
  );

DROP POLICY IF EXISTS "run_risk_register_insert_allowed" ON public.run_risk_register;
CREATE POLICY "run_risk_register_insert_allowed" ON public.run_risk_register
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = run_risk_register.project_id
        AND (
          (p.workspace_id IS NULL AND p.owner_id = auth.uid())
          OR public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
        )
    )
  );

NOTIFY pgrst, 'reload schema';
