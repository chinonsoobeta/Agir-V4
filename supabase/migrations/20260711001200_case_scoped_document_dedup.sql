-- Standalone documents deduplicate within a case, never across unrelated cases.
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
 IF NOT FOUND OR v_job.kind<>'document_verification' OR v_job.status<>'running' OR v_job.lease_owner<>p_worker_id
   OR v_job.lease_expires_at<=now() OR v_job.cancellation_requested OR v_job.pending_upload_id IS NULL THEN RAISE EXCEPTION 'verification worker does not hold a live lease'; END IF;
 SELECT * INTO v_upload FROM public.pending_document_uploads WHERE id=v_job.pending_upload_id FOR UPDATE;
 IF NOT FOUND OR v_upload.owner_id<>v_job.owner_id OR v_upload.object_path!~('^'||v_upload.owner_id::text||'/pending/'||v_upload.id::text||'/') THEN RAISE EXCEPTION 'pending upload binding is invalid'; END IF;
 IF v_upload.status NOT IN ('verification_queued','verification_running') OR v_upload.expires_at<=now() THEN RAISE EXCEPTION 'pending upload is not finalizable'; END IF;
 IF p_actual_size_bytes<>v_upload.expected_size_bytes THEN RAISE EXCEPTION 'uploaded object size does not match authorized size'; END IF;
 v_key:=p_content_hash||CASE WHEN v_upload.permit_case_id IS NOT NULL THEN ':case:'||v_upload.permit_case_id::text ELSE '' END;
 PERFORM pg_advisory_xact_lock(hashtextextended('agir:document:'||v_upload.owner_id::text||':'||coalesce(v_upload.permit_case_id::text,v_upload.project_id::text,'-')||':'||p_content_hash,0));
 SELECT id INTO v_existing FROM public.documents WHERE owner_id=v_upload.owner_id AND content_hash=p_content_hash
   AND project_id IS NOT DISTINCT FROM v_upload.project_id AND permit_case_id IS NOT DISTINCT FROM v_upload.permit_case_id
   ORDER BY upload_date LIMIT 1 FOR UPDATE;
 IF FOUND THEN
  UPDATE public.pending_document_uploads SET status='duplicate',finalized_at=now(),document_id=v_existing,failure_reason='Duplicate server-computed content hash' WHERE id=v_upload.id;
  INSERT INTO public.audit_logs(project_id,workspace_id,owner_id,user_id,entity_type,entity_id,action,payload)
  VALUES(v_upload.project_id,v_upload.workspace_id,v_upload.owner_id,v_upload.owner_id,'documents',v_existing,'document_upload_duplicate',jsonb_build_object('pending_upload_id',v_upload.id,'permit_case_id',v_upload.permit_case_id,'server_hash',true));
  RETURN QUERY SELECT v_existing,true,NULL::uuid; RETURN;
 END IF;
 INSERT INTO public.documents(project_id,permit_case_id,owner_id,name,file_type,category,storage_path,size_bytes,content_hash,extraction_status,scan_status,scan_detail,status)
 VALUES(v_upload.project_id,v_upload.permit_case_id,v_upload.owner_id,v_upload.file_name,p_verified_content_type,v_upload.category,v_upload.object_path,p_actual_size_bytes,p_content_hash,'queued','clean',left(p_scan_detail,1000),'uploaded') RETURNING id INTO v_document;
 INSERT INTO public.extraction_jobs(owner_id,project_id,permit_case_id,document_id,kind,idempotency_key,status,progress,total,message,attempts)
 VALUES(v_upload.owner_id,v_upload.project_id,v_upload.permit_case_id,v_document,'document_analysis',v_key,'queued',0,NULL,'Queued after clean document verification',0)
 ON CONFLICT(owner_id,kind,idempotency_key) DO NOTHING RETURNING id INTO v_extraction;
 IF v_extraction IS NULL THEN SELECT id INTO v_extraction FROM public.extraction_jobs WHERE owner_id=v_upload.owner_id AND kind='document_analysis' AND idempotency_key=v_key; END IF;
 UPDATE public.pending_document_uploads SET status='finalized',finalized_at=now(),document_id=v_document,failure_reason=NULL WHERE id=v_upload.id;
 INSERT INTO public.audit_logs(project_id,workspace_id,owner_id,user_id,entity_type,entity_id,action,payload)
 VALUES(v_upload.project_id,v_upload.workspace_id,v_upload.owner_id,v_upload.owner_id,'documents',v_document,'document_upload_finalized',jsonb_build_object('pending_upload_id',v_upload.id,'permit_case_id',v_upload.permit_case_id,'server_hash',true,'verification_job_id',v_job.id));
 RETURN QUERY SELECT v_document,false,v_extraction;
END $$;
