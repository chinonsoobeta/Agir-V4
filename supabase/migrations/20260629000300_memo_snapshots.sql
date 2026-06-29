-- Snapshot / lock a memo at IC submission.
--
-- Freezes the exact inputs (approved assumptions), engine outputs, and rendered
-- report behind an immutable version at the moment a decision is recorded, so a
-- later assumption edit can never retroactively change what the committee saw.
-- A content_hash lets the UI cheaply detect (and diff) drift if the deal is
-- re-run after submission.

CREATE TABLE IF NOT EXISTS public.memo_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  memo_id UUID REFERENCES public.investment_memos(id) ON DELETE SET NULL,
  decision_id UUID REFERENCES public.decision_logs(id) ON DELETE SET NULL,
  version INTEGER NOT NULL,
  verdict_code TEXT,
  assumptions_json JSONB NOT NULL,
  outputs_json JSONB NOT NULL,
  report_json JSONB NOT NULL,
  content_hash TEXT NOT NULL,
  created_by UUID NOT NULL,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, version)
);

CREATE INDEX IF NOT EXISTS idx_memo_snapshots_project
  ON public.memo_snapshots (project_id, version DESC);

ALTER TABLE public.memo_snapshots ENABLE ROW LEVEL SECURITY;

-- Immutable once written: a snapshot is the record of what the committee saw.
CREATE OR REPLACE FUNCTION public.reject_memo_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'memo_snapshots is append-only; UPDATE and DELETE are not allowed'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS memo_snapshots_append_only ON public.memo_snapshots;
CREATE TRIGGER memo_snapshots_append_only
  BEFORE UPDATE OR DELETE ON public.memo_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_memo_snapshot_mutation();

REVOKE UPDATE, DELETE ON public.memo_snapshots FROM authenticated;
GRANT SELECT, INSERT ON public.memo_snapshots TO authenticated;
GRANT ALL ON public.memo_snapshots TO service_role;

CREATE POLICY "memo_snapshots_select_allowed" ON public.memo_snapshots
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = memo_snapshots.project_id
        AND p.workspace_id IS NOT NULL
        AND public.is_workspace_member(p.workspace_id)
    )
  );

CREATE POLICY "memo_snapshots_insert_allowed" ON public.memo_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = memo_snapshots.project_id
        AND (
          (p.workspace_id IS NULL AND p.owner_id = auth.uid())
          OR public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
        )
    )
  );
