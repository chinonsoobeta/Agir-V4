-- Permit audit triggers must remain usable by controlled migration/service
-- operations where auth.uid() is absent, while user actions retain auth.uid().
CREATE OR REPLACE FUNCTION public.audit_permit_case_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_case uuid; v_actor uuid;
BEGIN
 IF TG_OP='DELETE' THEN v_case:=OLD.id; v_actor:=coalesce(auth.uid(),OLD.owner_id);
 ELSE v_case:=NEW.id; v_actor:=coalesce(auth.uid(),NEW.owner_id); END IF;
 INSERT INTO public.permit_case_history(case_id,action,previous_data,new_data,changed_by)
 VALUES(v_case,'case_'||lower(TG_OP),
   CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,
   CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END,v_actor);
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE OR REPLACE FUNCTION public.audit_project_permit_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.project_permits; reason text; action_name text; actor uuid;
BEGIN
 IF TG_OP='DELETE' THEN p:=OLD; ELSE p:=NEW; END IF;
 actor:=coalesce(auth.uid(),p.owner_id);
 reason:=CASE WHEN TG_OP='DELETE' THEN coalesce(OLD.required_reason,OLD.notes) ELSE coalesce(NEW.required_reason,NEW.notes,OLD.required_reason,OLD.notes) END;
 action_name:='permit_'||lower(TG_OP);
 IF TG_OP='INSERT' THEN
  INSERT INTO public.permit_history(project_permit_id,new_status,new_applicability_status,change_reason,source_document_id,source_text,changed_by)
  VALUES(NEW.id,NEW.workflow_status,NEW.applicability_status,reason,NEW.source_document_id,NEW.source_text,actor);
 ELSIF TG_OP='UPDATE' THEN
  INSERT INTO public.permit_history(project_permit_id,previous_status,new_status,previous_applicability_status,new_applicability_status,change_reason,source_document_id,source_text,changed_by)
  VALUES(NEW.id,OLD.workflow_status,NEW.workflow_status,OLD.applicability_status,NEW.applicability_status,reason,NEW.source_document_id,NEW.source_text,actor);
 END IF;
 IF p.project_id IS NOT NULL THEN
  INSERT INTO public.audit_logs(project_id,workspace_id,owner_id,user_id,entity_type,entity_id,action,payload)
  SELECT p.project_id,pr.workspace_id,p.owner_id,actor,'permit',p.id,action_name,jsonb_build_object('table',TG_TABLE_NAME,'operation',TG_OP,'permit_case_id',p.case_id)
  FROM public.projects pr WHERE pr.id=p.project_id;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
