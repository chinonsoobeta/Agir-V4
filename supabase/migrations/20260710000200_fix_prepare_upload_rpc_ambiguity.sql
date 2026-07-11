-- PostgreSQL 17 resolves the RETURNS TABLE output name `expires_at` against
-- the unqualified pending_uploads column ambiguously. Keep this repair
-- additive: replace the RPC with explicitly qualified table columns rather
-- than altering the already-deployed historical migration.

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
      INTO v_workspace, v_allowed FROM public.projects p WHERE p.id = p_project_id;
    IF NOT FOUND OR NOT coalesce(v_allowed, false) THEN RAISE EXCEPTION 'project access denied'; END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('agir:upload:' || v_user::text, 0));
  SELECT coalesce(sum(r.cost), 0) INTO v_rate_used FROM public.rate_limit_events r
   WHERE r.owner_id = v_user AND r.bucket = 'document_upload' AND r.created_at >= now() - interval '24 hours';
  IF v_rate_used >= 200 THEN RAISE EXCEPTION 'upload rate limit reached'; END IF;
  SELECT count(*), coalesce(sum(d.size_bytes), 0) INTO v_files, v_bytes FROM public.documents d
   WHERE d.owner_id = v_user AND d.upload_date >= now() - interval '24 hours';
  SELECT v_files + count(*), v_bytes + coalesce(sum(p.expected_size_bytes), 0) INTO v_files, v_bytes
   FROM public.pending_document_uploads p
   WHERE p.owner_id = v_user AND p.status = 'pending' AND p.expires_at > now();
  IF v_files >= 200 THEN RAISE EXCEPTION 'daily upload file quota reached'; END IF;
  IF v_bytes + p_expected_size_bytes > 2147483648 THEN RAISE EXCEPTION 'daily upload byte quota reached'; END IF;
  v_safe_name := regexp_replace(p_file_name, '[^A-Za-z0-9._-]', '_', 'g');
  INSERT INTO public.pending_document_uploads(id, owner_id, project_id, workspace_id, object_path, file_name,
    expected_content_type, expected_size_bytes, category, expires_at)
  VALUES (v_id, v_user, p_project_id, v_workspace,
    v_user::text || '/pending/' || v_id::text || '/' || v_safe_name,
    p_file_name, nullif(trim(p_expected_content_type), ''), p_expected_size_bytes,
    nullif(trim(p_category), ''), now() + interval '15 minutes');
  INSERT INTO public.rate_limit_events(owner_id, workspace_id, bucket, cost, metadata)
  VALUES (v_user, v_workspace, 'document_upload', 1,
    jsonb_build_object('pending_upload_id', v_id, 'expected_size_bytes', p_expected_size_bytes));
  RETURN QUERY SELECT v_id, v_user::text || '/pending/' || v_id::text || '/' || v_safe_name,
    now() + interval '15 minutes';
END;
$$;
