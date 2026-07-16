-- Phase 2 corrective migration: linear document versions and recoverable,
-- scope-aware document deletion.
-- MIGRATION_SAFETY_REVIEW: constraints and policies are replaced to enforce
-- stronger invariants. Existing evidence rows are never rewritten or deleted.
-- Unique-index creation deliberately fails if the Phase 0 audit found an
-- unresolved version fork or multiple live requests for the same document.

CREATE INDEX IF NOT EXISTS pending_document_uploads_object_path_idx
  ON public.pending_document_uploads(object_path);

CREATE UNIQUE INDEX IF NOT EXISTS documents_one_successor_idx
  ON public.documents(replaces_document_id)
  WHERE replaces_document_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pending_document_uploads_one_live_replacement_idx
  ON public.pending_document_uploads(replaces_document_id)
  WHERE replaces_document_id IS NOT NULL
    AND status IN ('pending','verification_queued','verification_running');

CREATE OR REPLACE FUNCTION public.prepare_property_document_version_upload(
  p_property_id uuid,p_replaces_document_id uuid,p_file_name text,p_expected_content_type text,
  p_expected_size_bytes bigint,p_category text DEFAULT NULL
) RETURNS TABLE(upload_id uuid,object_path text,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_previous public.documents%ROWTYPE; v_result record;
BEGIN
  SELECT * INTO v_previous FROM public.documents
  WHERE id=p_replaces_document_id FOR UPDATE;
  IF NOT FOUND OR v_previous.property_id<>p_property_id
      OR NOT public.document_write_access(p_replaces_document_id) THEN
    RAISE EXCEPTION 'replacement document access denied';
  END IF;
  IF v_previous.deletion_requested_at IS NOT NULL THEN
    RAISE EXCEPTION 'replacement document removal is already queued';
  END IF;
  IF EXISTS (SELECT 1 FROM public.documents d
      WHERE d.replaces_document_id=p_replaces_document_id) THEN
    RAISE EXCEPTION 'only the latest document version can be replaced';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pending_document_uploads p
      WHERE p.replaces_document_id=p_replaces_document_id
        AND p.status IN ('pending','verification_queued','verification_running')) THEN
    RAISE EXCEPTION 'a replacement upload is already active';
  END IF;

  SELECT * INTO v_result FROM public.prepare_property_document_upload(
    p_property_id,p_file_name,p_expected_content_type,p_expected_size_bytes,p_category);
  UPDATE public.pending_document_uploads
  SET replaces_document_id=p_replaces_document_id
  WHERE id=v_result.upload_id AND owner_id=auth.uid();
  RETURN QUERY SELECT v_result.upload_id,v_result.object_path,v_result.expires_at;
END $$;

CREATE OR REPLACE FUNCTION public.bind_verified_document_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_previous uuid; v_version integer;
BEGIN
  SELECT replaces_document_id INTO v_previous
  FROM public.pending_document_uploads
  WHERE object_path=NEW.storage_path;
  IF v_previous IS NOT NULL THEN
    SELECT version_number+1 INTO v_version
    FROM public.documents
    WHERE id=v_previous AND deletion_requested_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'replacement document is missing or queued for removal';
    END IF;
    IF EXISTS (SELECT 1 FROM public.documents d
        WHERE d.replaces_document_id=v_previous) THEN
      RAISE EXCEPTION 'only the latest document version can be replaced';
    END IF;
    NEW.replaces_document_id:=v_previous;
    NEW.version_number:=v_version;
  END IF;
  RETURN NEW;
END $$;

-- Persist authorization scope after document_id is cleared on completion.
ALTER TABLE public.document_deletion_requests
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS permit_case_id uuid REFERENCES public.permit_cases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS storage_deleted_at timestamptz;

UPDATE public.document_deletion_requests r SET
  project_id=d.project_id,
  permit_case_id=d.permit_case_id,
  property_id=coalesce(r.property_id,d.property_id),
  workspace_id=coalesce(c.workspace_id,p.workspace_id,prop.workspace_id)
FROM public.documents d
LEFT JOIN public.permit_cases c ON c.id=d.permit_case_id
LEFT JOIN public.projects p ON p.id=d.project_id
LEFT JOIN public.properties prop ON prop.id=d.property_id
WHERE r.document_id=d.id;

ALTER TABLE public.document_deletion_requests
  DROP CONSTRAINT IF EXISTS document_deletion_requests_status_check;
UPDATE public.document_deletion_requests SET status='retryable',next_attempt_at=now()
WHERE status IN ('failed','claimed');
ALTER TABLE public.document_deletion_requests
  ADD CONSTRAINT document_deletion_requests_status_check CHECK (
    status IN ('pending','claimed','retryable','terminal_failed','completed','cancelled')
  );

UPDATE public.documents d SET
  deletion_requested_at=coalesce(d.deletion_requested_at,r.requested_at),
  deletion_requested_by=coalesce(d.deletion_requested_by,r.requested_by)
FROM public.document_deletion_requests r
WHERE r.document_id=d.id AND r.status IN ('pending','retryable','terminal_failed');

DROP INDEX IF EXISTS public.document_deletion_one_live_request_idx;
CREATE UNIQUE INDEX document_deletion_one_live_request_idx
  ON public.document_deletion_requests(document_id)
  WHERE document_id IS NOT NULL
    AND status IN ('pending','claimed','retryable','terminal_failed');
CREATE INDEX IF NOT EXISTS document_deletion_retry_queue_idx
  ON public.document_deletion_requests(status,next_attempt_at,requested_at);

DROP POLICY IF EXISTS document_deletion_requests_read ON public.document_deletion_requests;
CREATE POLICY document_deletion_requests_read ON public.document_deletion_requests
  FOR SELECT TO authenticated USING (
    CASE
      WHEN permit_case_id IS NOT NULL THEN public.permit_case_access(permit_case_id)
      WHEN project_id IS NOT NULL THEN public.permit_project_read_access(project_id)
      WHEN property_id IS NOT NULL THEN public.property_access(property_id)
      ELSE requested_by=auth.uid()
    END
  );

CREATE OR REPLACE FUNCTION public.request_document_deletion(p_document_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_doc public.documents%ROWTYPE; v_request uuid; v_workspace uuid;
BEGIN
  SELECT * INTO v_doc FROM public.documents WHERE id=p_document_id FOR UPDATE;
  IF NOT FOUND OR NOT public.document_write_access(p_document_id) THEN
    RAISE EXCEPTION 'document deletion access denied';
  END IF;
  IF EXISTS (SELECT 1 FROM public.documents WHERE replaces_document_id=p_document_id) THEN
    RAISE EXCEPTION 'a document with newer versions cannot be removed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pending_document_uploads
      WHERE replaces_document_id=p_document_id
        AND status IN ('pending','verification_queued','verification_running')) THEN
    RAISE EXCEPTION 'a replacement upload is active for this document';
  END IF;
  SELECT id INTO v_request FROM public.document_deletion_requests
  WHERE document_id=p_document_id
    AND status IN ('pending','claimed','retryable','terminal_failed')
  ORDER BY requested_at DESC LIMIT 1;
  IF FOUND THEN RETURN v_request; END IF;

  IF v_doc.permit_case_id IS NOT NULL THEN
    SELECT workspace_id INTO v_workspace FROM public.permit_cases WHERE id=v_doc.permit_case_id;
  ELSIF v_doc.project_id IS NOT NULL THEN
    SELECT workspace_id INTO v_workspace FROM public.projects WHERE id=v_doc.project_id;
  ELSIF v_doc.property_id IS NOT NULL THEN
    SELECT workspace_id INTO v_workspace FROM public.properties WHERE id=v_doc.property_id;
  END IF;

  INSERT INTO public.document_deletion_requests(
    document_id,workspace_id,project_id,permit_case_id,property_id,storage_path,requested_by
  ) VALUES(
    v_doc.id,v_workspace,v_doc.project_id,v_doc.permit_case_id,v_doc.property_id,
    v_doc.storage_path,auth.uid()
  ) RETURNING id INTO v_request;
  UPDATE public.documents SET deletion_requested_at=now(),deletion_requested_by=auth.uid()
  WHERE id=v_doc.id;
  RETURN v_request;
END $$;

CREATE OR REPLACE FUNCTION public.claim_document_deletions(p_limit integer DEFAULT 100)
RETURNS TABLE(request_id uuid,document_id uuid,storage_path text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  -- A worker crash after Storage removal is safe to retry: the metadata row
  -- remains locked and Storage removal is idempotently attempted again.
  UPDATE public.document_deletion_requests
  SET status=CASE WHEN attempt_count>=max_attempts THEN 'terminal_failed' ELSE 'retryable' END,
    next_attempt_at=now(),error_detail='stale deletion claim recovered'
  WHERE status='claimed' AND claimed_at<now()-interval '15 minutes';

  UPDATE public.document_deletion_requests r
  SET status='terminal_failed',error_detail='document deletion invariant no longer matches metadata'
  WHERE r.status IN ('pending','retryable') AND NOT EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.id=r.document_id AND d.deletion_requested_at IS NOT NULL
      AND d.storage_path=r.storage_path
  );

  RETURN QUERY WITH candidates AS (
    SELECT r.id FROM public.document_deletion_requests r
    JOIN public.documents d ON d.id=r.document_id
      AND d.deletion_requested_at IS NOT NULL AND d.storage_path=r.storage_path
    WHERE r.status IN ('pending','retryable')
      AND r.next_attempt_at<=now() AND r.attempt_count<r.max_attempts
    ORDER BY r.next_attempt_at,r.requested_at
    FOR UPDATE OF r SKIP LOCKED
    LIMIT least(greatest(coalesce(p_limit,100),1),500)
  ), claimed AS (
    UPDATE public.document_deletion_requests r SET
      status='claimed',claimed_at=now(),last_attempt_at=now(),
      attempt_count=r.attempt_count+1,error_detail=NULL
    FROM candidates c WHERE r.id=c.id
    RETURNING r.id,r.document_id,r.storage_path
  )
  SELECT claimed.id,claimed.document_id,claimed.storage_path FROM claimed;
END $$;

CREATE OR REPLACE FUNCTION public.complete_document_deletion(p_request_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request public.document_deletion_requests%ROWTYPE; v_deleted integer;
BEGIN
  SELECT * INTO v_request FROM public.document_deletion_requests
  WHERE id=p_request_id AND status='claimed' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM public.documents d
  WHERE d.id=v_request.document_id AND d.deletion_requested_at IS NOT NULL
    AND d.storage_path=v_request.storage_path FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE public.document_deletion_requests
    SET status='terminal_failed',error_detail='metadata did not match claimed deletion'
    WHERE id=p_request_id;
    RETURN false;
  END IF;
  DELETE FROM public.documents
  WHERE id=v_request.document_id AND deletion_requested_at IS NOT NULL
    AND storage_path=v_request.storage_path;
  GET DIAGNOSTICS v_deleted=ROW_COUNT;
  IF v_deleted<>1 THEN
    UPDATE public.document_deletion_requests
    SET status='terminal_failed',error_detail='metadata deletion did not remove exactly one row'
    WHERE id=p_request_id;
    RETURN false;
  END IF;
  UPDATE public.document_deletion_requests SET
    status='completed',completed_at=now(),storage_deleted_at=now(),document_id=NULL
  WHERE id=p_request_id;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.fail_document_deletion(p_request_id uuid,p_error text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request public.document_deletion_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request FROM public.document_deletion_requests
  WHERE id=p_request_id AND status='claimed' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.document_deletion_requests SET
    status=CASE WHEN attempt_count>=max_attempts THEN 'terminal_failed' ELSE 'retryable' END,
    error_detail=left(coalesce(p_error,'storage deletion failed'),1000),
    next_attempt_at=now()+make_interval(
      secs=>least(3600,(30*power(2,greatest(attempt_count-1,0)))::integer)
    )
  WHERE id=p_request_id;
  -- Deliberately retain deletion_requested_at. The UI must never present a
  -- document as usable after a deletion attempt until cancellation succeeds.
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_document_deletion(p_document_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request public.document_deletion_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request FROM public.document_deletion_requests
  WHERE document_id=p_document_id AND status IN ('pending','retryable','terminal_failed')
    AND storage_deleted_at IS NULL
  ORDER BY requested_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR NOT public.document_write_access(p_document_id) THEN
    RAISE EXCEPTION 'document deletion cannot be cancelled';
  END IF;
  UPDATE public.document_deletion_requests SET
    status='cancelled',cancelled_at=now(),error_detail=NULL
  WHERE id=v_request.id;
  UPDATE public.documents SET deletion_requested_at=NULL,deletion_requested_by=NULL
  WHERE id=p_document_id AND deletion_requested_at IS NOT NULL;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.cancel_document_deletion(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cancel_document_deletion(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.claim_document_deletions(integer),
  public.complete_document_deletion(uuid),public.fail_document_deletion(uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_document_deletions(integer),
  public.complete_document_deletion(uuid),public.fail_document_deletion(uuid,text)
  TO service_role;
