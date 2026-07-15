-- Pilot remediation program. This migration is deliberately additive because
-- 20260714000100 has already been published. External professional approvals
-- remain evidence supplied by qualified reviewers; schema changes never infer
-- or manufacture those approvals.
-- MIGRATION_SAFETY_REVIEW: the only DELETE is runtime garbage collection of
-- expired, owner-scoped property-search sessions. It is bounded, uses
-- SKIP LOCKED, and cascades only the session's immutable result snapshots.

-- ---------------------------------------------------------------------------
-- Municipal evidence integrity and accountable review ownership

ALTER TABLE public.municipal_research_sources
  ADD COLUMN IF NOT EXISTS last_observed_hash text,
  ADD COLUMN IF NOT EXISTS last_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS integrity_status text NOT NULL DEFAULT 'unchecked'
    CHECK (integrity_status IN ('unchecked','current','changed','unavailable','stale')),
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0
    CHECK (consecutive_failures >= 0);

CREATE TABLE public.municipal_source_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.municipal_research_sources(id) ON DELETE CASCADE,
  observed_at timestamptz NOT NULL DEFAULT now(),
  observation_status text NOT NULL
    CHECK (observation_status IN ('current','changed','unavailable')),
  http_status integer,
  content_hash text CHECK (content_hash IS NULL OR content_hash ~ '^[a-f0-9]{64}$'),
  content_excerpt text,
  etag text,
  last_modified text,
  error_detail text,
  UNIQUE(source_id,observed_at)
);
CREATE INDEX municipal_source_snapshots_source_idx
  ON public.municipal_source_snapshots(source_id,observed_at DESC);

CREATE TABLE public.permit_review_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_id uuid NOT NULL REFERENCES public.jurisdictions(id) ON DELETE CASCADE,
  permit_type text NOT NULL,
  reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewer_name text NOT NULL CHECK (length(trim(reviewer_name)) BETWEEN 2 AND 200),
  reviewer_organization text,
  qualification_basis text NOT NULL CHECK (length(trim(qualification_basis)) >= 10),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz,
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned','in_review','approved','changes_required','withdrawn')),
  notes text,
  CHECK (status <> 'approved' OR completed_at IS NOT NULL),
  UNIQUE(jurisdiction_id,permit_type)
);

ALTER TABLE public.municipal_source_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permit_review_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY municipal_source_snapshots_read ON public.municipal_source_snapshots
  FOR SELECT TO authenticated USING (true);
CREATE POLICY permit_review_assignments_read ON public.permit_review_assignments
  FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.municipal_source_snapshots,public.permit_review_assignments TO authenticated;
GRANT ALL ON public.municipal_source_snapshots,public.permit_review_assignments TO service_role;

CREATE OR REPLACE VIEW public.municipal_catalogue_release_gate AS
SELECT j.id AS jurisdiction_id,j.name AS jurisdiction_name,j.coverage_status,
  count(DISTINCT r.permit_type) FILTER (WHERE r.superseded_at IS NULL) AS active_category_count,
  count(DISTINCT a.permit_type) FILTER (WHERE a.status='approved') AS approved_category_count,
  count(DISTINCT r.permit_type) FILTER (
    WHERE r.superseded_at IS NULL AND r.source_content_hash IS NOT NULL
      AND r.verification_status='verified' AND r.next_review_at>now()
  ) AS current_evidence_category_count,
  bool_and(s.integrity_status='current' AND s.next_check_at>now()) AS sources_current,
  (j.coverage_status='reviewed'
    AND count(DISTINCT r.permit_type) FILTER (WHERE r.superseded_at IS NULL)>0
    AND count(DISTINCT a.permit_type) FILTER (WHERE a.status='approved')
      = count(DISTINCT r.permit_type) FILTER (WHERE r.superseded_at IS NULL)
    AND count(DISTINCT r.permit_type) FILTER (
      WHERE r.superseded_at IS NULL AND r.source_content_hash IS NOT NULL
        AND r.verification_status='verified' AND r.next_review_at>now()
    ) = count(DISTINCT r.permit_type) FILTER (WHERE r.superseded_at IS NULL)
    AND bool_and(s.integrity_status='current' AND s.next_check_at>now())
  ) AS release_ready
FROM public.jurisdictions j
LEFT JOIN public.permit_rules r ON r.jurisdiction_id=j.id
LEFT JOIN public.permit_review_assignments a ON a.jurisdiction_id=j.id
LEFT JOIN public.municipal_research_sources s ON s.jurisdiction_id=j.id
WHERE j.jurisdiction_type='municipality'
GROUP BY j.id,j.name,j.coverage_status;
GRANT SELECT ON public.municipal_catalogue_release_gate TO authenticated,service_role;

CREATE TABLE public.pilot_external_signoffs (
  gate_key text PRIMARY KEY CHECK (gate_key IN (
    'municipal','legal_privacy','accessibility','security','recovery','support_operations')),
  accountable_role text NOT NULL,
  accountable_name text,
  result text NOT NULL DEFAULT 'pending' CHECK (result IN ('pending','approved','rejected','expired')),
  evidence_url text CHECK (evidence_url IS NULL OR evidence_url ~* '^https?://'),
  evidence_hash text CHECK (evidence_hash IS NULL OR evidence_hash ~ '^[a-f0-9]{64}$'),
  signed_at timestamptz,
  expires_at timestamptz,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (result<>'approved' OR
    (accountable_name IS NOT NULL AND evidence_hash IS NOT NULL AND signed_at IS NOT NULL))
);
INSERT INTO public.pilot_external_signoffs(gate_key,accountable_role) VALUES
  ('municipal','Qualified municipal catalogue reviewer'),
  ('legal_privacy','Qualified legal and privacy counsel'),
  ('accessibility','Independent accessibility reviewer'),
  ('security','Independent security assessor'),
  ('recovery','Production recovery exercise owner'),
  ('support_operations','Pilot support and incident owner')
ON CONFLICT(gate_key) DO NOTHING;
ALTER TABLE public.pilot_external_signoffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY pilot_external_signoffs_read ON public.pilot_external_signoffs
  FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.pilot_external_signoffs TO authenticated;
GRANT ALL ON public.pilot_external_signoffs TO service_role;

CREATE OR REPLACE VIEW public.pilot_external_release_gate AS
SELECT count(*)::integer AS required_count,
  count(*) FILTER (WHERE result='approved' AND signed_at IS NOT NULL
    AND (expires_at IS NULL OR expires_at>now()))::integer AS approved_count,
  bool_and(result='approved' AND signed_at IS NOT NULL
    AND (expires_at IS NULL OR expires_at>now())) AS release_ready
FROM public.pilot_external_signoffs;
GRANT SELECT ON public.pilot_external_release_gate TO authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Immutable property-search sessions. Each session stores the exact permitted
-- result rows seen at creation, preventing updates between pages from skipping
-- or duplicating records and providing an exact total without repeated counts.

CREATE TABLE public.property_search_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  filters jsonb NOT NULL,
  total_count integer NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '30 minutes')
);
CREATE TABLE public.property_search_session_items (
  session_id uuid NOT NULL REFERENCES public.property_search_sessions(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 1),
  property_id uuid NOT NULL,
  property_snapshot jsonb NOT NULL,
  match_scope text CHECK (match_scope IN ('current','historical','current_and_historical')),
  PRIMARY KEY(session_id,ordinal),
  UNIQUE(session_id,property_id)
);
CREATE INDEX property_search_sessions_expiry_idx ON public.property_search_sessions(expires_at);
ALTER TABLE public.property_search_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_search_session_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY property_search_sessions_owner_read ON public.property_search_sessions
  FOR SELECT TO authenticated USING (owner_id=auth.uid() AND expires_at>now());
CREATE POLICY property_search_session_items_owner_read ON public.property_search_session_items
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.property_search_sessions s
    WHERE s.id=session_id AND s.owner_id=auth.uid() AND s.expires_at>now()
  ));
GRANT SELECT ON public.property_search_sessions,public.property_search_session_items TO authenticated;
GRANT ALL ON public.property_search_sessions,public.property_search_session_items TO service_role;

CREATE FUNCTION public.create_property_search_session(
  p_workspace_id uuid DEFAULT NULL,p_query text DEFAULT NULL,p_municipality text DEFAULT NULL,
  p_project_type text DEFAULT NULL,p_min_price numeric DEFAULT NULL,p_max_price numeric DEFAULT NULL,
  p_include_archived boolean DEFAULT false
) RETURNS TABLE(session_id uuid,total_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user uuid:=auth.uid(); v_session uuid:=gen_random_uuid(); v_total integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication is required'; END IF;
  IF p_query IS NOT NULL AND (char_length(p_query)>500 OR
    (SELECT count(*)>20 FROM regexp_split_to_table(public.normalize_property_search_text(p_query),'\s+') t WHERE t<>''))
    THEN RAISE EXCEPTION 'invalid property search'; END IF;
  IF p_workspace_id IS NOT NULL AND NOT public.is_workspace_member(p_workspace_id)
    THEN RAISE EXCEPTION 'workspace access denied'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('agir:property-search:'||v_user::text,0));
  DELETE FROM public.property_search_sessions WHERE owner_id=v_user AND expires_at<=now();
  IF (SELECT count(*) FROM public.property_search_sessions WHERE owner_id=v_user)>=5 THEN
    DELETE FROM public.property_search_sessions WHERE id=(
      SELECT id FROM public.property_search_sessions WHERE owner_id=v_user ORDER BY created_at LIMIT 1
    );
  END IF;
  INSERT INTO public.property_search_sessions(id,owner_id,workspace_id,filters)
  VALUES(v_session,v_user,p_workspace_id,jsonb_build_object(
    'query',p_query,'municipality',p_municipality,'project_type',p_project_type,
    'min_price',p_min_price,'max_price',p_max_price,'include_archived',p_include_archived));
  INSERT INTO public.property_search_session_items(session_id,ordinal,property_id,property_snapshot,match_scope)
  SELECT v_session,row_number() OVER (ORDER BY property.updated_at DESC,property.id DESC)::integer,
    property.id,to_jsonb(property),
    CASE WHEN nullif(trim(p_query),'') IS NULL THEN NULL
      WHEN NOT EXISTS (SELECT 1 FROM public.property_query_tokens(p_query) token WHERE NOT EXISTS (
        SELECT 1 FROM public.property_search_documents d WHERE d.property_id=property.id
          AND d.source_type<>'history' AND d.search_text LIKE public.property_search_like_pattern(token) ESCAPE E'\\'))
       AND NOT EXISTS (SELECT 1 FROM public.property_query_tokens(p_query) token WHERE NOT EXISTS (
        SELECT 1 FROM public.property_search_documents d WHERE d.property_id=property.id
          AND d.source_type='history' AND d.search_text LIKE public.property_search_like_pattern(token) ESCAPE E'\\'))
        THEN 'current_and_historical'
      WHEN NOT EXISTS (SELECT 1 FROM public.property_query_tokens(p_query) token WHERE NOT EXISTS (
        SELECT 1 FROM public.property_search_documents d WHERE d.property_id=property.id
          AND d.source_type='history' AND d.search_text LIKE public.property_search_like_pattern(token) ESCAPE E'\\'))
        THEN 'historical'
      ELSE 'current' END
  FROM public.properties property
  WHERE public.property_access(property.id)
    AND ((p_workspace_id IS NULL AND property.workspace_id IS NULL) OR property.workspace_id=p_workspace_id)
    AND (p_include_archived OR property.status='active')
    AND (p_municipality IS NULL OR property.municipality=public.canonical_property_municipality(p_municipality))
    AND (p_project_type IS NULL OR lower(property.project_type)=lower(trim(p_project_type)) OR EXISTS (
      SELECT 1 FROM public.projects project WHERE project.property_id=property.id AND lower(project.type::text)=lower(trim(p_project_type))))
    AND (p_min_price IS NULL OR property.price>=p_min_price)
    AND (p_max_price IS NULL OR property.price<=p_max_price)
    AND (nullif(trim(p_query),'') IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.property_query_tokens(p_query) token WHERE NOT EXISTS (
        SELECT 1 FROM public.property_search_documents document
        WHERE document.property_id=property.id
          AND document.search_text LIKE public.property_search_like_pattern(token) ESCAPE E'\\')))
  ORDER BY property.updated_at DESC,property.id DESC
  LIMIT 100000;
  GET DIAGNOSTICS v_total=ROW_COUNT;
  UPDATE public.property_search_sessions SET total_count=v_total WHERE id=v_session;
  RETURN QUERY SELECT v_session,v_total;
END $$;
REVOKE ALL ON FUNCTION public.create_property_search_session(uuid,text,text,text,numeric,numeric,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_property_search_session(uuid,text,text,text,numeric,numeric,boolean) TO authenticated;

CREATE FUNCTION public.get_property_search_session_page(
  p_session_id uuid,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50
) RETURNS TABLE(property_snapshot jsonb,match_scope text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT i.property_snapshot,i.match_scope
  FROM public.property_search_session_items i
  JOIN public.property_search_sessions s ON s.id=i.session_id
  WHERE i.session_id=p_session_id AND s.owner_id=auth.uid() AND s.expires_at>now()
  ORDER BY i.ordinal
  OFFSET greatest(coalesce(p_offset,0),0)
  LIMIT least(greatest(coalesce(p_limit,50),1),200)
$$;
REVOKE ALL ON FUNCTION public.get_property_search_session_page(uuid,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_property_search_session_page(uuid,integer,integer) TO authenticated;

CREATE FUNCTION public.cleanup_property_search_sessions(p_limit integer DEFAULT 500)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count integer;
BEGIN
  WITH expired AS (SELECT id FROM public.property_search_sessions WHERE expires_at<=now()
    ORDER BY expires_at LIMIT least(greatest(coalesce(p_limit,500),1),5000) FOR UPDATE SKIP LOCKED)
  DELETE FROM public.property_search_sessions s USING expired e WHERE s.id=e.id;
  GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.cleanup_property_search_sessions(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_property_search_sessions(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- Property upload durability, version intent, retry, and collaborator status

ALTER TABLE public.pending_document_uploads
  ADD COLUMN IF NOT EXISTS replaces_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count BETWEEN 0 AND 10),
  ADD COLUMN IF NOT EXISTS last_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS cleaned_at timestamptz;
ALTER TABLE public.pending_document_uploads DROP CONSTRAINT IF EXISTS pending_document_uploads_status_check;
ALTER TABLE public.pending_document_uploads ADD CONSTRAINT pending_document_uploads_status_check CHECK (
  status IN ('pending','verification_queued','verification_running','finalized','duplicate',
    'rejected','failed','expired','cleanup_pending','cleaned'));
ALTER TABLE public.pending_document_uploads DROP CONSTRAINT IF EXISTS pending_document_uploads_property_id_fkey;
ALTER TABLE public.pending_document_uploads ADD CONSTRAINT pending_document_uploads_property_id_fkey
  FOREIGN KEY(property_id) REFERENCES public.properties(id) ON DELETE SET NULL;
ALTER TABLE public.extraction_jobs
  ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE;
UPDATE public.extraction_jobs j SET property_id=d.property_id
FROM public.documents d WHERE j.property_id IS NULL AND j.document_id=d.id;
UPDATE public.extraction_jobs j SET property_id=p.property_id
FROM public.pending_document_uploads p WHERE j.property_id IS NULL AND j.pending_upload_id=p.id;
CREATE INDEX IF NOT EXISTS extraction_jobs_property_idx
  ON public.extraction_jobs(property_id,created_at DESC) WHERE property_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.bind_extraction_job_to_document_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.document_id IS NOT NULL THEN
    SELECT permit_case_id,property_id INTO NEW.permit_case_id,NEW.property_id
    FROM public.documents WHERE id=NEW.document_id;
  ELSIF NEW.pending_upload_id IS NOT NULL THEN
    SELECT permit_case_id,property_id INTO NEW.permit_case_id,NEW.property_id
    FROM public.pending_document_uploads WHERE id=NEW.pending_upload_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS extraction_jobs_bind_permit_case ON public.extraction_jobs;
DROP TRIGGER IF EXISTS extraction_jobs_bind_document_scope ON public.extraction_jobs;
CREATE TRIGGER extraction_jobs_bind_document_scope BEFORE INSERT OR UPDATE OF document_id,pending_upload_id
  ON public.extraction_jobs FOR EACH ROW EXECUTE FUNCTION public.bind_extraction_job_to_document_scope();

DROP POLICY IF EXISTS "extraction_jobs_select_allowed" ON public.extraction_jobs;
CREATE POLICY "extraction_jobs_select_allowed" ON public.extraction_jobs FOR SELECT TO authenticated USING (CASE
  WHEN permit_case_id IS NOT NULL THEN public.permit_case_access(permit_case_id)
  WHEN project_id IS NOT NULL THEN public.permit_project_read_access(project_id)
  WHEN property_id IS NOT NULL THEN public.property_access(property_id)
  ELSE owner_id=auth.uid() END);

CREATE FUNCTION public.prepare_property_document_version_upload(
  p_property_id uuid,p_replaces_document_id uuid,p_file_name text,p_expected_content_type text,
  p_expected_size_bytes bigint,p_category text DEFAULT NULL
) RETURNS TABLE(upload_id uuid,object_path text,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.documents d WHERE d.id=p_replaces_document_id
      AND d.property_id=p_property_id AND public.document_write_access(d.id))
    THEN RAISE EXCEPTION 'replacement document access denied'; END IF;
  SELECT * INTO v_result FROM public.prepare_property_document_upload(
    p_property_id,p_file_name,p_expected_content_type,p_expected_size_bytes,p_category);
  UPDATE public.pending_document_uploads SET replaces_document_id=p_replaces_document_id
  WHERE id=v_result.upload_id AND owner_id=auth.uid();
  RETURN QUERY SELECT v_result.upload_id,v_result.object_path,v_result.expires_at;
END $$;
REVOKE ALL ON FUNCTION public.prepare_property_document_version_upload(uuid,uuid,text,text,bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.prepare_property_document_version_upload(uuid,uuid,text,text,bigint,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.bind_verified_document_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_previous uuid; v_version integer;
BEGIN
  SELECT replaces_document_id INTO v_previous FROM public.pending_document_uploads
  WHERE object_path=NEW.storage_path;
  IF v_previous IS NOT NULL THEN
    SELECT version_number+1 INTO v_version FROM public.documents WHERE id=v_previous FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'replacement document no longer exists'; END IF;
    NEW.replaces_document_id:=v_previous; NEW.version_number:=v_version;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS documents_bind_verified_version ON public.documents;
CREATE TRIGGER documents_bind_verified_version BEFORE INSERT ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.bind_verified_document_version();

CREATE FUNCTION public.retry_property_document_upload(p_upload_id uuid)
RETURNS TABLE(status text,job_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_upload public.pending_document_uploads%ROWTYPE; v_job uuid;
BEGIN
  SELECT * INTO v_upload FROM public.pending_document_uploads WHERE id=p_upload_id FOR UPDATE;
  IF NOT FOUND OR v_upload.property_id IS NULL OR NOT public.property_write_access(v_upload.property_id)
    THEN RAISE EXCEPTION 'upload access denied'; END IF;
  IF v_upload.status NOT IN ('failed','rejected') OR v_upload.document_id IS NOT NULL
    THEN RAISE EXCEPTION 'only unfinalized failed uploads can be retried'; END IF;
  IF v_upload.retry_count>=3 THEN RAISE EXCEPTION 'upload retry limit reached'; END IF;
  UPDATE public.extraction_jobs SET status='queued',progress=0,error=NULL,finished_at=NULL,
    scheduled_at=now(),lease_owner=NULL,lease_expires_at=NULL,cancellation_requested=false
  WHERE pending_upload_id=v_upload.id AND kind='document_verification'
  RETURNING id INTO v_job;
  IF v_job IS NULL THEN RAISE EXCEPTION 'verification job was not found'; END IF;
  UPDATE public.pending_document_uploads SET status='verification_queued',failure_reason=NULL,
    expires_at=greatest(expires_at,now()+interval '15 minutes'),retry_count=retry_count+1,last_retry_at=now()
  WHERE id=v_upload.id;
  RETURN QUERY SELECT 'verification_queued'::text,v_job;
END $$;
REVOKE ALL ON FUNCTION public.retry_property_document_upload(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.retry_property_document_upload(uuid) TO authenticated;

-- Finalization deduplicates within the shared parent rather than within the
-- uploader. This prevents two collaborators from creating two evidence rows
-- for the same bytes while retaining the original requester for attribution.
CREATE OR REPLACE FUNCTION public.complete_document_verification(
  p_job_id uuid,p_worker_id text,p_content_hash text,p_actual_size_bytes bigint,
  p_verified_content_type text,p_scan_detail text
) RETURNS TABLE(document_id uuid,deduped boolean,extraction_job_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job public.extraction_jobs%ROWTYPE; v_upload public.pending_document_uploads%ROWTYPE;
 v_existing uuid; v_existing_owner uuid; v_document uuid; v_extraction uuid; v_key text;
BEGIN
 IF p_worker_id IS NULL OR length(trim(p_worker_id))=0 THEN RAISE EXCEPTION 'worker id is required'; END IF;
 IF p_content_hash!~'^[a-f0-9]{64}$' OR p_actual_size_bytes IS NULL OR p_actual_size_bytes<1 THEN RAISE EXCEPTION 'invalid verified upload metadata'; END IF;
 SELECT * INTO v_job FROM public.extraction_jobs WHERE id=p_job_id FOR UPDATE;
 IF NOT FOUND OR v_job.kind<>'document_verification' OR v_job.status<>'running' OR v_job.lease_owner<>p_worker_id OR v_job.lease_expires_at<=now() OR v_job.cancellation_requested OR v_job.pending_upload_id IS NULL THEN RAISE EXCEPTION 'verification worker does not hold a live lease'; END IF;
 SELECT * INTO v_upload FROM public.pending_document_uploads WHERE id=v_job.pending_upload_id FOR UPDATE;
 IF NOT FOUND OR v_upload.owner_id<>v_job.owner_id OR v_upload.object_path!~('^'||v_upload.owner_id::text||'/pending/'||v_upload.id::text||'/') THEN RAISE EXCEPTION 'pending upload binding is invalid'; END IF;
 IF v_upload.status NOT IN ('verification_queued','verification_running') OR v_upload.expires_at<=now() THEN RAISE EXCEPTION 'pending upload is not finalizable'; END IF;
 IF NOT public.document_parent_write_access_for_user(v_upload.project_id,v_upload.permit_case_id,v_upload.property_id,v_upload.owner_id) THEN RAISE EXCEPTION 'upload requester no longer has parent access'; END IF;
 IF p_actual_size_bytes<>v_upload.expected_size_bytes THEN RAISE EXCEPTION 'uploaded object size does not match authorized size'; END IF;
 v_key:=p_content_hash||CASE WHEN v_upload.permit_case_id IS NOT NULL THEN ':case:'||v_upload.permit_case_id::text WHEN v_upload.project_id IS NOT NULL THEN ':project:'||v_upload.project_id::text ELSE ':property:'||v_upload.property_id::text END;
 PERFORM pg_advisory_xact_lock(hashtextextended('agir:document:'||coalesce(v_upload.permit_case_id::text,v_upload.project_id::text,v_upload.property_id::text)||':'||p_content_hash,0));
 SELECT id,owner_id INTO v_existing,v_existing_owner FROM public.documents WHERE content_hash=p_content_hash
   AND project_id IS NOT DISTINCT FROM v_upload.project_id
   AND permit_case_id IS NOT DISTINCT FROM v_upload.permit_case_id
   AND property_id IS NOT DISTINCT FROM v_upload.property_id
   ORDER BY upload_date LIMIT 1 FOR UPDATE;
 IF FOUND THEN
  UPDATE public.pending_document_uploads SET status='duplicate',finalized_at=now(),document_id=v_existing,failure_reason='Duplicate server-computed content hash' WHERE id=v_upload.id;
  INSERT INTO public.audit_logs(project_id,workspace_id,owner_id,user_id,entity_type,entity_id,action,payload)
  VALUES(v_upload.project_id,v_upload.workspace_id,v_upload.owner_id,v_upload.owner_id,'documents',v_existing,'document_upload_duplicate',
    jsonb_build_object('pending_upload_id',v_upload.id,'permit_case_id',v_upload.permit_case_id,'property_id',v_upload.property_id,'server_hash',true,'cross_collaborator',v_existing_owner IS DISTINCT FROM v_upload.owner_id));
  RETURN QUERY SELECT v_existing,true,NULL::uuid; RETURN;
 END IF;
 INSERT INTO public.documents(project_id,permit_case_id,property_id,owner_id,name,file_type,category,storage_path,size_bytes,content_hash,extraction_status,scan_status,scan_detail,status)
 VALUES(v_upload.project_id,v_upload.permit_case_id,v_upload.property_id,v_upload.owner_id,v_upload.file_name,p_verified_content_type,v_upload.category,v_upload.object_path,p_actual_size_bytes,p_content_hash,'queued','clean',left(p_scan_detail,1000),'uploaded') RETURNING id INTO v_document;
 INSERT INTO public.extraction_jobs(owner_id,project_id,permit_case_id,property_id,document_id,kind,idempotency_key,status,progress,total,message,attempts)
 VALUES(v_upload.owner_id,v_upload.project_id,v_upload.permit_case_id,v_upload.property_id,v_document,'document_analysis',v_key,'queued',0,NULL,'Queued after clean document verification',0)
 ON CONFLICT(owner_id,kind,idempotency_key) DO NOTHING RETURNING id INTO v_extraction;
 IF v_extraction IS NULL THEN SELECT id INTO v_extraction FROM public.extraction_jobs WHERE owner_id=v_upload.owner_id AND kind='document_analysis' AND idempotency_key=v_key; END IF;
 UPDATE public.pending_document_uploads SET status='finalized',finalized_at=now(),document_id=v_document,failure_reason=NULL WHERE id=v_upload.id;
 INSERT INTO public.audit_logs(project_id,workspace_id,owner_id,user_id,entity_type,entity_id,action,payload)
 VALUES(v_upload.project_id,v_upload.workspace_id,v_upload.owner_id,v_upload.owner_id,'documents',v_document,'document_upload_finalized',
   jsonb_build_object('pending_upload_id',v_upload.id,'permit_case_id',v_upload.permit_case_id,'property_id',v_upload.property_id,'server_hash',true,'verification_job_id',v_job.id));
 RETURN QUERY SELECT v_document,false,v_extraction;
END $$;

CREATE OR REPLACE FUNCTION public.mark_property_uploads_for_cleanup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.pending_document_uploads SET status='cleanup_pending',
    failure_reason=coalesce(failure_reason,'Property deleted before upload finalization')
  WHERE property_id=OLD.id AND document_id IS NULL
    AND status IN ('pending','verification_queued','verification_running','failed','rejected','expired');
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS properties_pending_upload_cleanup ON public.properties;
CREATE TRIGGER properties_pending_upload_cleanup BEFORE DELETE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.mark_property_uploads_for_cleanup();

CREATE FUNCTION public.complete_document_upload_cleanup(p_upload_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.pending_document_uploads SET status='cleaned',cleaned_at=now()
  WHERE id=p_upload_id AND status='cleanup_pending' AND document_id IS NULL;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.complete_document_upload_cleanup(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_document_upload_cleanup(uuid) TO service_role;

-- Document deletion is a two-phase operation. The application records intent;
-- a trusted cleanup worker removes Storage bytes and only then atomically
-- removes metadata. A failed Storage deletion leaves the document usable.
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE TABLE public.document_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  storage_path text NOT NULL,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','failed','completed')),
  error_detail text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  completed_at timestamptz
);
CREATE UNIQUE INDEX document_deletion_one_live_request_idx
  ON public.document_deletion_requests(document_id) WHERE document_id IS NOT NULL AND status IN ('pending','claimed');
CREATE INDEX document_deletion_queue_idx ON public.document_deletion_requests(status,requested_at);
ALTER TABLE public.document_deletion_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_deletion_requests_read ON public.document_deletion_requests
  FOR SELECT TO authenticated USING (requested_by=auth.uid() OR
    (property_id IS NOT NULL AND public.property_access(property_id)));
GRANT SELECT ON public.document_deletion_requests TO authenticated;
GRANT ALL ON public.document_deletion_requests TO service_role;

CREATE FUNCTION public.request_document_deletion(p_document_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_doc public.documents%ROWTYPE; v_request uuid;
BEGIN
  SELECT * INTO v_doc FROM public.documents WHERE id=p_document_id FOR UPDATE;
  IF NOT FOUND OR NOT public.document_write_access(p_document_id)
    THEN RAISE EXCEPTION 'document deletion access denied'; END IF;
  IF EXISTS (SELECT 1 FROM public.documents WHERE replaces_document_id=p_document_id)
    THEN RAISE EXCEPTION 'a document with newer versions cannot be removed'; END IF;
  IF v_doc.deletion_requested_at IS NOT NULL THEN
    SELECT id INTO v_request FROM public.document_deletion_requests
    WHERE document_id=p_document_id AND status IN ('pending','claimed') ORDER BY requested_at DESC LIMIT 1;
    RETURN v_request;
  END IF;
  INSERT INTO public.document_deletion_requests(document_id,property_id,storage_path,requested_by)
  VALUES(v_doc.id,v_doc.property_id,v_doc.storage_path,auth.uid()) RETURNING id INTO v_request;
  UPDATE public.documents SET deletion_requested_at=now(),deletion_requested_by=auth.uid()
  WHERE id=v_doc.id;
  RETURN v_request;
END $$;
REVOKE ALL ON FUNCTION public.request_document_deletion(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_document_deletion(uuid) TO authenticated;

CREATE FUNCTION public.claim_document_deletions(p_limit integer DEFAULT 100)
RETURNS TABLE(request_id uuid,document_id uuid,storage_path text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  RETURN QUERY WITH candidates AS (
    SELECT id FROM public.document_deletion_requests WHERE status IN ('pending','failed')
    ORDER BY requested_at FOR UPDATE SKIP LOCKED LIMIT least(greatest(coalesce(p_limit,100),1),500)
  ), claimed AS (
    UPDATE public.document_deletion_requests r SET status='claimed',claimed_at=now(),error_detail=NULL
    FROM candidates c WHERE r.id=c.id RETURNING r.id,r.document_id,r.storage_path
  ) SELECT claimed.id,claimed.document_id,claimed.storage_path FROM claimed;
END $$;
CREATE FUNCTION public.complete_document_deletion(p_request_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_document uuid;
BEGIN
  SELECT document_id INTO v_document FROM public.document_deletion_requests
  WHERE id=p_request_id AND status='claimed' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  DELETE FROM public.documents WHERE id=v_document AND deletion_requested_at IS NOT NULL;
  UPDATE public.document_deletion_requests SET status='completed',completed_at=now(),document_id=NULL
  WHERE id=p_request_id;
  RETURN true;
END $$;
CREATE FUNCTION public.fail_document_deletion(p_request_id uuid,p_error text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.document_deletion_requests SET status='failed',error_detail=left(p_error,1000)
  WHERE id=p_request_id AND status='claimed';
  UPDATE public.documents d SET deletion_requested_at=NULL,deletion_requested_by=NULL
  FROM public.document_deletion_requests r WHERE r.id=p_request_id AND d.id=r.document_id;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.claim_document_deletions(integer),
  public.complete_document_deletion(uuid),public.fail_document_deletion(uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_document_deletions(integer),
  public.complete_document_deletion(uuid),public.fail_document_deletion(uuid,text) TO service_role;
