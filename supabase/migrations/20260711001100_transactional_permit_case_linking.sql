CREATE OR REPLACE FUNCTION public.set_permit_case_project(p_case_id uuid,p_expected_version bigint,p_reason text,p_project_id uuid DEFAULT NULL)
RETURNS public.permit_cases LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.permit_cases; p public.projects; result public.permit_cases;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication is required'; END IF;
 IF p_reason IS NULL OR length(trim(p_reason))=0 THEN RAISE EXCEPTION 'a linking reason is required'; END IF;
 SELECT * INTO c FROM public.permit_cases WHERE id=p_case_id FOR UPDATE;
 IF NOT FOUND OR NOT public.permit_case_write_access(p_case_id) THEN RAISE EXCEPTION 'permit case access denied'; END IF;
 IF c.row_version<>p_expected_version THEN RAISE EXCEPTION 'permit case version conflict'; END IF;
 IF p_project_id IS NOT NULL THEN
  SELECT * INTO p FROM public.projects WHERE id=p_project_id;
  IF NOT FOUND OR NOT public.permit_project_access(p_project_id) OR p.workspace_id IS DISTINCT FROM c.workspace_id THEN RAISE EXCEPTION 'project access denied'; END IF;
 END IF;
 UPDATE public.permit_cases SET project_id=p_project_id WHERE id=p_case_id RETURNING * INTO result;
 UPDATE public.project_permits SET project_id=p_project_id WHERE case_id=p_case_id;
 UPDATE public.documents SET project_id=p_project_id WHERE permit_case_id=p_case_id;
 INSERT INTO public.permit_case_history(case_id,action,reason,changed_by)
 VALUES(p_case_id,CASE WHEN p_project_id IS NULL THEN 'case_project_unlinked' ELSE 'case_project_linked' END,left(trim(p_reason),1000),auth.uid());
 RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION public.set_permit_case_project(uuid,bigint,text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.set_permit_case_project(uuid,bigint,text,uuid) FROM PUBLIC,anon;
