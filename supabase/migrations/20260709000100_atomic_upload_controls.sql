-- Atomic upload resource controls and a server-authorized staged upload flow.
--
-- MIGRATION_SAFETY_REVIEW: This migration deliberately removes authenticated
-- direct document INSERT and unrestricted Storage INSERT. Document rows may
-- only be created by finalize_document_upload after server-side verification.
-- Rollback: see docs/security/2026-07-09-production-hardening.md before
-- reverting, because restoring the old Storage policy re-enables direct upload.

CREATE TABLE IF NOT EXISTS public.pending_document_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  object_path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  expected_content_type TEXT,
  expected_size_bytes BIGINT NOT NULL CHECK (expected_size_bytes > 0 AND expected_size_bytes <= 78643200),
  category TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'finalized', 'duplicate', 'rejected', 'failed', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  finalized_at TIMESTAMPTZ,
  document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (object_path LIKE owner_id::text || '/pending/' || id::text || '/%')
);

CREATE INDEX IF NOT EXISTS pending_document_uploads_owner_status_expiry_idx
  ON public.pending_document_uploads(owner_id, status, expires_at);
CREATE INDEX IF NOT EXISTS pending_document_uploads_project_created_idx
  ON public.pending_document_uploads(project_id, created_at DESC);

ALTER TABLE public.pending_document_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pending_document_uploads_owner_select" ON public.pending_document_uploads
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
GRANT SELECT ON public.pending_document_uploads TO authenticated;
GRANT ALL ON public.pending_document_uploads TO service_role;

CREATE OR REPLACE FUNCTION public.touch_pending_document_uploads_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS pending_document_uploads_touch ON public.pending_document_uploads;
CREATE TRIGGER pending_document_uploads_touch
  BEFORE UPDATE ON public.pending_document_uploads
  FOR EACH ROW EXECUTE FUNCTION public.touch_pending_document_uploads_updated_at();

-- Consumes a generic rate-limit token under a per-user/bucket transaction
-- advisory lock. This is intentionally an RPC rather than a client-side
-- read-then-insert sequence so concurrent requests cannot oversubscribe.
CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_bucket TEXT,
  p_cost INTEGER,
  p_max_events INTEGER,
  p_window_seconds INTEGER,
  p_workspace_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user UUID := auth.uid();
  v_used BIGINT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication is required'; END IF;
  IF p_bucket IS NULL OR char_length(trim(p_bucket)) = 0 OR p_cost < 1
     OR p_max_events < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'invalid rate-limit policy';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('agir:rate:' || v_user::text || ':' || p_bucket, 0));
  SELECT coalesce(sum(cost), 0) INTO v_used
    FROM public.rate_limit_events
   WHERE owner_id = v_user AND bucket = p_bucket
     AND created_at >= now() - make_interval(secs => p_window_seconds);
  IF v_used + p_cost > p_max_events THEN RETURN FALSE; END IF;
  INSERT INTO public.rate_limit_events(owner_id, workspace_id, bucket, cost, metadata)
  VALUES (v_user, p_workspace_id, p_bucket, p_cost, coalesce(p_metadata, '{}'::jsonb));
  RETURN TRUE;
END;
$$;

-- Reserves both the upload quota and upload rate-limit atomically, validates
-- project/workspace write authority, and binds a storage path to this one
-- pending upload. No browser-controlled path is accepted.
CREATE OR REPLACE FUNCTION public.prepare_document_upload(
  p_project_id UUID,
  p_file_name TEXT,
  p_expected_content_type TEXT,
  p_expected_size_bytes BIGINT,
  p_category TEXT DEFAULT NULL
) RETURNS TABLE(upload_id UUID, object_path TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user UUID := auth.uid();
  v_workspace UUID;
  v_allowed BOOLEAN := false;
  v_files BIGINT;
  v_bytes NUMERIC;
  v_rate_used BIGINT;
  v_id UUID := gen_random_uuid();
  v_safe_name TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication is required'; END IF;
  IF p_expected_size_bytes IS NULL OR p_expected_size_bytes < 1 OR p_expected_size_bytes > 78643200 THEN
    RAISE EXCEPTION 'invalid upload size';
  END IF;
  IF p_file_name IS NULL OR char_length(trim(p_file_name)) NOT BETWEEN 1 AND 255
     OR p_file_name ~ '[\\/]' OR p_file_name LIKE '%..%' THEN
    RAISE EXCEPTION 'invalid file name';
  END IF;
  IF lower(p_file_name) !~ '\.(pdf|xlsx|xls|docx|doc|csv|txt|png|jpg|jpeg)$' THEN
    RAISE EXCEPTION 'unsupported file type';
  END IF;

  IF p_project_id IS NOT NULL THEN
    SELECT p.workspace_id,
           (p.owner_id = v_user OR (p.workspace_id IS NOT NULL AND public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')))
      INTO v_workspace, v_allowed
      FROM public.projects p WHERE p.id = p_project_id;
    IF NOT FOUND OR NOT coalesce(v_allowed, false) THEN RAISE EXCEPTION 'project access denied'; END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('agir:upload:' || v_user::text, 0));
  SELECT coalesce(sum(cost), 0) INTO v_rate_used
    FROM public.rate_limit_events
   WHERE owner_id = v_user AND bucket = 'document_upload'
     AND created_at >= now() - interval '24 hours';
  IF v_rate_used >= 200 THEN RAISE EXCEPTION 'upload rate limit reached'; END IF;

  SELECT count(*), coalesce(sum(size_bytes), 0) INTO v_files, v_bytes
    FROM public.documents
   WHERE owner_id = v_user AND upload_date >= now() - interval '24 hours';
  SELECT v_files + count(*), v_bytes + coalesce(sum(expected_size_bytes), 0)
    INTO v_files, v_bytes
    FROM public.pending_document_uploads
   WHERE owner_id = v_user AND status = 'pending' AND expires_at > now();
  IF v_files >= 200 THEN RAISE EXCEPTION 'daily upload file quota reached'; END IF;
  IF v_bytes + p_expected_size_bytes > 2147483648 THEN RAISE EXCEPTION 'daily upload byte quota reached'; END IF;

  v_safe_name := regexp_replace(p_file_name, '[^A-Za-z0-9._-]', '_', 'g');
  INSERT INTO public.pending_document_uploads(
    id, owner_id, project_id, workspace_id, object_path, file_name,
    expected_content_type, expected_size_bytes, category, expires_at
  ) VALUES (
    v_id, v_user, p_project_id, v_workspace,
    v_user::text || '/pending/' || v_id::text || '/' || v_safe_name,
    p_file_name, nullif(trim(p_expected_content_type), ''), p_expected_size_bytes,
    nullif(trim(p_category), ''), now() + interval '15 minutes'
  );
  INSERT INTO public.rate_limit_events(owner_id, workspace_id, bucket, cost, metadata)
  VALUES (v_user, v_workspace, 'document_upload', 1,
    jsonb_build_object('pending_upload_id', v_id, 'expected_size_bytes', p_expected_size_bytes));
  RETURN QUERY SELECT v_id,
    v_user::text || '/pending/' || v_id::text || '/' || v_safe_name,
    now() + interval '15 minutes';
END;
$$;

-- The application supplies measurements only after its own authenticated
-- download and AV/structural scan. This function locks the pending row and
-- makes duplicate handling + usable document creation one transaction.
CREATE OR REPLACE FUNCTION public.finalize_document_upload(
  p_upload_id UUID,
  p_owner_id UUID,
  p_content_hash TEXT,
  p_actual_size_bytes BIGINT,
  p_verified_content_type TEXT,
  p_scan_detail TEXT
) RETURNS TABLE(document_id UUID, deduped BOOLEAN, object_path TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_upload public.pending_document_uploads%ROWTYPE;
  v_existing UUID;
  v_doc UUID;
BEGIN
  IF p_owner_id IS NULL THEN RAISE EXCEPTION 'verified upload owner is required'; END IF;
  IF p_content_hash !~ '^[a-f0-9]{64}$' OR p_actual_size_bytes IS NULL OR p_actual_size_bytes < 1 THEN
    RAISE EXCEPTION 'invalid verified upload metadata';
  END IF;
  SELECT * INTO v_upload FROM public.pending_document_uploads
   WHERE id = p_upload_id AND owner_id = p_owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pending upload not found'; END IF;
  IF v_upload.status IN ('finalized', 'duplicate') THEN
    RETURN QUERY SELECT v_upload.document_id, v_upload.status = 'duplicate', v_upload.object_path;
    RETURN;
  END IF;
  IF v_upload.status <> 'pending' OR v_upload.expires_at <= now() THEN
    UPDATE public.pending_document_uploads SET status = 'expired', failure_reason = 'Upload expired before finalization'
      WHERE id = v_upload.id AND status = 'pending';
    RAISE EXCEPTION 'pending upload has expired or is not finalizable';
  END IF;
  IF p_actual_size_bytes <> v_upload.expected_size_bytes THEN
    UPDATE public.pending_document_uploads SET status = 'rejected', failure_reason = 'Object size did not match authorized size'
      WHERE id = v_upload.id;
    RAISE EXCEPTION 'uploaded object size does not match authorized size';
  END IF;

  SELECT id INTO v_existing FROM public.documents
   WHERE owner_id = p_owner_id AND content_hash = p_content_hash
     AND project_id IS NOT DISTINCT FROM v_upload.project_id
   ORDER BY upload_date ASC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    UPDATE public.pending_document_uploads
       SET status = 'duplicate', finalized_at = now(), document_id = v_existing,
           failure_reason = 'Duplicate content hash'
     WHERE id = v_upload.id;
    RETURN QUERY SELECT v_existing, true, v_upload.object_path;
    RETURN;
  END IF;

  INSERT INTO public.documents(
    project_id, owner_id, name, file_type, category, storage_path, size_bytes,
    content_hash, extraction_status, scan_status, scan_detail, status
  ) VALUES (
    v_upload.project_id, p_owner_id, v_upload.file_name, p_verified_content_type,
    v_upload.category, v_upload.object_path, p_actual_size_bytes, p_content_hash,
    'pending', 'clean', p_scan_detail, 'uploaded'
  ) RETURNING id INTO v_doc;
  UPDATE public.pending_document_uploads
     SET status = 'finalized', finalized_at = now(), document_id = v_doc
   WHERE id = v_upload.id;
  RETURN QUERY SELECT v_doc, false, v_upload.object_path;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_document_upload(p_upload_id UUID, p_owner_id UUID, p_reason TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_owner_id IS NULL THEN RAISE EXCEPTION 'verified upload owner is required'; END IF;
  UPDATE public.pending_document_uploads
     SET status = 'rejected', failure_reason = left(coalesce(p_reason, 'Upload rejected'), 1000)
   WHERE id = p_upload_id AND owner_id = p_owner_id AND status = 'pending';
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_rate_limit(TEXT, INTEGER, INTEGER, INTEGER, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_document_upload(UUID, TEXT, TEXT, BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_document_upload(UUID, UUID, TEXT, BIGINT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_document_upload(UUID, UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.consume_rate_limit(TEXT, INTEGER, INTEGER, INTEGER, UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prepare_document_upload(UUID, TEXT, TEXT, BIGINT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalize_document_upload(UUID, UUID, TEXT, BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_document_upload(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- A browser cannot fabricate a usable document row. The SECURITY DEFINER
-- finalization RPC above bypasses RLS only after it has locked the pending row.
DROP POLICY IF EXISTS "documents_owner_all" ON public.documents;
DROP POLICY IF EXISTS "documents_workspace_member_insert" ON public.documents;
CREATE POLICY "documents_owner_select" ON public.documents FOR SELECT TO authenticated
  USING (owner_id = auth.uid());
CREATE POLICY "documents_owner_update" ON public.documents FOR UPDATE TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "documents_owner_delete" ON public.documents FOR DELETE TO authenticated
  USING (owner_id = auth.uid());
REVOKE INSERT ON public.documents FROM authenticated;

-- Storage paths are only writable while their matching server-created pending
-- row is live. Existing objects remain readable/deletable under the existing
-- user-folder policy, but no new arbitrary browser path can be inserted.
DROP POLICY IF EXISTS "documents_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "documents_update_own" ON storage.objects;
CREATE POLICY "documents_insert_authorized_pending_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documents' AND EXISTS (
      SELECT 1 FROM public.pending_document_uploads p
       WHERE p.owner_id = auth.uid() AND p.object_path = name
         AND p.status = 'pending' AND p.expires_at > now()
    )
  );
