DROP POLICY IF EXISTS "compliance_enforcement_runs_admin_select" ON public.compliance_enforcement_runs;
DROP TABLE IF EXISTS public.compliance_enforcement_runs;

DROP POLICY IF EXISTS "audit_chain_verifications_member_select" ON public.audit_chain_verifications;
DROP TABLE IF EXISTS public.audit_chain_verifications;

DROP POLICY IF EXISTS "rate_limit_events_owner_select" ON public.rate_limit_events;
DROP POLICY IF EXISTS "rate_limit_events_owner_insert" ON public.rate_limit_events;
DROP TABLE IF EXISTS public.rate_limit_events;

DROP FUNCTION IF EXISTS public.request_extraction_job_cancellation(UUID);
DROP FUNCTION IF EXISTS public.heartbeat_extraction_job(UUID, TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.claim_next_extraction_job(TEXT, INTEGER);

DROP INDEX IF EXISTS public.idx_extraction_jobs_lease_expiry;
DROP INDEX IF EXISTS public.idx_extraction_jobs_queue_claim;

ALTER TABLE public.extraction_jobs
  DROP CONSTRAINT IF EXISTS extraction_jobs_status_check;

ALTER TABLE public.extraction_jobs
  ADD CONSTRAINT extraction_jobs_status_check
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'canceled'));

ALTER TABLE public.extraction_jobs
  DROP COLUMN IF EXISTS dead_lettered_at,
  DROP COLUMN IF EXISTS cancellation_requested,
  DROP COLUMN IF EXISTS heartbeat_at,
  DROP COLUMN IF EXISTS lease_expires_at,
  DROP COLUMN IF EXISTS lease_owner,
  DROP COLUMN IF EXISTS scheduled_at,
  DROP COLUMN IF EXISTS priority,
  DROP COLUMN IF EXISTS max_attempts,
  DROP COLUMN IF EXISTS attempts;
