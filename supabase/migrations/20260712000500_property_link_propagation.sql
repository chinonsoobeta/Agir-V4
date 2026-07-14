-- Keep legacy deal/case creation paths and document ingestion attached to the
-- canonical property catalogue. This is additive: it only resolves a property
-- when property_id is NULL and never silently moves an existing link.

ALTER TABLE public.properties
  DROP CONSTRAINT IF EXISTS properties_place_provider_check;
ALTER TABLE public.properties
  ADD CONSTRAINT properties_place_provider_check
  CHECK (place_provider IN ('google_places', 'openstreetmap', 'manual', 'other'));

-- A SELECT helper that re-queries permit_cases cannot see a row created by the
-- same INSERT ... RETURNING command. Keep the same boundary in a row-local
-- policy so workspace case creation can safely return its canonical link.
DROP POLICY IF EXISTS permit_cases_select ON public.permit_cases;
CREATE POLICY permit_cases_select ON public.permit_cases FOR SELECT TO authenticated
  USING (
    (workspace_id IS NULL AND owner_id = auth.uid())
    OR public.workspace_role(workspace_id) IN ('owner','admin','member','viewer')
  );

DROP INDEX IF EXISTS public.properties_workspace_place_unique;
DROP INDEX IF EXISTS public.properties_personal_place_unique;
CREATE UNIQUE INDEX properties_workspace_place_unique
  ON public.properties(
    workspace_id, place_provider, provider_place_id,
    (coalesce(nullif(lower(trim(unit)), ''), nullif(lower(trim(address_line_2)), ''), ''))
  )
  WHERE workspace_id IS NOT NULL AND provider_place_id IS NOT NULL AND status = 'active';
CREATE UNIQUE INDEX properties_personal_place_unique
  ON public.properties(
    owner_id, place_provider, provider_place_id,
    (coalesce(nullif(lower(trim(unit)), ''), nullif(lower(trim(address_line_2)), ''), ''))
  )
  WHERE workspace_id IS NULL AND provider_place_id IS NOT NULL AND status = 'active';

CREATE OR REPLACE FUNCTION public.canonicalize_property_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_address text;
  v_normalized text;
  v_provider text;
  v_property_id uuid;
  v_price numeric;
  v_project_type text;
  v_unit_key text;
BEGIN
  IF NEW.property_id IS NOT NULL THEN RETURN NEW; END IF;

  IF TG_TABLE_NAME = 'permit_cases' THEN
    IF NEW.project_id IS NOT NULL THEN
      SELECT property_id INTO v_property_id
      FROM public.projects WHERE id = NEW.project_id;
      IF v_property_id IS NOT NULL THEN
        NEW.property_id := v_property_id;
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'projects' THEN
    v_address := nullif(trim(NEW.property_address), '');
    v_price := nullif(NEW.acquisition_cost, 0);
    v_project_type := NEW.type::text;
  ELSE
    v_address := nullif(trim(NEW.property_address), '');
    v_price := NULL;
    v_project_type := NEW.property_type;
  END IF;
  IF v_address IS NULL THEN RETURN NEW; END IF;

  v_provider := CASE
    WHEN NEW.address_provider IN ('google_places','openstreetmap','manual')
      THEN NEW.address_provider
    WHEN NEW.address_provider IS NULL THEN 'manual'
    ELSE 'other'
  END;
  v_normalized := public.normalize_property_address(
    v_address, NEW.address_line_2, NULL, NEW.municipality, NULL, NULL
  );
  v_unit_key := coalesce(nullif(lower(trim(NEW.address_line_2)), ''), '');

  SELECT p.id INTO v_property_id
  FROM public.properties p
  WHERE p.status = 'active'
    AND (
      (NEW.workspace_id IS NULL AND p.workspace_id IS NULL AND p.owner_id = NEW.owner_id)
      OR (NEW.workspace_id IS NOT NULL AND p.workspace_id = NEW.workspace_id)
    )
    AND (
      (NEW.address_place_id IS NOT NULL
       AND p.place_provider = v_provider
       AND p.provider_place_id = NEW.address_place_id
       AND coalesce(nullif(lower(trim(p.unit)), ''),
                    nullif(lower(trim(p.address_line_2)), ''), '') = v_unit_key)
      OR p.normalized_address = v_normalized
    )
  ORDER BY CASE
    WHEN NEW.address_place_id IS NOT NULL
     AND p.place_provider = v_provider
     AND p.provider_place_id = NEW.address_place_id
     AND coalesce(nullif(lower(trim(p.unit)), ''),
                  nullif(lower(trim(p.address_line_2)), ''), '') = v_unit_key
    THEN 0 ELSE 1 END
  LIMIT 1;

  IF v_property_id IS NULL THEN
    BEGIN
      INSERT INTO public.properties(
        owner_id, workspace_id, display_name, building_name,
        address_line_1, address_line_2, municipality,
        place_provider, provider_place_id, latitude, longitude,
        zoning_designation, zoning_source_url, price, project_type, notes
      ) VALUES (
        NEW.owner_id, NEW.workspace_id, NEW.name, NEW.building_name,
        v_address, NEW.address_line_2, NEW.municipality,
        v_provider, NEW.address_place_id, NEW.latitude, NEW.longitude,
        NEW.zoning_designation,
        CASE WHEN NEW.zoning_source ~* '^https?://' THEN NEW.zoning_source ELSE NULL END,
        v_price, v_project_type, NEW.notes
      )
      RETURNING id INTO v_property_id;
    EXCEPTION WHEN unique_violation THEN
      SELECT p.id INTO v_property_id
      FROM public.properties p
      WHERE p.status = 'active'
        AND (
          (NEW.workspace_id IS NULL AND p.workspace_id IS NULL AND p.owner_id = NEW.owner_id)
          OR (NEW.workspace_id IS NOT NULL AND p.workspace_id = NEW.workspace_id)
        )
        AND (
          (NEW.address_place_id IS NOT NULL
           AND p.place_provider = v_provider
           AND p.provider_place_id = NEW.address_place_id
           AND coalesce(nullif(lower(trim(p.unit)), ''),
                        nullif(lower(trim(p.address_line_2)), ''), '') = v_unit_key)
          OR p.normalized_address = v_normalized
        )
      LIMIT 1;
    END;
  END IF;

  IF v_property_id IS NULL THEN
    RAISE EXCEPTION 'Canonical property could not be resolved';
  END IF;
  NEW.property_id := v_property_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_canonicalize_property_insert
  BEFORE INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.canonicalize_property_parent();
CREATE TRIGGER projects_canonicalize_property_update
  BEFORE UPDATE OF property_address, address_line_2, building_name,
    address_provider, address_place_id, latitude, longitude, municipality
  ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.canonicalize_property_parent();
CREATE TRIGGER permit_cases_canonicalize_property_insert
  BEFORE INSERT ON public.permit_cases
  FOR EACH ROW EXECUTE FUNCTION public.canonicalize_property_parent();
CREATE TRIGGER permit_cases_canonicalize_property_update
  BEFORE UPDATE OF property_address, address_line_2, building_name,
    address_provider, address_place_id, latitude, longitude, municipality
  ON public.permit_cases
  FOR EACH ROW EXECUTE FUNCTION public.canonicalize_property_parent();

CREATE OR REPLACE FUNCTION public.audit_automatic_property_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.property_id IS NULL
     OR (TG_OP = 'UPDATE' AND OLD.property_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.property_activity_events(
    property_id, actor_id, event_type, entity_type, entity_id,
    before_state, after_state, metadata
  ) VALUES (
    NEW.property_id, auth.uid(), TG_TABLE_NAME || '_linked', TG_TABLE_NAME, NEW.id,
    jsonb_build_object('property_id', CASE WHEN TG_OP = 'UPDATE' THEN OLD.property_id ELSE NULL END),
    jsonb_build_object('property_id', NEW.property_id),
    jsonb_build_object('automatic', true)
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_audit_automatic_property_insert
  AFTER INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.audit_automatic_property_link();
CREATE TRIGGER projects_audit_automatic_property_update
  AFTER UPDATE OF property_address, address_line_2, building_name,
    address_provider, address_place_id, latitude, longitude, municipality
  ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.audit_automatic_property_link();
CREATE TRIGGER permit_cases_audit_automatic_property_insert
  AFTER INSERT ON public.permit_cases
  FOR EACH ROW EXECUTE FUNCTION public.audit_automatic_property_link();
CREATE TRIGGER permit_cases_audit_automatic_property_update
  AFTER UPDATE OF property_address, address_line_2, building_name,
    address_provider, address_place_id, latitude, longitude, municipality
  ON public.permit_cases
  FOR EACH ROW EXECUTE FUNCTION public.audit_automatic_property_link();

CREATE OR REPLACE FUNCTION public.inherit_document_property()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_property uuid;
  v_case_property uuid;
BEGIN
  IF NEW.project_id IS NOT NULL THEN
    SELECT property_id INTO v_project_property
    FROM public.projects WHERE id = NEW.project_id;
  END IF;
  IF NEW.permit_case_id IS NOT NULL THEN
    SELECT property_id INTO v_case_property
    FROM public.permit_cases WHERE id = NEW.permit_case_id;
  END IF;
  IF v_project_property IS NOT NULL AND v_case_property IS NOT NULL
     AND v_project_property <> v_case_property THEN
    RAISE EXCEPTION 'Document parents must belong to the same property';
  END IF;
  IF NEW.property_id IS NULL THEN
    NEW.property_id := coalesce(v_project_property, v_case_property);
  ELSIF coalesce(v_project_property, v_case_property) IS NOT NULL
        AND NEW.property_id <> coalesce(v_project_property, v_case_property) THEN
    RAISE EXCEPTION 'Document must belong to its parent property';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_inherit_property_insert
  BEFORE INSERT ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.inherit_document_property();
CREATE TRIGGER documents_inherit_property_update
  BEFORE UPDATE OF project_id, permit_case_id, property_id ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.inherit_document_property();

CREATE OR REPLACE FUNCTION public.audit_property_record_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.property_id IS NOT DISTINCT FROM OLD.property_id THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.property_id IS NOT NULL THEN
    INSERT INTO public.property_activity_events(
      property_id, actor_id, event_type, entity_type, entity_id, before_state, after_state
    ) VALUES (
      OLD.property_id, auth.uid(), TG_TABLE_NAME || '_unlinked', TG_TABLE_NAME, NEW.id,
      jsonb_build_object('property_id', OLD.property_id),
      jsonb_build_object('property_id', NEW.property_id)
    );
  END IF;
  IF NEW.property_id IS NOT NULL THEN
    INSERT INTO public.property_activity_events(
      property_id, actor_id, event_type, entity_type, entity_id, before_state, after_state
    ) VALUES (
      NEW.property_id, auth.uid(), TG_TABLE_NAME || '_linked', TG_TABLE_NAME, NEW.id,
      jsonb_build_object(
        'property_id', CASE WHEN TG_OP = 'UPDATE' THEN OLD.property_id ELSE NULL END
      ),
      jsonb_build_object('property_id', NEW.property_id)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_audit_property_insert
  AFTER INSERT ON public.documents
  FOR EACH ROW WHEN (NEW.property_id IS NOT NULL)
  EXECUTE FUNCTION public.audit_property_record_link();

CREATE OR REPLACE FUNCTION public.validate_property_record_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_property public.properties%ROWTYPE;
  v_parent_workspace uuid;
  v_parent_owner uuid;
  v_related_property uuid;
BEGIN
  IF NEW.property_id IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.property_id IS NOT DISTINCT FROM OLD.property_id) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.property_id IS NOT NULL THEN
    RAISE EXCEPTION 'Linked records require an explicit property move operation';
  END IF;

  SELECT * INTO v_property FROM public.properties WHERE id = NEW.property_id;
  IF NOT FOUND OR (auth.uid() IS NOT NULL AND NOT public.property_write_access(NEW.property_id)) THEN
    RAISE EXCEPTION 'Property write access denied';
  END IF;

  IF TG_TABLE_NAME = 'documents' THEN
    IF NEW.project_id IS NOT NULL THEN
      SELECT workspace_id, owner_id, property_id
      INTO v_parent_workspace, v_parent_owner, v_related_property
      FROM public.projects WHERE id = NEW.project_id;
    ELSIF NEW.permit_case_id IS NOT NULL THEN
      SELECT workspace_id, owner_id, property_id
      INTO v_parent_workspace, v_parent_owner, v_related_property
      FROM public.permit_cases WHERE id = NEW.permit_case_id;
    ELSE
      v_parent_workspace := NULL;
      v_parent_owner := NEW.owner_id;
    END IF;
    IF v_related_property IS NOT NULL AND v_related_property <> NEW.property_id THEN
      RAISE EXCEPTION 'Document must belong to its parent property';
    END IF;
  ELSE
    v_parent_workspace := NEW.workspace_id;
    v_parent_owner := NEW.owner_id;
    IF TG_TABLE_NAME = 'permit_cases' THEN
      IF NEW.project_id IS NOT NULL THEN
        SELECT property_id INTO v_related_property FROM public.projects WHERE id = NEW.project_id;
      END IF;
    ELSIF TG_TABLE_NAME = 'projects' THEN
      SELECT c.property_id INTO v_related_property
      FROM public.permit_cases c
      WHERE c.project_id = NEW.id AND c.property_id IS NOT NULL
      LIMIT 1;
    END IF;
    IF v_related_property IS NOT NULL AND v_related_property <> NEW.property_id THEN
      RAISE EXCEPTION 'Linked deal and Permit case must belong to the same property';
    END IF;
  END IF;

  IF NOT (
    (v_property.workspace_id IS NULL AND v_parent_workspace IS NULL
     AND v_property.owner_id = v_parent_owner)
    OR (v_property.workspace_id IS NOT NULL
        AND v_property.workspace_id = v_parent_workspace)
  ) THEN
    RAISE EXCEPTION 'Linked record must belong to the same property workspace';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.propagate_parent_property()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.property_id IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.property_id IS NOT DISTINCT FROM OLD.property_id) THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'projects' THEN
    UPDATE public.permit_cases
    SET property_id = NEW.property_id
    WHERE project_id = NEW.id AND property_id IS NULL;
    UPDATE public.documents
    SET property_id = NEW.property_id
    WHERE project_id = NEW.id AND property_id IS NULL;
  ELSE
    IF NEW.project_id IS NOT NULL THEN
      UPDATE public.projects
      SET property_id = NEW.property_id
      WHERE id = NEW.project_id AND property_id IS NULL;
    END IF;
    UPDATE public.documents
    SET property_id = NEW.property_id
    WHERE permit_case_id = NEW.id AND property_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_propagate_property
  AFTER INSERT OR UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.propagate_parent_property();
CREATE TRIGGER permit_cases_propagate_property
  AFTER INSERT OR UPDATE ON public.permit_cases
  FOR EACH ROW EXECUTE FUNCTION public.propagate_parent_property();

GRANT EXECUTE ON FUNCTION public.canonicalize_property_parent(),
  public.audit_automatic_property_link(),
  public.inherit_document_property(),
  public.validate_property_record_link(),
  public.propagate_parent_property() TO service_role;
REVOKE ALL ON FUNCTION public.canonicalize_property_parent(),
  public.audit_automatic_property_link(),
  public.inherit_document_property(),
  public.validate_property_record_link(),
  public.propagate_parent_property() FROM PUBLIC, anon, authenticated;
