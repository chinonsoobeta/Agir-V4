-- A child history row cannot outlive its deleted case. Preserve deletion
-- evidence in the append-only audit chain instead.
CREATE OR REPLACE FUNCTION public.audit_permit_case_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor uuid;
BEGIN
 IF TG_OP='DELETE' THEN
  v_actor:=coalesce(auth.uid(),OLD.owner_id);
  INSERT INTO public.audit_logs(project_id,workspace_id,owner_id,user_id,entity_type,entity_id,action,payload)
  VALUES(OLD.project_id,OLD.workspace_id,OLD.owner_id,v_actor,'permit_case',OLD.id,'permit_case_deleted',jsonb_build_object('name',OLD.name,'previous',to_jsonb(OLD)));
  RETURN OLD;
 END IF;
 v_actor:=coalesce(auth.uid(),NEW.owner_id);
 INSERT INTO public.permit_case_history(case_id,action,previous_data,new_data,changed_by)
 VALUES(NEW.id,'case_'||lower(TG_OP),CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,to_jsonb(NEW),v_actor);
 RETURN NEW;
END $$;
