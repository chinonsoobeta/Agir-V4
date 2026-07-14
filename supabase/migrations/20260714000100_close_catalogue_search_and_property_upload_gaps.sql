-- Close the July pilot catalogue, property pagination, and property-file gaps.
-- "researched" means that an official municipal source set was checked. It
-- deliberately does not mean that a municipality or qualified professional
-- approved the catalogue or that a rule applies to a particular property.

ALTER TABLE public.jurisdictions
  DROP CONSTRAINT IF EXISTS jurisdictions_coverage_status_check;
ALTER TABLE public.jurisdictions
  ADD CONSTRAINT jurisdictions_coverage_status_check
  CHECK (coverage_status IN ('not_started','partial','researched','reviewed'));
ALTER TABLE public.jurisdictions
  ADD COLUMN IF NOT EXISTS research_completed_at timestamptz;

CREATE TABLE IF NOT EXISTS public.municipal_research_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_id uuid NOT NULL REFERENCES public.jurisdictions(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('permit_index','building','planning')),
  source_title text NOT NULL CHECK (length(trim(source_title)) BETWEEN 1 AND 300),
  source_url text NOT NULL CHECK (source_url ~* '^https://'),
  applicability_note text NOT NULL,
  checked_at timestamptz NOT NULL,
  next_check_at timestamptz NOT NULL,
  UNIQUE(jurisdiction_id,source_kind,source_url)
);
ALTER TABLE public.municipal_research_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS municipal_research_sources_read ON public.municipal_research_sources;
CREATE POLICY municipal_research_sources_read ON public.municipal_research_sources
  FOR SELECT TO authenticated USING (true);
REVOKE INSERT,UPDATE,DELETE ON public.municipal_research_sources FROM authenticated;
GRANT SELECT ON public.municipal_research_sources TO authenticated;
GRANT ALL ON public.municipal_research_sources TO service_role;

WITH sources(name,source_kind,source_title,source_url) AS (VALUES
  ('Village of Anmore','permit_index','Building and development','https://anmore.com/building-development/'),
  ('Village of Belcarra','building','Building Department','https://belcarra.ca/services/building-department/'),
  ('Bowen Island Municipality','permit_index','Online planning applications','https://bowenislandmunicipality.ca/online-planning-applications/'),
  ('City of Burnaby','permit_index','Permits and construction','https://www.burnaby.ca/services-and-payments/permits-and-construction'),
  ('City of Coquitlam','permit_index','Planning and development resources','https://www.coquitlam.ca/225/Planning-and-Development-Resources'),
  ('City of Delta','permit_index','Permits and licences','https://www.delta.ca/services/permits-licences'),
  ('City of Langley','permit_index','Applications, forms and permits','https://www.langleycity.ca/city-services/applications-forms-permits'),
  ('Township of Langley','permit_index','Building and development','https://www.tol.ca/en/building-development/building.aspx'),
  ('Village of Lions Bay','permit_index','Forms and applications','https://www.lionsbay.ca/services/administration/forms-applications'),
  ('City of Maple Ridge','permit_index','Construction, development and permits','https://www.mapleridge.ca/build-do-business/construction-development-permits'),
  ('City of New Westminster','planning','Making a development application','https://www.newwestcity.ca/development-policies-and-process/making-a-development-application'),
  ('City of North Vancouver','planning','Active land-use applications','https://www.cnv.org/Business-Development/Building/Land-Use-Approvals/Active-Applications'),
  ('District of North Vancouver','planning','Development permit application procedure','https://docs.dnv.org/documents/Development_Permit_Application_Procedure.pdf'),
  ('City of Pitt Meadows','permit_index','Planning and Development Services','https://www.pittmeadows.ca/city-hall/city-departments/planning-and-development-services'),
  ('City of Port Coquitlam','permit_index','Property development and building','https://www.portcoquitlam.ca/business-development/property-development-building'),
  ('City of Port Moody','planning','Development application process','https://www.portmoody.ca/business-development-and-planning/development/development-application-process/'),
  ('City of Richmond','permit_index','Planning and Development','https://richmond.ca/city-hall/city-departments/planning-development.htm'),
  ('City of Surrey','permit_index','Renovating, building and development','https://www.surrey.ca/renovating-building-development'),
  ('City of Vancouver','permit_index','Building and renovating forms and checklists','https://vancouver.ca/home-property-development/application-forms-and-checklists.aspx'),
  ('District of West Vancouver','permit_index','Building permits and inspections','https://westvancouver.ca/business-development/building-development/building-permits-inspections'),
  ('City of White Rock','permit_index','Building permits','https://www.whiterockcity.ca/941/Building-Permits'),
  ('City of Kelowna','permit_index','Building permits and inspections','https://www.kelowna.ca/homes-building/building-permits-inspections')
)
INSERT INTO public.municipal_research_sources(
  jurisdiction_id,source_kind,source_title,source_url,applicability_note,checked_at,next_check_at
)
SELECT j.id,s.source_kind,s.source_title,s.source_url,
  'Official source inventory checked. Project-specific applicability, exemptions, prerequisite approvals, forms, fees, and processing time must still be confirmed against the current source and case facts.',
  '2026-07-14T12:00:00-07:00'::timestamptz,'2026-10-14T12:00:00-07:00'::timestamptz
FROM sources s JOIN public.jurisdictions j ON j.name=s.name AND j.province='British Columbia'
ON CONFLICT(jurisdiction_id,source_kind,source_url) DO UPDATE SET
  source_title=excluded.source_title,
  applicability_note=excluded.applicability_note,
  checked_at=excluded.checked_at,
  next_check_at=excluded.next_check_at;

UPDATE public.jurisdictions j SET
  coverage_status=CASE WHEN j.coverage_status='reviewed' THEN 'reviewed' ELSE 'researched' END,
  coverage_summary=CASE WHEN j.coverage_status='reviewed' THEN j.coverage_summary
    ELSE 'Official municipal permit and planning source inventory completed. Category and case applicability remain unapproved until qualified review.' END,
  research_completed_at=coalesce(j.research_completed_at,'2026-07-14T12:00:00-07:00'::timestamptz),
  coverage_updated_at='2026-07-14T12:00:00-07:00'::timestamptz
WHERE EXISTS (
  SELECT 1 FROM public.municipal_research_sources s WHERE s.jurisdiction_id=j.id
);

-- Replace generic homepages on placeholder rows with the checked official
-- municipality source. Unknown remains unknown: research completion alone is
-- never sufficient to generate a required permit.
UPDATE public.permit_rules r SET
  official_source_url=s.source_url,
  source_title=s.source_title,
  source_text='Official municipal permit/planning source inventory checked on 2026-07-14. This category has no project-specific determination.',
  application_url=s.source_url,
  freshness_status='not_reviewed',
  official_source_status='official',
  availability_status='available',
  known_limitations='Source inventory only. Confirm category-specific requirements, exemptions, prerequisites, documents, fees, timing, and applicability with the issuing authority.',
  updated_at=now()
FROM public.municipal_research_sources s
WHERE r.jurisdiction_id=s.jurisdiction_id
  AND r.rule_version='2026-07-12-coverage-v1'
  AND s.source_kind='permit_index';

-- Keyset pagination searches the complete permitted property set. The caller
-- asks for N rows and the RPC returns at most N+1 so it can expose has-more
-- without an unbounded count.
DROP FUNCTION IF EXISTS public.search_properties(
  uuid,text,text,text,numeric,numeric,boolean,integer
);
CREATE FUNCTION public.search_properties_page(
  p_workspace_id uuid DEFAULT NULL,
  p_query text DEFAULT NULL,
  p_municipality text DEFAULT NULL,
  p_project_type text DEFAULT NULL,
  p_min_price numeric DEFAULT NULL,
  p_max_price numeric DEFAULT NULL,
  p_include_archived boolean DEFAULT false,
  p_before_updated_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50
) RETURNS SETOF public.properties
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT property.* FROM public.properties property
  WHERE ((p_workspace_id IS NULL AND property.workspace_id IS NULL) OR property.workspace_id=p_workspace_id)
    AND (p_include_archived OR property.status='active')
    AND (p_query IS NULL OR char_length(p_query)<=500)
    AND (p_query IS NULL OR (SELECT count(*)<=20 FROM regexp_split_to_table(public.normalize_property_search_text(p_query),'\s+') token WHERE token<>''))
    AND (p_municipality IS NULL OR property.municipality=public.canonical_property_municipality(p_municipality))
    AND (p_project_type IS NULL OR lower(property.project_type)=lower(trim(p_project_type)) OR EXISTS (
      SELECT 1 FROM public.projects project WHERE project.property_id=property.id AND lower(project.type::text)=lower(trim(p_project_type))))
    AND (p_min_price IS NULL OR property.price>=p_min_price)
    AND (p_max_price IS NULL OR property.price<=p_max_price)
    AND ((p_before_updated_at IS NULL AND p_before_id IS NULL) OR
      (p_before_updated_at IS NOT NULL AND p_before_id IS NOT NULL AND
       (property.updated_at,property.id)<(p_before_updated_at,p_before_id)))
    AND (nullif(trim(p_query),'') IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.property_query_tokens(p_query) token WHERE NOT EXISTS (
        SELECT 1 FROM public.property_search_documents document
        WHERE document.property_id=property.id
          AND document.search_text LIKE public.property_search_like_pattern(token) ESCAPE E'\\')))
  ORDER BY property.updated_at DESC,property.id DESC
  LIMIT least(greatest(coalesce(p_limit,50),1),200)+1;
$$;
REVOKE ALL ON FUNCTION public.search_properties_page(
  uuid,text,text,text,numeric,numeric,boolean,timestamptz,uuid,integer
) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.search_properties_page(
  uuid,text,text,text,numeric,numeric,boolean,timestamptz,uuid,integer
) TO authenticated;

-- Compatibility wrapper for existing clients. New clients use the cursor
-- signature above; keeping this overload avoids a flag-day API break.
CREATE FUNCTION public.search_properties(
  p_workspace_id uuid DEFAULT NULL,
  p_query text DEFAULT NULL,
  p_municipality text DEFAULT NULL,
  p_project_type text DEFAULT NULL,
  p_min_price numeric DEFAULT NULL,
  p_max_price numeric DEFAULT NULL,
  p_include_archived boolean DEFAULT false,
  p_limit integer DEFAULT 50
) RETURNS SETOF public.properties
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT * FROM public.search_properties_page(
    p_workspace_id,p_query,p_municipality,p_project_type,p_min_price,p_max_price,
    p_include_archived,NULL::timestamptz,NULL::uuid,p_limit
  ) LIMIT least(greatest(coalesce(p_limit,50),1),200);
$$;
REVOKE ALL ON FUNCTION public.search_properties(
  uuid,text,text,text,numeric,numeric,boolean,integer
) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.search_properties(
  uuid,text,text,text,numeric,numeric,boolean,integer
) TO authenticated;

-- A property is a first-class upload parent. Exactly one of project, permit
-- case, or property is supplied by each preparation RPC.
ALTER TABLE public.pending_document_uploads
  ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS pending_uploads_property_idx
  ON public.pending_document_uploads(property_id,created_at DESC)
  WHERE property_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.document_parent_write_access_for_user(
  p_project_id uuid,p_permit_case_id uuid,p_property_id uuid,p_user_id uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT p_user_id IS NOT NULL AND CASE
    WHEN p_permit_case_id IS NOT NULL THEN EXISTS (
      SELECT 1 FROM public.permit_cases c WHERE c.id=p_permit_case_id AND c.archived_at IS NULL AND
        ((c.workspace_id IS NULL AND c.owner_id=p_user_id) OR EXISTS (
          SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=c.workspace_id AND m.user_id=p_user_id AND m.role IN ('owner','admin','member'))))
    WHEN p_project_id IS NOT NULL THEN EXISTS (
      SELECT 1 FROM public.projects p WHERE p.id=p_project_id AND
        ((p.workspace_id IS NULL AND p.owner_id=p_user_id) OR EXISTS (
          SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=p.workspace_id AND m.user_id=p_user_id AND m.role IN ('owner','admin','member'))))
    WHEN p_property_id IS NOT NULL THEN EXISTS (
      SELECT 1 FROM public.properties p WHERE p.id=p_property_id AND p.archived_at IS NULL AND
        ((p.workspace_id IS NULL AND p.owner_id=p_user_id) OR EXISTS (
          SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=p.workspace_id AND m.user_id=p_user_id AND m.role IN ('owner','admin','member'))))
    ELSE false END
$$;
REVOKE ALL ON FUNCTION public.document_parent_write_access_for_user(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.document_parent_write_access_for_user(uuid,uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_property_document_upload(
  p_property_id uuid,p_file_name text,p_expected_content_type text,
  p_expected_size_bytes bigint,p_category text DEFAULT NULL
) RETURNS TABLE(upload_id uuid,object_path text,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user uuid:=auth.uid(); v_property public.properties%ROWTYPE; v_id uuid:=gen_random_uuid(); v_safe text;
  v_files bigint; v_bytes numeric; v_rate bigint;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication is required'; END IF;
  SELECT * INTO v_property FROM public.properties WHERE id=p_property_id;
  IF NOT FOUND OR NOT public.property_write_access(p_property_id) OR v_property.archived_at IS NOT NULL THEN RAISE EXCEPTION 'property access denied'; END IF;
  IF p_expected_size_bytes IS NULL OR p_expected_size_bytes<1 OR p_expected_size_bytes>78643200 THEN RAISE EXCEPTION 'invalid upload size'; END IF;
  IF p_file_name IS NULL OR length(trim(p_file_name)) NOT BETWEEN 1 AND 255 OR p_file_name~'[\\/]' OR p_file_name LIKE '%..%'
    OR lower(p_file_name)!~'\.(pdf|xlsx|xls|docx|doc|csv|txt|png|jpg|jpeg)$' THEN RAISE EXCEPTION 'invalid or unsupported file name'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('agir:upload:'||v_user::text,0));
  SELECT coalesce(sum(cost),0) INTO v_rate FROM public.rate_limit_events WHERE owner_id=v_user AND bucket='document_upload' AND created_at>=now()-interval '24 hours';
  IF v_rate>=200 THEN RAISE EXCEPTION 'upload rate limit reached'; END IF;
  SELECT count(*),coalesce(sum(size_bytes),0) INTO v_files,v_bytes FROM public.documents WHERE owner_id=v_user AND upload_date>=now()-interval '24 hours';
  SELECT v_files+count(*),v_bytes+coalesce(sum(p.expected_size_bytes),0) INTO v_files,v_bytes FROM public.pending_document_uploads p
    WHERE p.owner_id=v_user AND p.status IN ('pending','verification_queued','verification_running') AND p.expires_at>now();
  IF v_files>=200 OR v_bytes+p_expected_size_bytes>2147483648 THEN RAISE EXCEPTION 'daily upload quota reached'; END IF;
  v_safe:=regexp_replace(p_file_name,'[^A-Za-z0-9._-]','_','g');
  INSERT INTO public.pending_document_uploads(id,owner_id,workspace_id,property_id,object_path,file_name,expected_content_type,expected_size_bytes,category,expires_at)
  VALUES(v_id,v_user,v_property.workspace_id,v_property.id,v_user::text||'/pending/'||v_id::text||'/'||v_safe,p_file_name,nullif(trim(p_expected_content_type),''),p_expected_size_bytes,nullif(trim(p_category),''),now()+interval '15 minutes');
  INSERT INTO public.rate_limit_events(owner_id,workspace_id,bucket,cost,metadata) VALUES(v_user,v_property.workspace_id,'document_upload',1,jsonb_build_object('pending_upload_id',v_id,'property_id',v_property.id));
  RETURN QUERY SELECT v_id,v_user::text||'/pending/'||v_id::text||'/'||v_safe,now()+interval '15 minutes';
END $$;
REVOKE ALL ON FUNCTION public.prepare_property_document_upload(uuid,text,text,bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.prepare_property_document_upload(uuid,text,text,bigint,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.document_read_access(p_document_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.documents d WHERE d.id=p_document_id AND CASE
    WHEN d.permit_case_id IS NOT NULL THEN public.permit_case_access(d.permit_case_id)
    WHEN d.project_id IS NOT NULL THEN public.permit_project_read_access(d.project_id)
    WHEN d.property_id IS NOT NULL THEN public.property_access(d.property_id)
    ELSE d.owner_id=auth.uid() END)
$$;
CREATE OR REPLACE FUNCTION public.document_write_access(p_document_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.documents d WHERE d.id=p_document_id
    AND public.document_parent_write_access_for_user(d.project_id,d.permit_case_id,d.property_id,auth.uid()))
$$;
CREATE OR REPLACE FUNCTION public.pending_upload_storage_insert_access(p_storage_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.pending_document_uploads p
    WHERE p.owner_id=auth.uid() AND p.object_path=p_storage_path AND p.status='pending' AND p.expires_at>now()
      AND public.document_parent_write_access_for_user(p.project_id,p.permit_case_id,p.property_id,auth.uid()))
$$;

CREATE OR REPLACE FUNCTION public.enforce_document_requester_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_property_id uuid;
BEGIN
  IF NEW.owner_id IS NULL THEN RAISE EXCEPTION 'document requester is required'; END IF;
  IF NEW.permit_case_id IS NOT NULL THEN SELECT property_id INTO v_property_id FROM public.permit_cases WHERE id=NEW.permit_case_id;
  ELSIF NEW.project_id IS NOT NULL THEN SELECT property_id INTO v_property_id FROM public.projects WHERE id=NEW.project_id;
  ELSE v_property_id:=NEW.property_id; END IF;
  IF NEW.property_id IS NULL THEN NEW.property_id:=v_property_id; END IF;
  IF NOT public.document_parent_write_access_for_user(NEW.project_id,NEW.permit_case_id,NEW.property_id,NEW.owner_id) THEN
    RAISE EXCEPTION 'document requester no longer has parent access'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.enforce_pending_upload_requester_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('verification_running','finalized','duplicate')
    AND NOT public.document_parent_write_access_for_user(NEW.project_id,NEW.permit_case_id,NEW.property_id,NEW.owner_id)
    THEN RAISE EXCEPTION 'upload requester no longer has parent access'; END IF;
  RETURN NEW;
END $$;

DROP POLICY IF EXISTS pending_document_uploads_scope_select ON public.pending_document_uploads;
CREATE POLICY pending_document_uploads_scope_select ON public.pending_document_uploads FOR SELECT TO authenticated USING (CASE
  WHEN permit_case_id IS NOT NULL THEN public.permit_case_access(permit_case_id)
  WHEN project_id IS NOT NULL THEN public.permit_project_read_access(project_id)
  WHEN property_id IS NOT NULL THEN public.property_access(property_id)
  ELSE false END);

-- Extend verified finalization so the first-class Property scope survives the
-- async worker boundary and deduplicates only within the same parent.
CREATE OR REPLACE FUNCTION public.complete_document_verification(
  p_job_id uuid,p_worker_id text,p_content_hash text,p_actual_size_bytes bigint,p_verified_content_type text,p_scan_detail text
) RETURNS TABLE(document_id uuid,deduped boolean,extraction_job_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job public.extraction_jobs%ROWTYPE; v_upload public.pending_document_uploads%ROWTYPE;
 v_existing uuid; v_document uuid; v_extraction uuid; v_key text;
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
 PERFORM pg_advisory_xact_lock(hashtextextended('agir:document:'||v_upload.owner_id::text||':'||coalesce(v_upload.permit_case_id::text,v_upload.project_id::text,v_upload.property_id::text)||':'||p_content_hash,0));
 SELECT id INTO v_existing FROM public.documents WHERE owner_id=v_upload.owner_id AND content_hash=p_content_hash
   AND project_id IS NOT DISTINCT FROM v_upload.project_id AND permit_case_id IS NOT DISTINCT FROM v_upload.permit_case_id
   AND (v_upload.project_id IS NOT NULL OR v_upload.permit_case_id IS NOT NULL OR property_id IS NOT DISTINCT FROM v_upload.property_id)
   ORDER BY upload_date LIMIT 1 FOR UPDATE;
 IF FOUND THEN
  UPDATE public.pending_document_uploads SET status='duplicate',finalized_at=now(),document_id=v_existing,failure_reason='Duplicate server-computed content hash' WHERE id=v_upload.id;
  INSERT INTO public.audit_logs(project_id,workspace_id,owner_id,user_id,entity_type,entity_id,action,payload)
  VALUES(v_upload.project_id,v_upload.workspace_id,v_upload.owner_id,v_upload.owner_id,'documents',v_existing,'document_upload_duplicate',
    jsonb_build_object('pending_upload_id',v_upload.id,'permit_case_id',v_upload.permit_case_id,'property_id',v_upload.property_id,'server_hash',true));
  RETURN QUERY SELECT v_existing,true,NULL::uuid; RETURN;
 END IF;
 INSERT INTO public.documents(project_id,permit_case_id,property_id,owner_id,name,file_type,category,storage_path,size_bytes,content_hash,extraction_status,scan_status,scan_detail,status)
 VALUES(v_upload.project_id,v_upload.permit_case_id,v_upload.property_id,v_upload.owner_id,v_upload.file_name,p_verified_content_type,v_upload.category,v_upload.object_path,p_actual_size_bytes,p_content_hash,'queued','clean',left(p_scan_detail,1000),'uploaded') RETURNING id INTO v_document;
 INSERT INTO public.extraction_jobs(owner_id,project_id,permit_case_id,document_id,kind,idempotency_key,status,progress,total,message,attempts)
 VALUES(v_upload.owner_id,v_upload.project_id,v_upload.permit_case_id,v_document,'document_analysis',v_key,'queued',0,NULL,'Queued after clean document verification',0)
 ON CONFLICT(owner_id,kind,idempotency_key) DO NOTHING RETURNING id INTO v_extraction;
 IF v_extraction IS NULL THEN SELECT id INTO v_extraction FROM public.extraction_jobs WHERE owner_id=v_upload.owner_id AND kind='document_analysis' AND idempotency_key=v_key; END IF;
 UPDATE public.pending_document_uploads SET status='finalized',finalized_at=now(),document_id=v_document,failure_reason=NULL WHERE id=v_upload.id;
 INSERT INTO public.audit_logs(project_id,workspace_id,owner_id,user_id,entity_type,entity_id,action,payload)
 VALUES(v_upload.project_id,v_upload.workspace_id,v_upload.owner_id,v_upload.owner_id,'documents',v_document,'document_upload_finalized',
   jsonb_build_object('pending_upload_id',v_upload.id,'permit_case_id',v_upload.permit_case_id,'property_id',v_upload.property_id,'server_hash',true,'verification_job_id',v_job.id));
 RETURN QUERY SELECT v_document,false,v_extraction;
END $$;
