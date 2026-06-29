-- Reliability + safety for the document upload / extraction path.
--
--  * content_hash      -> dedup + idempotency key (project, content-hash)
--  * page_count        -> max-pages guard for 500-1000pp uploads
--  * ocr_confidence     -> persisted per-doc OCR confidence (was audit-only)
--  * extraction_status  -> pending|queued|running|completed|failed
--  * scan_status        -> pending|clean|rejected (malformed / unsafe file scan)
--  * extraction_jobs    -> background-job row with progress + status so a large
--                          OCR run does not block a request and a timeout cannot
--                          silently corrupt partial state.

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS page_count INTEGER,
  ADD COLUMN IF NOT EXISTS ocr_confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS extraction_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS scan_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS scan_detail TEXT;

-- Idempotent upload: the same file content in the same project is one document.
CREATE UNIQUE INDEX IF NOT EXISTS uq_documents_project_content_hash
  ON public.documents (project_id, content_hash)
  WHERE content_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.extraction_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('document_analysis', 'assumption_extraction', 'underwriting')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'canceled')),
  progress INTEGER NOT NULL DEFAULT 0,
  total INTEGER,
  message TEXT,
  idempotency_key TEXT NOT NULL,
  result_json JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  -- A given unit of work (project + kind + content-hash) is one job: a
  -- double-click or retry re-attaches to the existing job instead of
  -- re-running billing-relevant extraction / underwriting.
  UNIQUE (owner_id, kind, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_extraction_jobs_project
  ON public.extraction_jobs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_extraction_jobs_status
  ON public.extraction_jobs (status);

ALTER TABLE public.extraction_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "extraction_jobs_select_allowed" ON public.extraction_jobs
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = extraction_jobs.project_id
        AND p.workspace_id IS NOT NULL
        AND public.is_workspace_member(p.workspace_id)
    )
  );

CREATE POLICY "extraction_jobs_insert_allowed" ON public.extraction_jobs
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "extraction_jobs_update_allowed" ON public.extraction_jobs
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON public.extraction_jobs TO authenticated;
GRANT ALL ON public.extraction_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.touch_extraction_jobs_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS extraction_jobs_touch ON public.extraction_jobs;
CREATE TRIGGER extraction_jobs_touch
  BEFORE UPDATE ON public.extraction_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_extraction_jobs_updated_at();
