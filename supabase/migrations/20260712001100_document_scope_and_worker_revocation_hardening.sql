-- Document and extraction access follows the current parent scope. Retained
-- uploader attribution is evidence, not a permanent authorization grant.

CREATE OR REPLACE FUNCTION public.document_parent_write_access_for_user(
  p_project_id uuid,
  p_permit_case_id uuid,
  p_user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT p_user_id IS NOT NULL AND CASE
    WHEN p_permit_case_id IS NOT NULL THEN EXISTS (
      SELECT 1 FROM public.permit_cases c
      WHERE c.id=p_permit_case_id AND c.archived_at IS NULL AND (
        (c.workspace_id IS NULL AND c.owner_id=p_user_id)
        OR EXISTS (
          SELECT 1 FROM public.workspace_members m
          WHERE m.workspace_id=c.workspace_id AND m.user_id=p_user_id
            AND m.role IN ('owner','admin','member')
        )
      )
    )
    WHEN p_project_id IS NOT NULL THEN EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id=p_project_id AND (
        (p.workspace_id IS NULL AND p.owner_id=p_user_id)
        OR EXISTS (
          SELECT 1 FROM public.workspace_members m
          WHERE m.workspace_id=p.workspace_id AND m.user_id=p_user_id
            AND m.role IN ('owner','admin','member')
        )
      )
    )
    ELSE true
  END
$$;

CREATE OR REPLACE FUNCTION public.document_read_access(p_document_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.id=p_document_id AND CASE
      WHEN d.permit_case_id IS NOT NULL THEN public.permit_case_access(d.permit_case_id)
      WHEN d.project_id IS NOT NULL THEN public.permit_project_read_access(d.project_id)
      ELSE d.owner_id=auth.uid()
    END
  )
$$;

CREATE OR REPLACE FUNCTION public.document_parent_write_access(
  p_project_id uuid,
  p_permit_case_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.document_parent_write_access_for_user(
    p_project_id,p_permit_case_id,auth.uid()
  )
$$;

CREATE OR REPLACE FUNCTION public.document_write_access(p_document_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.id=p_document_id
      AND public.document_parent_write_access_for_user(
        d.project_id,d.permit_case_id,auth.uid()
      )
      AND (
        d.project_id IS NOT NULL OR d.permit_case_id IS NOT NULL
        OR d.owner_id=auth.uid()
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.document_storage_read_access(p_storage_path text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.storage_path=p_storage_path AND public.document_read_access(d.id)
  )
$$;

CREATE OR REPLACE FUNCTION public.document_storage_delete_access(p_storage_path text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.storage_path=p_storage_path AND d.owner_id=auth.uid()
      AND public.document_write_access(d.id)
  )
$$;

CREATE OR REPLACE FUNCTION public.pending_upload_storage_insert_access(
  p_storage_path text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pending_document_uploads p
    WHERE p.owner_id=auth.uid() AND p.object_path=p_storage_path
      AND p.status='pending' AND p.expires_at>now()
      AND public.document_parent_write_access_for_user(
        p.project_id,p.permit_case_id,auth.uid()
      )
  )
$$;

REVOKE ALL ON FUNCTION public.document_parent_write_access_for_user(uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.document_parent_write_access_for_user(uuid,uuid,uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.document_read_access(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.document_write_access(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.document_parent_write_access(uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.document_storage_read_access(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.document_storage_delete_access(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.pending_upload_storage_insert_access(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.document_read_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.document_write_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.document_parent_write_access(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.document_storage_read_access(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.document_storage_delete_access(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pending_upload_storage_insert_access(text) TO authenticated;

-- A service worker may finalize an upload only while the original requester
-- still has contributor access. The same trigger also propagates the canonical
-- Property link before the existing graph validator runs.
CREATE OR REPLACE FUNCTION public.enforce_document_requester_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_property_id uuid;
BEGIN
  IF NEW.owner_id IS NULL THEN RAISE EXCEPTION 'document requester is required'; END IF;
  IF NOT public.document_parent_write_access_for_user(
    NEW.project_id,NEW.permit_case_id,NEW.owner_id
  ) THEN RAISE EXCEPTION 'document requester no longer has parent access'; END IF;
  IF NEW.permit_case_id IS NOT NULL THEN
    SELECT property_id INTO v_property_id FROM public.permit_cases
    WHERE id=NEW.permit_case_id;
  ELSIF NEW.project_id IS NOT NULL THEN
    SELECT property_id INTO v_property_id FROM public.projects
    WHERE id=NEW.project_id;
  END IF;
  IF NEW.property_id IS NULL THEN NEW.property_id:=v_property_id; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS aaa_documents_requester_scope ON public.documents;
CREATE TRIGGER aaa_documents_requester_scope
  BEFORE INSERT ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_document_requester_scope();

CREATE OR REPLACE FUNCTION public.enforce_pending_upload_requester_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('verification_running','finalized','duplicate')
     AND NOT public.document_parent_write_access_for_user(
       NEW.project_id,NEW.permit_case_id,NEW.owner_id
     ) THEN
    RAISE EXCEPTION 'upload requester no longer has parent access';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS pending_uploads_requester_scope ON public.pending_document_uploads;
CREATE TRIGGER pending_uploads_requester_scope
  BEFORE UPDATE OF status ON public.pending_document_uploads
  FOR EACH ROW EXECUTE FUNCTION public.enforce_pending_upload_requester_scope();

DROP POLICY IF EXISTS "documents_owner_select" ON public.documents;
DROP POLICY IF EXISTS "documents_owner_update" ON public.documents;
DROP POLICY IF EXISTS "documents_owner_delete" ON public.documents;
DROP POLICY IF EXISTS documents_permit_case_select ON public.documents;
DROP POLICY IF EXISTS documents_permit_case_update ON public.documents;
DROP POLICY IF EXISTS documents_permit_case_delete ON public.documents;
DROP POLICY IF EXISTS documents_scope_select ON public.documents;
DROP POLICY IF EXISTS documents_scope_update ON public.documents;
DROP POLICY IF EXISTS documents_scope_delete ON public.documents;
CREATE POLICY documents_scope_select ON public.documents FOR SELECT TO authenticated
  USING (public.document_read_access(id));
CREATE POLICY documents_scope_update ON public.documents FOR UPDATE TO authenticated
  USING (public.document_write_access(id))
  WITH CHECK (public.document_write_access(id));
CREATE POLICY documents_scope_delete ON public.documents FOR DELETE TO authenticated
  USING (owner_id=auth.uid() AND public.document_write_access(id));

-- Parent identity and durable attribution are never browser-writable. These
-- are the only columns used by authenticated server functions for reviewed
-- metadata, extraction state, and an authorized Property cross-link.
REVOKE UPDATE ON public.documents FROM authenticated;
GRANT UPDATE (
  property_id,category,status,extraction_status,extraction_error,
  scan_status,scan_detail,page_count,ocr_confidence,
  ai_summary,ai_assumptions,ai_risks
) ON public.documents TO authenticated;

DROP POLICY IF EXISTS "pending_document_uploads_owner_select"
  ON public.pending_document_uploads;
DROP POLICY IF EXISTS pending_document_uploads_case_select
  ON public.pending_document_uploads;
DROP POLICY IF EXISTS pending_document_uploads_scope_select
  ON public.pending_document_uploads;
CREATE POLICY pending_document_uploads_scope_select
  ON public.pending_document_uploads FOR SELECT TO authenticated
  USING (
    CASE
      WHEN permit_case_id IS NOT NULL THEN public.permit_case_access(permit_case_id)
      WHEN project_id IS NOT NULL THEN public.permit_project_read_access(project_id)
      ELSE owner_id=auth.uid()
    END
  );

DROP POLICY IF EXISTS "extraction_jobs_select_allowed" ON public.extraction_jobs;
DROP POLICY IF EXISTS "extraction_jobs_insert_allowed" ON public.extraction_jobs;
DROP POLICY IF EXISTS "extraction_jobs_update_allowed" ON public.extraction_jobs;
CREATE POLICY "extraction_jobs_select_allowed" ON public.extraction_jobs
  FOR SELECT TO authenticated
  USING (
    CASE
      WHEN permit_case_id IS NOT NULL THEN public.permit_case_access(permit_case_id)
      WHEN project_id IS NOT NULL THEN public.permit_project_read_access(project_id)
      ELSE owner_id=auth.uid()
    END
  );
CREATE POLICY "extraction_jobs_insert_allowed" ON public.extraction_jobs
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id=auth.uid() AND CASE
      WHEN permit_case_id IS NOT NULL OR project_id IS NOT NULL THEN
        public.document_parent_write_access(project_id,permit_case_id)
      WHEN document_id IS NOT NULL THEN EXISTS (
        SELECT 1 FROM public.documents d
        WHERE d.id=extraction_jobs.document_id AND d.owner_id=auth.uid()
          AND d.project_id IS NULL AND d.permit_case_id IS NULL
      )
      ELSE false
    END
  );
CREATE POLICY "extraction_jobs_update_allowed" ON public.extraction_jobs
  FOR UPDATE TO authenticated
  USING (
    owner_id=auth.uid() AND (
      (project_id IS NULL AND permit_case_id IS NULL)
      OR public.document_parent_write_access(project_id,permit_case_id)
    )
  )
  WITH CHECK (
    owner_id=auth.uid() AND (
      (project_id IS NULL AND permit_case_id IS NULL)
      OR public.document_parent_write_access(project_id,permit_case_id)
    )
  );

DROP POLICY IF EXISTS "documents_select_own" ON storage.objects;
DROP POLICY IF EXISTS "documents_update_own" ON storage.objects;
DROP POLICY IF EXISTS "documents_delete_own" ON storage.objects;
DROP POLICY IF EXISTS documents_case_storage_select ON storage.objects;
DROP POLICY IF EXISTS documents_scope_storage_select ON storage.objects;
DROP POLICY IF EXISTS documents_scope_storage_delete ON storage.objects;
CREATE POLICY documents_scope_storage_select ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id='documents' AND (
      public.document_storage_read_access(name)
      OR public.pending_upload_storage_insert_access(name)
    )
  );
CREATE POLICY documents_scope_storage_delete ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id='documents' AND public.document_storage_delete_access(name)
  );

DROP POLICY IF EXISTS "documents_insert_authorized_pending_upload" ON storage.objects;
CREATE POLICY "documents_insert_authorized_pending_upload" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id='documents' AND public.pending_upload_storage_insert_access(name)
  );

REVOKE ALL ON FUNCTION public.enforce_document_requester_scope()
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.enforce_pending_upload_requester_scope()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_document_requester_scope() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_pending_upload_requester_scope() TO service_role;
