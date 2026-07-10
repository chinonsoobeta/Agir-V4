-- Canonical asynchronous document verification.
--
-- This is additive: existing finalized documents and document-analysis jobs are
-- unchanged. New uploads enter a pending-upload-bound verification job before a
-- document row can exist. The worker never receives a client-selected path.

ALTER TABLE public.pending_document_uploads
  DROP CONSTRAINT IF EXISTS pending_document_uploads_status_check;
ALTER TABLE public.pending_document_uploads
  ADD CONSTRAINT pending_document_uploads_status_check CHECK (
    status IN (
      'pending', 'verification_queued', 'verification_running',
      'finalized', 'duplicate', 'rejected', 'failed', 'expired', 'cleanup_pending'
    )
  );

ALTER TABLE public.extraction_jobs
  ADD COLUMN IF NOT EXISTS pending_upload_id UUID
    REFERENCES public.pending_document_uploads(id) ON DELETE CASCADE;
ALTER TABLE public.extraction_jobs
  DROP CONSTRAINT IF EXISTS extraction_jobs_kind_check;
ALTER TABLE public.extraction_jobs
  ADD CONSTRAINT extraction_jobs_kind_check CHECK (
    kind IN ('document_verification', 'document_analysis', 'assumption_extraction', 'underwriting')
  );

-- A verification job is permanently bound to one pending upload. This is in
-- addition to the general idempotency constraint and makes accidental worker
-- or application code reuse impossible at the database boundary.
CREATE UNIQUE INDEX IF NOT EXISTS uq_extraction_jobs_pending_upload_verification
  ON public.extraction_jobs(pending_upload_id)
  WHERE kind = 'document_verification';
CREATE INDEX IF NOT EXISTS idx_extraction_jobs_pending_upload_lookup
  ON public.extraction_jobs(pending_upload_id, status, created_at DESC)
  WHERE pending_upload_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pending_document_uploads_status_expiry
  ON public.pending_document_uploads(status, expires_at, created_at);

-- Browser-callable, ownership-checked enqueue only. It contains no object
-- download, hashing, parsing, scanner, OCR, or AI work.
CREATE OR REPLACE FUNCTION public.enqueue_document_verification(p_upload_id UUID)
RETURNS TABLE(status TEXT, document_id UUID, job_id UUID)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_upload public.pending_document_uploads%ROWTYPE;
  v_job public.extraction_jobs%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication is required'; END IF;
  SELECT * INTO v_upload FROM public.pending_document_uploads
   WHERE id = p_upload_id AND owner_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pending upload not found'; END IF;
  IF v_upload.object_path !~ ('^' || v_upload.owner_id::text || '/pending/' || v_upload.id::text || '/') THEN
    RAISE EXCEPTION 'pending upload path is invalid';
  END IF;

  IF v_upload.status = 'pending' AND v_upload.expires_at <= now() THEN
    UPDATE public.pending_document_uploads SET status = 'expired', failure_reason = 'Upload expired before verification'
     WHERE id = v_upload.id;
    RETURN QUERY SELECT 'expired'::text, v_upload.document_id, NULL::uuid;
    RETURN;
  END IF;
  IF v_upload.status IN ('finalized', 'duplicate', 'rejected', 'failed', 'expired', 'cleanup_pending') THEN
    RETURN QUERY SELECT v_upload.status, v_upload.document_id, NULL::uuid;
    RETURN;
  END IF;

  SELECT * INTO v_job FROM public.extraction_jobs
   WHERE pending_upload_id = v_upload.id AND kind = 'document_verification'
   FOR UPDATE;
  IF FOUND THEN
    -- Repeated browser calls attach to the one durable job. A worker-owned
    -- running lease is never reset by the browser.
    IF v_job.status = 'running' THEN
      UPDATE public.pending_document_uploads SET status = 'verification_running' WHERE id = v_upload.id;
      RETURN QUERY SELECT 'verification_running'::text, NULL::uuid, v_job.id;
      RETURN;
    END IF;
    IF v_job.status = 'queued' THEN
      UPDATE public.pending_document_uploads SET status = 'verification_queued' WHERE id = v_upload.id;
      RETURN QUERY SELECT 'verification_queued'::text, NULL::uuid, v_job.id;
      RETURN;
    END IF;
    -- A terminal verification job is not silently retried. It leaves a
    -- durable evidence row and operators can make a reviewed retry decision.
    UPDATE public.pending_document_uploads SET status = 'failed', failure_reason = 'Verification job ended without finalization'
     WHERE id = v_upload.id AND pending_document_uploads.status NOT IN ('finalized', 'duplicate', 'rejected');
    RETURN QUERY SELECT 'failed'::text, NULL::uuid, v_job.id;
    RETURN;
  END IF;

  INSERT INTO public.extraction_jobs(
    owner_id, project_id, pending_upload_id, kind, idempotency_key, status,
    progress, total, message, attempts
  ) VALUES (
    v_upload.owner_id, v_upload.project_id, v_upload.id, 'document_verification',
    'verification:' || v_upload.id::text, 'queued', 0, NULL,
    'Queued for server-side verification', 0
  ) RETURNING * INTO v_job;
  UPDATE public.pending_document_uploads SET status = 'verification_queued', failure_reason = NULL
   WHERE id = v_upload.id;
  RETURN QUERY SELECT 'verification_queued'::text, NULL::uuid, v_job.id;
END;
$$;

-- Only a live lease owner can atomically transform a verified pending object
-- into a document and its following extraction job. Hash-based advisory
-- serialization plus the existing unique index closes concurrent dedup races.
CREATE OR REPLACE FUNCTION public.complete_document_verification(
  p_job_id UUID, p_worker_id TEXT, p_content_hash TEXT,
  p_actual_size_bytes BIGINT, p_verified_content_type TEXT, p_scan_detail TEXT
) RETURNS TABLE(document_id UUID, deduped BOOLEAN, extraction_job_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job public.extraction_jobs%ROWTYPE;
  v_upload public.pending_document_uploads%ROWTYPE;
  v_existing UUID;
  v_document UUID;
  v_extraction UUID;
BEGIN
  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 THEN RAISE EXCEPTION 'worker id is required'; END IF;
  IF p_content_hash !~ '^[a-f0-9]{64}$' OR p_actual_size_bytes IS NULL OR p_actual_size_bytes < 1 THEN
    RAISE EXCEPTION 'invalid verified upload metadata';
  END IF;
  SELECT * INTO v_job FROM public.extraction_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.kind <> 'document_verification' OR v_job.status <> 'running'
     OR v_job.lease_owner <> p_worker_id OR v_job.lease_expires_at <= now()
     OR v_job.cancellation_requested OR v_job.pending_upload_id IS NULL THEN
    RAISE EXCEPTION 'verification worker does not hold a live lease';
  END IF;
  SELECT * INTO v_upload FROM public.pending_document_uploads WHERE id = v_job.pending_upload_id FOR UPDATE;
  IF NOT FOUND OR v_upload.owner_id <> v_job.owner_id
     OR v_upload.object_path !~ ('^' || v_upload.owner_id::text || '/pending/' || v_upload.id::text || '/') THEN
    RAISE EXCEPTION 'pending upload binding is invalid';
  END IF;
  IF v_upload.status NOT IN ('verification_queued', 'verification_running') OR v_upload.expires_at <= now() THEN
    IF v_upload.status IN ('verification_queued', 'verification_running') THEN
      UPDATE public.pending_document_uploads SET status = 'expired', failure_reason = 'Upload expired during verification' WHERE id = v_upload.id;
    END IF;
    RAISE EXCEPTION 'pending upload is not finalizable';
  END IF;
  IF p_actual_size_bytes <> v_upload.expected_size_bytes THEN
    RAISE EXCEPTION 'uploaded object size does not match authorized size';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'agir:document:' || v_upload.owner_id::text || ':' || coalesce(v_upload.project_id::text, '-') || ':' || p_content_hash, 0));
  SELECT id INTO v_existing FROM public.documents
   WHERE owner_id = v_upload.owner_id AND content_hash = p_content_hash
     AND project_id IS NOT DISTINCT FROM v_upload.project_id
   ORDER BY upload_date ASC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    UPDATE public.pending_document_uploads SET status = 'duplicate', finalized_at = now(), document_id = v_existing,
      failure_reason = 'Duplicate server-computed content hash' WHERE id = v_upload.id;
    INSERT INTO public.audit_logs(project_id, workspace_id, owner_id, user_id, entity_type, entity_id, action, payload)
      VALUES (v_upload.project_id, v_upload.workspace_id, v_upload.owner_id, v_upload.owner_id,
        'documents', v_existing, 'document_upload_duplicate', jsonb_build_object('pending_upload_id', v_upload.id, 'server_hash', true));
    RETURN QUERY SELECT v_existing, true, NULL::uuid;
    RETURN;
  END IF;

  INSERT INTO public.documents(project_id, owner_id, name, file_type, category, storage_path, size_bytes,
    content_hash, extraction_status, scan_status, scan_detail, status)
  VALUES (v_upload.project_id, v_upload.owner_id, v_upload.file_name, p_verified_content_type, v_upload.category,
    v_upload.object_path, p_actual_size_bytes, p_content_hash, 'queued', 'clean', left(p_scan_detail, 1000), 'uploaded')
  RETURNING id INTO v_document;
  INSERT INTO public.extraction_jobs(owner_id, project_id, document_id, kind, idempotency_key, status,
    progress, total, message, attempts)
  VALUES (v_upload.owner_id, v_upload.project_id, v_document, 'document_analysis', p_content_hash,
    'queued', 0, NULL, 'Queued after clean document verification', 0)
  ON CONFLICT (owner_id, kind, idempotency_key) DO NOTHING
  RETURNING id INTO v_extraction;
  IF v_extraction IS NULL THEN
    SELECT id INTO v_extraction FROM public.extraction_jobs
      WHERE owner_id = v_upload.owner_id AND kind = 'document_analysis' AND idempotency_key = p_content_hash;
  END IF;
  UPDATE public.pending_document_uploads SET status = 'finalized', finalized_at = now(), document_id = v_document,
    failure_reason = NULL WHERE id = v_upload.id;
  INSERT INTO public.audit_logs(project_id, workspace_id, owner_id, user_id, entity_type, entity_id, action, payload)
    VALUES (v_upload.project_id, v_upload.workspace_id, v_upload.owner_id, v_upload.owner_id,
      'documents', v_document, 'document_upload_finalized',
      jsonb_build_object('pending_upload_id', v_upload.id, 'server_hash', true, 'verification_job_id', v_job.id));
  RETURN QUERY SELECT v_document, false, v_extraction;
END;
$$;

-- Rejection is terminal and lease-owner-safe. Reasons are deliberately capped
-- and the application passes generic messages only; scanner output is never
-- written verbatim to the audit chain or worker logs.
CREATE OR REPLACE FUNCTION public.reject_document_verification(
  p_job_id UUID, p_worker_id TEXT, p_reason TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job public.extraction_jobs%ROWTYPE; v_upload public.pending_document_uploads%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM public.extraction_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.kind <> 'document_verification' OR v_job.status <> 'running'
     OR v_job.lease_owner <> p_worker_id OR v_job.lease_expires_at <= now()
     OR v_job.pending_upload_id IS NULL THEN RETURN FALSE; END IF;
  SELECT * INTO v_upload FROM public.pending_document_uploads WHERE id = v_job.pending_upload_id FOR UPDATE;
  IF NOT FOUND OR v_upload.owner_id <> v_job.owner_id THEN RETURN FALSE; END IF;
  UPDATE public.pending_document_uploads SET status = 'rejected', failure_reason = left(coalesce(nullif(trim(p_reason), ''), 'Verification rejected'), 240)
    WHERE id = v_upload.id AND pending_document_uploads.status IN ('verification_queued', 'verification_running');
  IF NOT FOUND THEN RETURN FALSE; END IF;
  INSERT INTO public.audit_logs(project_id, workspace_id, owner_id, user_id, entity_type, entity_id, action, payload)
    VALUES (v_upload.project_id, v_upload.workspace_id, v_upload.owner_id, v_upload.owner_id,
      'pending_document_uploads', v_upload.id, 'document_upload_rejected',
      jsonb_build_object('verification_job_id', v_job.id, 'reason_redacted', true));
  RETURN TRUE;
END;
$$;

-- Cleanup claims only unreferenced terminal objects. Claiming changes state
-- before storage deletion, preventing a verifier from racing cleanup.
CREATE OR REPLACE FUNCTION public.claim_document_upload_cleanup(p_limit INTEGER DEFAULT 100)
RETURNS TABLE(upload_id UUID, object_path TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT id FROM public.pending_document_uploads
     WHERE document_id IS NULL
       AND (status IN ('rejected', 'duplicate', 'failed', 'expired', 'cleanup_pending')
            OR (status = 'pending' AND expires_at <= now()))
     ORDER BY expires_at NULLS FIRST, created_at
     FOR UPDATE SKIP LOCKED LIMIT greatest(1, least(coalesce(p_limit, 100), 100))
  ), claimed AS (
    UPDATE public.pending_document_uploads p SET status = 'cleanup_pending',
      failure_reason = coalesce(p.failure_reason, 'Pending object queued for cleanup')
    FROM candidates c WHERE p.id = c.id RETURNING p.id, p.object_path
  ) SELECT id, object_path FROM claimed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_document_verification(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_document_verification(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_document_verification(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_document_upload_cleanup(INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.enqueue_document_verification(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_document_verification(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_document_verification(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_document_upload_cleanup(INTEGER) FROM PUBLIC, anon, authenticated;
