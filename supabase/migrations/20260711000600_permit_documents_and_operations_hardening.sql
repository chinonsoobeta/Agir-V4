-- Standalone permit document ownership and mutation hardening.
-- Architecture: a document has at most one permit-case parent, while existing
-- permit_documents/permit_requirements bridges allow reuse across many permits.
-- Linked cases may retain both project_id and permit_case_id; detaching a case
-- clears only the project pointer and never moves or duplicates the object.
-- Existing storage_path values are unchanged.
-- Recovery: disable Permit mode, restore from the pre-deploy backup, or clear
-- permit_case_id after verifying no standalone documents depend on it. Do not
-- delete Storage objects during recovery.

ALTER TABLE public.documents
  ADD COLUMN permit_case_id uuid REFERENCES public.permit_cases(id) ON DELETE CASCADE,
  ADD COLUMN version_number integer NOT NULL DEFAULT 1 CHECK (version_number > 0),
  ADD COLUMN replaces_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  ADD COLUMN extraction_review_status text NOT NULL DEFAULT 'not_reviewed'
    CHECK (extraction_review_status IN ('not_reviewed','needs_review','accepted','rejected'));
ALTER TABLE public.pending_document_uploads
  ADD COLUMN permit_case_id uuid REFERENCES public.permit_cases(id) ON DELETE CASCADE;
ALTER TABLE public.extraction_jobs
  ADD COLUMN permit_case_id uuid REFERENCES public.permit_cases(id) ON DELETE CASCADE;

CREATE INDEX documents_permit_case_idx ON public.documents(permit_case_id,upload_date DESC);
CREATE INDEX documents_replaces_idx ON public.documents(replaces_document_id);
CREATE INDEX pending_uploads_permit_case_idx ON public.pending_document_uploads(permit_case_id,created_at DESC);
CREATE INDEX extraction_jobs_permit_case_idx ON public.extraction_jobs(permit_case_id,created_at DESC);
CREATE UNIQUE INDEX uq_documents_case_content_hash ON public.documents(permit_case_id,content_hash)
  WHERE permit_case_id IS NOT NULL AND content_hash IS NOT NULL;

ALTER TABLE public.permit_cases ADD COLUMN row_version bigint NOT NULL DEFAULT 1;
ALTER TABLE public.project_permits ADD COLUMN row_version bigint NOT NULL DEFAULT 1;
ALTER TABLE public.permit_requirements
  ADD COLUMN source_kind text NOT NULL DEFAULT 'unknown'
    CHECK (source_kind IN ('verified_source','analyst','extracted','reported','unknown','needs_review','not_applicable')),
  ADD COLUMN source_url text,
  ADD COLUMN responsible_party text,
  ADD COLUMN applicability_state text NOT NULL DEFAULT 'unresolved'
    CHECK (applicability_state IN ('required','potentially_required','unresolved','not_applicable')),
  ADD COLUMN status_reason text;

ALTER TABLE public.project_permits
  ADD CONSTRAINT project_permits_application_url_safe CHECK (application_url IS NULL OR application_url ~* '^https?://'),
  ADD CONSTRAINT project_permits_duration_source_safe CHECK (duration_source IS NULL OR duration_source !~* '^(javascript|data|file):');
ALTER TABLE public.permit_requirements
  ADD CONSTRAINT permit_requirements_source_url_safe CHECK (source_url IS NULL OR source_url ~* '^https?://'),
  ADD CONSTRAINT permit_requirements_na_reason CHECK (status <> 'not_applicable' OR length(trim(status_reason)) > 0);

CREATE OR REPLACE FUNCTION public.bump_permit_row_version() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$ BEGIN NEW.row_version:=OLD.row_version+1; NEW.updated_at:=now(); RETURN NEW; END $$;
CREATE TRIGGER permit_cases_version BEFORE UPDATE ON public.permit_cases FOR EACH ROW EXECUTE FUNCTION public.bump_permit_row_version();
CREATE TRIGGER project_permits_version BEFORE UPDATE ON public.project_permits FOR EACH ROW EXECUTE FUNCTION public.bump_permit_row_version();

DROP POLICY IF EXISTS documents_permit_case_select ON public.documents;
DROP POLICY IF EXISTS documents_permit_case_update ON public.documents;
DROP POLICY IF EXISTS documents_permit_case_delete ON public.documents;
CREATE POLICY documents_permit_case_select ON public.documents FOR SELECT TO authenticated
  USING (permit_case_id IS NOT NULL AND public.permit_case_access(permit_case_id));
CREATE POLICY documents_permit_case_update ON public.documents FOR UPDATE TO authenticated
  USING (permit_case_id IS NOT NULL AND public.permit_case_write_access(permit_case_id))
  WITH CHECK (owner_id=auth.uid() AND permit_case_id IS NOT NULL AND public.permit_case_write_access(permit_case_id));
CREATE POLICY documents_permit_case_delete ON public.documents FOR DELETE TO authenticated
  USING (owner_id=auth.uid() AND permit_case_id IS NOT NULL AND public.permit_case_write_access(permit_case_id));

DROP POLICY IF EXISTS pending_document_uploads_case_select ON public.pending_document_uploads;
CREATE POLICY pending_document_uploads_case_select ON public.pending_document_uploads FOR SELECT TO authenticated
  USING (permit_case_id IS NOT NULL AND public.permit_case_access(permit_case_id));

DROP POLICY IF EXISTS documents_case_storage_select ON storage.objects;
CREATE POLICY documents_case_storage_select ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id='documents' AND EXISTS (
    SELECT 1 FROM public.documents d WHERE d.storage_path=name AND d.permit_case_id IS NOT NULL
      AND public.permit_case_access(d.permit_case_id)
  )
);

CREATE OR REPLACE FUNCTION public.prepare_permit_document_upload(
  p_permit_case_id uuid, p_file_name text, p_expected_content_type text,
  p_expected_size_bytes bigint, p_category text DEFAULT NULL
) RETURNS TABLE(upload_id uuid,object_path text,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user uuid:=auth.uid(); v_case public.permit_cases%ROWTYPE; v_id uuid:=gen_random_uuid(); v_safe text;
  v_files bigint; v_bytes numeric; v_rate bigint;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'authentication is required'; END IF;
 SELECT * INTO v_case FROM public.permit_cases WHERE id=p_permit_case_id;
 IF NOT FOUND OR NOT public.permit_case_write_access(p_permit_case_id) THEN RAISE EXCEPTION 'permit case access denied'; END IF;
 IF p_expected_size_bytes IS NULL OR p_expected_size_bytes<1 OR p_expected_size_bytes>78643200 THEN RAISE EXCEPTION 'invalid upload size'; END IF;
 IF p_file_name IS NULL OR length(trim(p_file_name)) NOT BETWEEN 1 AND 255 OR p_file_name~'[\\/]' OR p_file_name LIKE '%..%'
   OR lower(p_file_name)!~'\.(pdf|xlsx|xls|docx|doc|csv|txt|png|jpg|jpeg)$' THEN RAISE EXCEPTION 'invalid or unsupported file name'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('agir:upload:'||v_user::text,0));
 SELECT coalesce(sum(cost),0) INTO v_rate FROM public.rate_limit_events WHERE owner_id=v_user AND bucket='document_upload' AND created_at>=now()-interval '24 hours';
 IF v_rate>=200 THEN RAISE EXCEPTION 'upload rate limit reached'; END IF;
 SELECT count(*),coalesce(sum(size_bytes),0) INTO v_files,v_bytes FROM public.documents WHERE owner_id=v_user AND upload_date>=now()-interval '24 hours';
 IF v_files>=200 OR v_bytes+p_expected_size_bytes>2147483648 THEN RAISE EXCEPTION 'daily upload quota reached'; END IF;
 v_safe:=regexp_replace(p_file_name,'[^A-Za-z0-9._-]','_','g');
 INSERT INTO public.pending_document_uploads(id,owner_id,project_id,workspace_id,permit_case_id,object_path,file_name,expected_content_type,expected_size_bytes,category,expires_at)
 VALUES(v_id,v_user,v_case.project_id,v_case.workspace_id,v_case.id,v_user::text||'/pending/'||v_id::text||'/'||v_safe,p_file_name,nullif(trim(p_expected_content_type),''),p_expected_size_bytes,nullif(trim(p_category),''),now()+interval '15 minutes');
 INSERT INTO public.rate_limit_events(owner_id,workspace_id,bucket,cost,metadata) VALUES(v_user,v_case.workspace_id,'document_upload',1,jsonb_build_object('pending_upload_id',v_id,'permit_case_id',v_case.id));
 RETURN QUERY SELECT v_id,v_user::text||'/pending/'||v_id::text||'/'||v_safe,now()+interval '15 minutes';
END $$;
GRANT EXECUTE ON FUNCTION public.prepare_permit_document_upload(uuid,text,text,bigint,text) TO authenticated;
REVOKE ALL ON FUNCTION public.prepare_permit_document_upload(uuid,text,text,bigint,text) FROM PUBLIC,anon;

-- Bind worker-created documents/jobs to the pending case without changing the
-- existing verified-upload worker contract.
CREATE OR REPLACE FUNCTION public.bind_verified_document_to_permit_case() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_case uuid;
BEGIN
 SELECT permit_case_id INTO v_case FROM public.pending_document_uploads WHERE object_path=NEW.storage_path;
 IF v_case IS NOT NULL THEN NEW.permit_case_id:=v_case; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER documents_bind_permit_case BEFORE INSERT ON public.documents FOR EACH ROW EXECUTE FUNCTION public.bind_verified_document_to_permit_case();
CREATE OR REPLACE FUNCTION public.bind_extraction_job_to_permit_case() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN IF NEW.document_id IS NOT NULL THEN SELECT permit_case_id INTO NEW.permit_case_id FROM public.documents WHERE id=NEW.document_id; END IF; RETURN NEW; END $$;
CREATE TRIGGER extraction_jobs_bind_permit_case BEFORE INSERT ON public.extraction_jobs FOR EACH ROW EXECUTE FUNCTION public.bind_extraction_job_to_permit_case();

-- Case and permit history remain server/trigger written only.
REVOKE INSERT,UPDATE,DELETE ON public.permit_case_history,public.permit_history FROM authenticated;
GRANT SELECT ON public.permit_case_history,public.permit_history TO authenticated;
