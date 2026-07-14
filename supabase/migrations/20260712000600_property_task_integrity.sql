-- Property task integrity: next-action selection is atomic and assignees must
-- belong to the same collaboration boundary as the property.

CREATE OR REPLACE FUNCTION public.prepare_property_task()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.title := trim(NEW.title);
  NEW.updated_at := now();
  IF NEW.status = 'done' AND NEW.completed_at IS NULL THEN
    NEW.completed_at := now();
  ELSIF NEW.status <> 'done' THEN
    NEW.completed_at := NULL;
  END IF;
  IF NEW.status IN ('done', 'cancelled') THEN
    NEW.is_next_action := false;
  END IF;

  IF NEW.is_next_action AND NEW.status IN ('todo', 'in_progress', 'blocked') THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('agir:property-next-action:' || NEW.property_id::text, 0)
    );
    UPDATE public.property_tasks
    SET is_next_action = false
    WHERE property_id = NEW.property_id
      AND is_next_action
      AND status IN ('todo', 'in_progress', 'blocked')
      AND id <> NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_property_child_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_property public.properties%ROWTYPE;
  v_contact public.relationship_contacts%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.property_id IS DISTINCT FROM OLD.property_id THEN
    RAISE EXCEPTION 'A property child cannot be moved to another property';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Property child authorship cannot be changed';
  END IF;

  SELECT * INTO v_property FROM public.properties WHERE id = NEW.property_id;
  IF NOT FOUND OR (auth.uid() IS NOT NULL AND NOT public.property_write_access(NEW.property_id)) THEN
    RAISE EXCEPTION 'Property write access denied';
  END IF;

  IF TG_TABLE_NAME = 'property_contacts' THEN
    SELECT * INTO v_contact FROM public.relationship_contacts WHERE id = NEW.contact_id;
    IF NOT FOUND OR NOT (
      (v_property.workspace_id IS NULL AND v_contact.workspace_id IS NULL
       AND v_property.owner_id = v_contact.owner_id)
      OR (v_property.workspace_id IS NOT NULL
          AND v_contact.workspace_id = v_property.workspace_id)
    ) THEN
      RAISE EXCEPTION 'Contact must belong to the same property workspace';
    END IF;
  ELSIF TG_TABLE_NAME = 'property_tasks' AND NEW.assigned_to IS NOT NULL THEN
    IF NOT (
      (v_property.workspace_id IS NULL AND NEW.assigned_to = v_property.owner_id)
      OR (v_property.workspace_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.workspace_members m
        WHERE m.workspace_id = v_property.workspace_id
          AND m.user_id = NEW.assigned_to
      ))
    ) THEN
      RAISE EXCEPTION 'Task assignee must belong to the property workspace';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_property_task(),
  public.validate_property_child_scope() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_property_task(),
  public.validate_property_child_scope() TO service_role;
