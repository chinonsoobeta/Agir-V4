-- Normalized immutable run history for deterministic underwriting outputs.
-- The existing latest tables remain the compatibility surface for current UI reads.

CREATE TABLE IF NOT EXISTS public.run_financial_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.underwriting_runs(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scenario_key TEXT NOT NULL DEFAULT 'base',
  metric_key TEXT NOT NULL,
  metric_label TEXT,
  value_numeric NUMERIC,
  unit TEXT,
  formula_text TEXT,
  inputs JSONB,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, scenario_key, metric_key)
);

CREATE TABLE IF NOT EXISTS public.run_cash_flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.underwriting_runs(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scenario_key TEXT NOT NULL DEFAULT 'base',
  period_year INTEGER NOT NULL,
  line_key public.cash_flow_line_key NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, scenario_key, period_year, line_key)
);

CREATE TABLE IF NOT EXISTS public.run_reconciliation_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.underwriting_runs(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  check_key TEXT NOT NULL,
  severity public.reconciliation_severity NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  expected NUMERIC,
  actual NUMERIC,
  resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.run_risk_register (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.underwriting_runs(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  risk_type TEXT NOT NULL,
  severity public.risk_severity NOT NULL DEFAULT 'yellow',
  title TEXT NOT NULL,
  description TEXT,
  related_assumption_id UUID REFERENCES public.assumptions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.generated_reports
  ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES public.underwriting_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS run_number INTEGER,
  ADD COLUMN IF NOT EXISTS run_mode TEXT,
  ADD COLUMN IF NOT EXISTS input_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS output_fingerprint TEXT;

CREATE INDEX IF NOT EXISTS idx_run_financial_outputs_project_run
  ON public.run_financial_outputs (project_id, run_id);
CREATE INDEX IF NOT EXISTS idx_run_financial_outputs_run
  ON public.run_financial_outputs (run_id);
CREATE INDEX IF NOT EXISTS idx_run_financial_outputs_latest
  ON public.run_financial_outputs (project_id, computed_at DESC);

CREATE INDEX IF NOT EXISTS idx_run_cash_flows_project_run
  ON public.run_cash_flows (project_id, run_id);
CREATE INDEX IF NOT EXISTS idx_run_cash_flows_run
  ON public.run_cash_flows (run_id);
CREATE INDEX IF NOT EXISTS idx_run_cash_flows_latest
  ON public.run_cash_flows (project_id, computed_at DESC);

CREATE INDEX IF NOT EXISTS idx_run_reconciliation_flags_project_run
  ON public.run_reconciliation_flags (project_id, run_id);
CREATE INDEX IF NOT EXISTS idx_run_reconciliation_flags_run
  ON public.run_reconciliation_flags (run_id);
CREATE INDEX IF NOT EXISTS idx_run_reconciliation_flags_latest
  ON public.run_reconciliation_flags (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_run_risk_register_project_run
  ON public.run_risk_register (project_id, run_id);
CREATE INDEX IF NOT EXISTS idx_run_risk_register_run
  ON public.run_risk_register (run_id);
CREATE INDEX IF NOT EXISTS idx_run_risk_register_latest
  ON public.run_risk_register (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_generated_reports_project_run
  ON public.generated_reports (project_id, run_id);

ALTER TABLE public.run_financial_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.run_cash_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.run_reconciliation_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.run_risk_register ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.reject_run_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'run history tables are append-only; UPDATE and DELETE are not allowed'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS run_financial_outputs_append_only ON public.run_financial_outputs;
CREATE TRIGGER run_financial_outputs_append_only
  BEFORE UPDATE OR DELETE ON public.run_financial_outputs
  FOR EACH ROW EXECUTE FUNCTION public.reject_run_history_mutation();

DROP TRIGGER IF EXISTS run_cash_flows_append_only ON public.run_cash_flows;
CREATE TRIGGER run_cash_flows_append_only
  BEFORE UPDATE OR DELETE ON public.run_cash_flows
  FOR EACH ROW EXECUTE FUNCTION public.reject_run_history_mutation();

DROP TRIGGER IF EXISTS run_reconciliation_flags_append_only ON public.run_reconciliation_flags;
CREATE TRIGGER run_reconciliation_flags_append_only
  BEFORE UPDATE OR DELETE ON public.run_reconciliation_flags
  FOR EACH ROW EXECUTE FUNCTION public.reject_run_history_mutation();

DROP TRIGGER IF EXISTS run_risk_register_append_only ON public.run_risk_register;
CREATE TRIGGER run_risk_register_append_only
  BEFORE UPDATE OR DELETE ON public.run_risk_register
  FOR EACH ROW EXECUTE FUNCTION public.reject_run_history_mutation();

REVOKE UPDATE, DELETE ON public.run_financial_outputs FROM authenticated;
REVOKE UPDATE, DELETE ON public.run_cash_flows FROM authenticated;
REVOKE UPDATE, DELETE ON public.run_reconciliation_flags FROM authenticated;
REVOKE UPDATE, DELETE ON public.run_risk_register FROM authenticated;

GRANT SELECT, INSERT ON public.run_financial_outputs TO authenticated;
GRANT SELECT, INSERT ON public.run_cash_flows TO authenticated;
GRANT SELECT, INSERT ON public.run_reconciliation_flags TO authenticated;
GRANT SELECT, INSERT ON public.run_risk_register TO authenticated;
GRANT ALL ON public.run_financial_outputs TO service_role;
GRANT ALL ON public.run_cash_flows TO service_role;
GRANT ALL ON public.run_reconciliation_flags TO service_role;
GRANT ALL ON public.run_risk_register TO service_role;

DROP POLICY IF EXISTS "run_financial_outputs_select_allowed" ON public.run_financial_outputs;
CREATE POLICY "run_financial_outputs_select_allowed" ON public.run_financial_outputs
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = run_financial_outputs.project_id
        AND p.workspace_id IS NOT NULL
        AND public.is_workspace_member(p.workspace_id)
    )
  );

DROP POLICY IF EXISTS "run_cash_flows_select_allowed" ON public.run_cash_flows;
CREATE POLICY "run_cash_flows_select_allowed" ON public.run_cash_flows
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = run_cash_flows.project_id
        AND p.workspace_id IS NOT NULL
        AND public.is_workspace_member(p.workspace_id)
    )
  );

DROP POLICY IF EXISTS "run_reconciliation_flags_select_allowed" ON public.run_reconciliation_flags;
CREATE POLICY "run_reconciliation_flags_select_allowed" ON public.run_reconciliation_flags
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = run_reconciliation_flags.project_id
        AND p.workspace_id IS NOT NULL
        AND public.is_workspace_member(p.workspace_id)
    )
  );

DROP POLICY IF EXISTS "run_risk_register_select_allowed" ON public.run_risk_register;
CREATE POLICY "run_risk_register_select_allowed" ON public.run_risk_register
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = run_risk_register.project_id
        AND p.workspace_id IS NOT NULL
        AND public.is_workspace_member(p.workspace_id)
    )
  );

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
