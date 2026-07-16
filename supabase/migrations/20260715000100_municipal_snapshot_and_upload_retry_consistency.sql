-- Phase 3 corrective migration: explicit municipal observation idempotency and
-- one database-owned upload retry rule.
-- MIGRATION_SAFETY_REVIEW: the timestamp uniqueness constraint is removed
-- because observed_at is ordering metadata, not an idempotency identity.
-- Existing snapshot and upload rows are preserved.

ALTER TABLE public.municipal_source_snapshots
  DROP CONSTRAINT IF EXISTS municipal_source_snapshots_source_id_observed_at_key;
ALTER TABLE public.municipal_source_snapshots
  ADD COLUMN IF NOT EXISTS observation_key text;
CREATE UNIQUE INDEX IF NOT EXISTS municipal_source_snapshots_observation_key_idx
  ON public.municipal_source_snapshots(source_id,observation_key)
  WHERE observation_key IS NOT NULL;

-- The canonical-address trigger always replaces this placeholder before write.
-- Declaring the default lets generated clients model inserts accurately.
ALTER TABLE public.properties ALTER COLUMN normalized_address SET DEFAULT '';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.pending_document_uploads WHERE retry_count>3
  ) THEN
    RAISE EXCEPTION
      'pending uploads exceed the canonical retry maximum; reconcile them before migration';
  END IF;
END $$;

ALTER TABLE public.pending_document_uploads
  DROP CONSTRAINT IF EXISTS pending_document_uploads_retry_count_check;
ALTER TABLE public.pending_document_uploads
  ADD CONSTRAINT pending_document_uploads_retry_count_check
    CHECK (retry_count BETWEEN 0 AND 3);
ALTER TABLE public.pending_document_uploads
  ADD COLUMN IF NOT EXISTS retry_allowed boolean GENERATED ALWAYS AS (
    status IN ('failed','rejected')
      AND document_id IS NULL
      AND retry_count<3
  ) STORED;

DROP FUNCTION IF EXISTS public.retry_property_document_upload(uuid);
CREATE FUNCTION public.retry_property_document_upload(p_upload_id uuid)
RETURNS TABLE(status text,job_id uuid,retry_allowed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_upload public.pending_document_uploads%ROWTYPE; v_job uuid;
BEGIN
  SELECT * INTO v_upload FROM public.pending_document_uploads
  WHERE id=p_upload_id FOR UPDATE;
  IF NOT FOUND OR v_upload.property_id IS NULL
      OR NOT public.property_write_access(v_upload.property_id) THEN
    RAISE EXCEPTION 'upload access denied';
  END IF;
  IF NOT v_upload.retry_allowed THEN
    RAISE EXCEPTION 'upload is not eligible for retry';
  END IF;
  UPDATE public.extraction_jobs SET
    status='queued',progress=0,error=NULL,finished_at=NULL,
    scheduled_at=now(),lease_owner=NULL,lease_expires_at=NULL,
    cancellation_requested=false
  WHERE pending_upload_id=v_upload.id AND kind='document_verification'
  RETURNING id INTO v_job;
  IF v_job IS NULL THEN RAISE EXCEPTION 'verification job was not found'; END IF;
  UPDATE public.pending_document_uploads SET
    status='verification_queued',failure_reason=NULL,
    expires_at=greatest(expires_at,now()+interval '15 minutes'),
    retry_count=retry_count+1,last_retry_at=now()
  WHERE id=v_upload.id;
  RETURN QUERY SELECT
    'verification_queued'::text,
    v_job,
    false;
END $$;
REVOKE ALL ON FUNCTION public.retry_property_document_upload(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.retry_property_document_upload(uuid) TO authenticated;
