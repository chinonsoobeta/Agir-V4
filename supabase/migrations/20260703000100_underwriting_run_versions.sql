-- First-class deterministic underwriting run versions.
--
-- Current financial_outputs remain the compatibility surface for latest reads.
-- underwriting_runs preserves durable run metadata plus compact input and output
-- snapshots so analysts can see freshness, history, and drift.

CREATE TABLE IF NOT EXISTS public.underwriting_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  run_number INTEGER NOT NULL,
  run_mode TEXT NOT NULL CHECK (run_mode IN ('deterministic', 'ai_assisted_default_selection')),
  status TEXT NOT NULL CHECK (status IN ('completed', 'blocked', 'failed')),
  input_fingerprint TEXT NOT NULL,
  output_fingerprint TEXT,
  verdict_code TEXT,
  blocked_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  accepted_defaults_used JSONB NOT NULL DEFAULT '[]'::jsonb,
  conflict_resolutions_used JSONB NOT NULL DEFAULT '[]'::jsonb,
  input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, run_number)
);

CREATE INDEX IF NOT EXISTS idx_underwriting_runs_project_number
  ON public.underwriting_runs (project_id, run_number DESC);

CREATE INDEX IF NOT EXISTS idx_underwriting_runs_project_status
  ON public.underwriting_runs (project_id, status, computed_at DESC);

ALTER TABLE public.financial_outputs
  ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES public.underwriting_runs(id) ON DELETE SET NULL;

ALTER TABLE public.cash_flows
  ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES public.underwriting_runs(id) ON DELETE SET NULL;

ALTER TABLE public.reconciliation_flags
  ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES public.underwriting_runs(id) ON DELETE SET NULL;

ALTER TABLE public.risk_register
  ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES public.underwriting_runs(id) ON DELETE SET NULL;

ALTER TABLE public.investment_memos
  ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES public.underwriting_runs(id) ON DELETE SET NULL;

ALTER TABLE public.decision_logs
  ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES public.underwriting_runs(id) ON DELETE SET NULL;

ALTER TABLE public.memo_snapshots
  ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES public.underwriting_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_financial_outputs_run_id
  ON public.financial_outputs (run_id);

CREATE INDEX IF NOT EXISTS idx_cash_flows_run_id
  ON public.cash_flows (run_id);

CREATE INDEX IF NOT EXISTS idx_reconciliation_flags_run_id
  ON public.reconciliation_flags (run_id);

CREATE INDEX IF NOT EXISTS idx_risk_register_run_id
  ON public.risk_register (run_id);

CREATE INDEX IF NOT EXISTS idx_investment_memos_run_id
  ON public.investment_memos (run_id);

CREATE INDEX IF NOT EXISTS idx_decision_logs_run_id
  ON public.decision_logs (run_id);

CREATE INDEX IF NOT EXISTS idx_memo_snapshots_run_id
  ON public.memo_snapshots (run_id);

CREATE INDEX IF NOT EXISTS idx_financial_outputs_project_run
  ON public.financial_outputs (project_id, run_id);

CREATE INDEX IF NOT EXISTS idx_cash_flows_project_run
  ON public.cash_flows (project_id, run_id);

CREATE INDEX IF NOT EXISTS idx_reconciliation_flags_project_run
  ON public.reconciliation_flags (project_id, run_id);

CREATE INDEX IF NOT EXISTS idx_risk_register_project_run
  ON public.risk_register (project_id, run_id);

ALTER TABLE public.underwriting_runs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.reject_underwriting_run_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'underwriting_runs is append-only; UPDATE and DELETE are not allowed'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS underwriting_runs_append_only ON public.underwriting_runs;
CREATE TRIGGER underwriting_runs_append_only
  BEFORE UPDATE OR DELETE ON public.underwriting_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_underwriting_run_mutation();

REVOKE UPDATE, DELETE ON public.underwriting_runs FROM authenticated;
GRANT SELECT, INSERT ON public.underwriting_runs TO authenticated;
GRANT ALL ON public.underwriting_runs TO service_role;

CREATE POLICY "underwriting_runs_select_allowed" ON public.underwriting_runs
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = underwriting_runs.project_id
        AND p.workspace_id IS NOT NULL
        AND public.is_workspace_member(p.workspace_id)
    )
  );

CREATE POLICY "underwriting_runs_insert_allowed" ON public.underwriting_runs
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = underwriting_runs.project_id
        AND (
          (p.workspace_id IS NULL AND p.owner_id = auth.uid())
          OR public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
      )
    )
  );

NOTIFY pgrst, 'reload schema';
