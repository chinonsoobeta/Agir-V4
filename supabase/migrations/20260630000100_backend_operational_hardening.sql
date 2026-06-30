-- Backend operational hardening.
--
-- Adds durable queue semantics, backend rate-limit records, scheduled audit
-- chain evidence, and data-governance enforcement evidence without changing
-- existing application-facing table contracts.

-- ---------------------------------------------------------------------------
-- Extraction / underwriting job queue leases

ALTER TABLE public.extraction_jobs
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 25),
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS lease_owner TEXT,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_requested BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ;

ALTER TABLE public.extraction_jobs
  DROP CONSTRAINT IF EXISTS extraction_jobs_status_check;

ALTER TABLE public.extraction_jobs
  ADD CONSTRAINT extraction_jobs_status_check
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'canceled', 'dead_lettered'));

CREATE INDEX IF NOT EXISTS idx_extraction_jobs_queue_claim
  ON public.extraction_jobs (status, scheduled_at, priority, created_at)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_extraction_jobs_lease_expiry
  ON public.extraction_jobs (lease_expires_at)
  WHERE status = 'running';

CREATE OR REPLACE FUNCTION public.claim_next_extraction_job(
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 300
) RETURNS public.extraction_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.extraction_jobs%ROWTYPE;
BEGIN
  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 THEN
    RAISE EXCEPTION 'worker id is required';
  END IF;

  UPDATE public.extraction_jobs ej
     SET status = 'dead_lettered',
         dead_lettered_at = coalesce(dead_lettered_at, now()),
         finished_at = coalesce(finished_at, now()),
         error = coalesce(error, 'Job exceeded max attempts.'),
         message = 'Dead-lettered after max attempts.'
   WHERE ej.status IN ('queued', 'running')
     AND ej.attempts >= ej.max_attempts
     AND (
       ej.status = 'queued'
       OR ej.lease_expires_at IS NULL
       OR ej.lease_expires_at < now()
     );

  UPDATE public.extraction_jobs ej
     SET status = 'running',
         attempts = ej.attempts + 1,
         lease_owner = p_worker_id,
         lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
         heartbeat_at = now(),
         started_at = coalesce(ej.started_at, now()),
         message = 'Claimed by queue worker'
   WHERE ej.id = (
     SELECT id
       FROM public.extraction_jobs
      WHERE status IN ('queued', 'running')
        AND cancellation_requested = false
        AND scheduled_at <= now()
        AND attempts < max_attempts
        AND (
          status = 'queued'
          OR lease_expires_at IS NULL
          OR lease_expires_at < now()
        )
      ORDER BY priority ASC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
   RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_extraction_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 300
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.extraction_jobs
     SET heartbeat_at = now(),
         lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 30))
   WHERE id = p_job_id
     AND status = 'running'
     AND lease_owner = p_worker_id
     AND cancellation_requested = false;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_extraction_job_cancellation(p_job_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  UPDATE public.extraction_jobs
     SET cancellation_requested = true,
         status = CASE WHEN status = 'queued' THEN 'canceled' ELSE status END,
         finished_at = CASE WHEN status = 'queued' THEN now() ELSE finished_at END
   WHERE id = p_job_id
     AND status IN ('queued', 'running')
     AND (
       owner_id = auth.uid()
       OR EXISTS (
         SELECT 1
         FROM public.projects p
         WHERE p.id = extraction_jobs.project_id
           AND public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
       )
     );
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_next_extraction_job(TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_extraction_job(UUID, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_extraction_job_cancellation(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Backend rate limiting evidence

CREATE TABLE IF NOT EXISTS public.rate_limit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  bucket TEXT NOT NULL CHECK (char_length(bucket) BETWEEN 1 AND 120),
  cost INTEGER NOT NULL DEFAULT 1 CHECK (cost > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS rate_limit_events_owner_bucket_idx
  ON public.rate_limit_events(owner_id, bucket, created_at DESC);

ALTER TABLE public.rate_limit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rate_limit_events_owner_select" ON public.rate_limit_events
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "rate_limit_events_owner_insert" ON public.rate_limit_events
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

GRANT SELECT, INSERT ON public.rate_limit_events TO authenticated;
GRANT ALL ON public.rate_limit_events TO service_role;

-- ---------------------------------------------------------------------------
-- Scheduled audit-chain verification evidence

CREATE TABLE IF NOT EXISTS public.audit_chain_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  valid BOOLEAN NOT NULL,
  reason TEXT,
  total BIGINT NOT NULL DEFAULT 0,
  head_hash TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_by TEXT NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS audit_chain_verifications_project_idx
  ON public.audit_chain_verifications(project_id, checked_at DESC);

ALTER TABLE public.audit_chain_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_chain_verifications_member_select" ON public.audit_chain_verifications
  FOR SELECT TO authenticated
  USING (
    project_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = audit_chain_verifications.project_id
        AND (
          p.owner_id = auth.uid()
          OR public.is_workspace_member(p.workspace_id)
        )
    )
  );

GRANT SELECT ON public.audit_chain_verifications TO authenticated;
GRANT ALL ON public.audit_chain_verifications TO service_role;

-- ---------------------------------------------------------------------------
-- Data governance enforcement evidence

CREATE TABLE IF NOT EXISTS public.compliance_enforcement_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  run_type TEXT NOT NULL CHECK (run_type IN ('retention', 'deletion', 'residency', 'dr_drill')),
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'dry_run')),
  summary TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  run_by TEXT NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS compliance_enforcement_runs_workspace_idx
  ON public.compliance_enforcement_runs(workspace_id, started_at DESC);

ALTER TABLE public.compliance_enforcement_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "compliance_enforcement_runs_admin_select" ON public.compliance_enforcement_runs
  FOR SELECT TO authenticated
  USING (
    workspace_id IS NULL
    OR public.workspace_role(workspace_id) IN ('owner', 'admin')
  );

GRANT SELECT ON public.compliance_enforcement_runs TO authenticated;
GRANT ALL ON public.compliance_enforcement_runs TO service_role;
