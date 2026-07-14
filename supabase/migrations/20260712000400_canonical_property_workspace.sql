-- Canonical property workspace.
--
-- A property is the shared, durable research record behind underwriting deals
-- and Permit cases. Workspace rows are visible to every workspace member and
-- writable by contributors; NULL-workspace rows preserve the legacy personal
-- owner boundary. Related records may only link to a property in the same
-- tenant boundary. Property activity is append-only and trigger-written.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION public.normalize_property_address(
  p_address_line_1 text,
  p_address_line_2 text DEFAULT NULL,
  p_unit text DEFAULT NULL,
  p_municipality text DEFAULT NULL,
  p_region text DEFAULT NULL,
  p_postal_code text DEFAULT NULL
) RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT trim(regexp_replace(lower(concat_ws(' ',
    nullif(trim(p_address_line_1), ''),
    nullif(trim(p_address_line_2), ''),
    nullif(trim(p_unit), ''),
    nullif(trim(p_municipality), ''),
    nullif(trim(p_region), ''),
    nullif(trim(p_postal_code), '')
  )), '[^[:alnum:]]+', ' ', 'g'));
$$;

CREATE TABLE public.properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  display_name text,
  building_name text,
  address_line_1 text NOT NULL CHECK (length(trim(address_line_1)) BETWEEN 1 AND 500),
  address_line_2 text CHECK (address_line_2 IS NULL OR length(address_line_2) <= 200),
  unit text CHECK (unit IS NULL OR length(unit) <= 100),
  normalized_address text NOT NULL,
  municipality text,
  region text,
  postal_code text,
  country_code text NOT NULL DEFAULT 'CA' CHECK (country_code ~ '^[A-Z]{2}$'),
  place_provider text NOT NULL DEFAULT 'manual'
    CHECK (place_provider IN ('google_places', 'openstreetmap', 'manual', 'other')),
  provider_place_id text,
  latitude numeric(9,6) CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude numeric(10,6) CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  zoning_designation text,
  zoning_source_url text CHECK (zoning_source_url IS NULL OR zoning_source_url ~* '^https?://'),
  zoning_verified_at timestamptz,
  zoning_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  price numeric(18,2) CHECK (price IS NULL OR price >= 0),
  currency text NOT NULL DEFAULT 'CAD' CHECK (currency ~ '^[A-Z]{3}$'),
  owner_name text,
  broker_name text,
  project_type text,
  notes text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at timestamptz,
  archived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  archive_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'active' AND archived_at IS NULL AND archived_by IS NULL)
    OR (status = 'archived' AND archived_at IS NOT NULL AND archived_by IS NOT NULL
        AND length(trim(archive_reason)) > 0)
  )
);

CREATE INDEX properties_workspace_recent_idx
  ON public.properties(workspace_id, updated_at DESC) WHERE workspace_id IS NOT NULL;
CREATE INDEX properties_owner_recent_idx
  ON public.properties(owner_id, updated_at DESC) WHERE workspace_id IS NULL;
CREATE INDEX properties_municipality_idx
  ON public.properties(workspace_id, municipality, updated_at DESC);
CREATE INDEX properties_price_idx
  ON public.properties(workspace_id, price) WHERE price IS NOT NULL;
CREATE INDEX properties_search_trgm_idx
  ON public.properties USING gin (normalized_address gin_trgm_ops);
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
CREATE UNIQUE INDEX properties_workspace_address_unique
  ON public.properties(workspace_id, normalized_address)
  WHERE workspace_id IS NOT NULL AND status = 'active';
CREATE UNIQUE INDEX properties_personal_address_unique
  ON public.properties(owner_id, normalized_address)
  WHERE workspace_id IS NULL AND status = 'active';

CREATE OR REPLACE FUNCTION public.prepare_property_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.address_line_1 := trim(NEW.address_line_1);
  NEW.address_line_2 := nullif(trim(NEW.address_line_2), '');
  NEW.unit := nullif(trim(NEW.unit), '');
  NEW.display_name := nullif(trim(NEW.display_name), '');
  NEW.building_name := nullif(trim(NEW.building_name), '');
  NEW.municipality := nullif(trim(NEW.municipality), '');
  NEW.region := nullif(trim(NEW.region), '');
  NEW.postal_code := nullif(upper(trim(NEW.postal_code)), '');
  NEW.country_code := upper(trim(NEW.country_code));
  NEW.currency := upper(trim(NEW.currency));
  NEW.provider_place_id := nullif(trim(NEW.provider_place_id), '');
  NEW.normalized_address := public.normalize_property_address(
    NEW.address_line_1, NEW.address_line_2, NEW.unit, NEW.municipality,
    NEW.region, NEW.postal_code
  );
  NEW.updated_at := now();

  IF TG_OP = 'UPDATE' AND (
    NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
  ) THEN
    RAISE EXCEPTION 'Property ownership and workspace cannot be changed';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER properties_prepare
  BEFORE INSERT OR UPDATE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.prepare_property_row();

CREATE OR REPLACE FUNCTION public.property_access(p_property_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.properties p
    WHERE p.id = p_property_id
      AND (
        (p.workspace_id IS NULL AND p.owner_id = auth.uid())
        OR (p.workspace_id IS NOT NULL AND public.is_workspace_member(p.workspace_id))
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.property_write_access(p_property_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.properties p
    WHERE p.id = p_property_id
      AND (
        (p.workspace_id IS NULL AND p.owner_id = auth.uid())
        OR public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
      )
  );
$$;

ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY properties_select ON public.properties FOR SELECT TO authenticated
  USING (
    (workspace_id IS NULL AND owner_id = auth.uid())
    OR (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id))
  );
CREATE POLICY properties_insert ON public.properties FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND (workspace_id IS NULL OR public.workspace_role(workspace_id) IN ('owner', 'admin', 'member'))
  );
CREATE POLICY properties_update ON public.properties FOR UPDATE TO authenticated
  USING (public.property_write_access(id))
  WITH CHECK (
    (workspace_id IS NULL AND owner_id = auth.uid())
    OR public.workspace_role(workspace_id) IN ('owner', 'admin', 'member')
  );

CREATE TABLE public.property_urls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url text NOT NULL CHECK (url ~* '^https?://'),
  label text CHECK (label IS NULL OR length(label) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(property_id, url)
);
CREATE INDEX property_urls_property_idx ON public.property_urls(property_id, created_at DESC);

CREATE TABLE public.property_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.relationship_contacts(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'other'
    CHECK (role IN ('owner', 'broker', 'seller', 'tenant', 'lender', 'consultant', 'other')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(property_id, contact_id, role)
);
CREATE INDEX property_contacts_property_idx ON public.property_contacts(property_id, created_at DESC);

CREATE TABLE public.property_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 300),
  notes text,
  status text NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'in_progress', 'blocked', 'done', 'cancelled')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  due_at timestamptz,
  completed_at timestamptz,
  is_next_action boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'done' AND completed_at IS NOT NULL) OR status <> 'done')
);
CREATE INDEX property_tasks_open_idx
  ON public.property_tasks(property_id, is_next_action DESC, due_at, created_at)
  WHERE status IN ('todo', 'in_progress', 'blocked');
CREATE UNIQUE INDEX property_tasks_one_next_action
  ON public.property_tasks(property_id)
  WHERE is_next_action AND status IN ('todo', 'in_progress', 'blocked');

CREATE TABLE public.property_activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before_state jsonb,
  after_state jsonb,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX property_activity_recent_idx
  ON public.property_activity_events(property_id, created_at DESC);

ALTER TABLE public.property_urls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_activity_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY property_urls_select ON public.property_urls FOR SELECT TO authenticated
  USING (public.property_access(property_id));
CREATE POLICY property_urls_insert ON public.property_urls FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.property_write_access(property_id));
CREATE POLICY property_urls_update ON public.property_urls FOR UPDATE TO authenticated
  USING (public.property_write_access(property_id))
  WITH CHECK (created_by = auth.uid() AND public.property_write_access(property_id));
CREATE POLICY property_urls_delete ON public.property_urls FOR DELETE TO authenticated
  USING (public.property_write_access(property_id));

CREATE POLICY property_contacts_select ON public.property_contacts FOR SELECT TO authenticated
  USING (public.property_access(property_id));
CREATE POLICY property_contacts_insert ON public.property_contacts FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.property_write_access(property_id));
CREATE POLICY property_contacts_update ON public.property_contacts FOR UPDATE TO authenticated
  USING (public.property_write_access(property_id))
  WITH CHECK (created_by = auth.uid() AND public.property_write_access(property_id));
CREATE POLICY property_contacts_delete ON public.property_contacts FOR DELETE TO authenticated
  USING (public.property_write_access(property_id));

CREATE POLICY property_tasks_select ON public.property_tasks FOR SELECT TO authenticated
  USING (public.property_access(property_id));
CREATE POLICY property_tasks_insert ON public.property_tasks FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.property_write_access(property_id));
CREATE POLICY property_tasks_update ON public.property_tasks FOR UPDATE TO authenticated
  USING (public.property_write_access(property_id))
  WITH CHECK (public.property_write_access(property_id));
CREATE POLICY property_tasks_delete ON public.property_tasks FOR DELETE TO authenticated
  USING (public.property_write_access(property_id));

CREATE POLICY property_activity_select ON public.property_activity_events FOR SELECT TO authenticated
  USING (public.property_access(property_id));

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
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER property_urls_validate BEFORE INSERT OR UPDATE ON public.property_urls
  FOR EACH ROW EXECUTE FUNCTION public.validate_property_child_scope();
CREATE TRIGGER property_contacts_validate BEFORE INSERT OR UPDATE ON public.property_contacts
  FOR EACH ROW EXECUTE FUNCTION public.validate_property_child_scope();
CREATE TRIGGER property_tasks_validate BEFORE INSERT OR UPDATE ON public.property_tasks
  FOR EACH ROW EXECUTE FUNCTION public.validate_property_child_scope();

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
  RETURN NEW;
END;
$$;
CREATE TRIGGER property_tasks_prepare BEFORE INSERT OR UPDATE ON public.property_tasks
  FOR EACH ROW EXECUTE FUNCTION public.prepare_property_task();

CREATE OR REPLACE FUNCTION public.audit_property_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.property_activity_events(
    property_id, actor_id, event_type, entity_type, entity_id,
    before_state, after_state, reason
  ) VALUES (
    NEW.id, auth.uid(),
    CASE WHEN TG_OP = 'INSERT' THEN 'property_created'
         WHEN NEW.status = 'archived' AND OLD.status <> 'archived' THEN 'property_archived'
         ELSE 'property_updated' END,
    'property', NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    to_jsonb(NEW),
    CASE WHEN NEW.status = 'archived' THEN NEW.archive_reason ELSE NULL END
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER properties_audit AFTER INSERT OR UPDATE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.audit_property_change();

CREATE OR REPLACE FUNCTION public.audit_property_child_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_property_id uuid := coalesce(NEW.property_id, OLD.property_id);
  v_entity_id uuid := coalesce(NEW.id, OLD.id);
BEGIN
  INSERT INTO public.property_activity_events(
    property_id, actor_id, event_type, entity_type, entity_id,
    before_state, after_state
  ) VALUES (
    v_property_id, auth.uid(),
    TG_TABLE_NAME || '_' || lower(TG_OP), TG_TABLE_NAME, v_entity_id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
  );
  RETURN coalesce(NEW, OLD);
END;
$$;
CREATE TRIGGER property_urls_audit AFTER INSERT OR UPDATE OR DELETE ON public.property_urls
  FOR EACH ROW EXECUTE FUNCTION public.audit_property_child_change();
CREATE TRIGGER property_contacts_audit AFTER INSERT OR UPDATE OR DELETE ON public.property_contacts
  FOR EACH ROW EXECUTE FUNCTION public.audit_property_child_change();
CREATE TRIGGER property_tasks_audit AFTER INSERT OR UPDATE OR DELETE ON public.property_tasks
  FOR EACH ROW EXECUTE FUNCTION public.audit_property_child_change();

ALTER TABLE public.projects
  ADD COLUMN property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL;
ALTER TABLE public.permit_cases
  ADD COLUMN property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL;
ALTER TABLE public.documents
  ADD COLUMN property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL;
CREATE INDEX projects_property_idx ON public.projects(property_id) WHERE property_id IS NOT NULL;
CREATE INDEX permit_cases_property_idx ON public.permit_cases(property_id) WHERE property_id IS NOT NULL;
CREATE INDEX documents_property_idx ON public.documents(property_id) WHERE property_id IS NOT NULL;

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
      SELECT workspace_id, owner_id INTO v_parent_workspace, v_parent_owner
      FROM public.projects WHERE id = NEW.project_id;
    ELSIF NEW.permit_case_id IS NOT NULL THEN
      SELECT workspace_id, owner_id INTO v_parent_workspace, v_parent_owner
      FROM public.permit_cases WHERE id = NEW.permit_case_id;
    ELSE
      v_parent_workspace := NULL;
      v_parent_owner := NEW.owner_id;
    END IF;
  ELSE
    v_parent_workspace := NEW.workspace_id;
    v_parent_owner := NEW.owner_id;
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

CREATE TRIGGER projects_validate_property BEFORE INSERT OR UPDATE OF property_id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.validate_property_record_link();
CREATE TRIGGER permit_cases_validate_property BEFORE INSERT OR UPDATE OF property_id ON public.permit_cases
  FOR EACH ROW EXECUTE FUNCTION public.validate_property_record_link();
CREATE TRIGGER documents_validate_property BEFORE INSERT OR UPDATE OF property_id ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.validate_property_record_link();

CREATE OR REPLACE FUNCTION public.audit_property_record_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.property_id IS NOT DISTINCT FROM OLD.property_id THEN RETURN NEW; END IF;

  IF OLD.property_id IS NOT NULL THEN
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
      jsonb_build_object('property_id', OLD.property_id),
      jsonb_build_object('property_id', NEW.property_id)
    );
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER projects_audit_property AFTER UPDATE OF property_id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.audit_property_record_link();
CREATE TRIGGER permit_cases_audit_property AFTER UPDATE OF property_id ON public.permit_cases
  FOR EACH ROW EXECUTE FUNCTION public.audit_property_record_link();
CREATE TRIGGER documents_audit_property AFTER UPDATE OF property_id ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.audit_property_record_link();

-- Existing records are preserved and promoted into canonical properties when
-- they have an address. Project rows take precedence; Permit-only addresses are
-- added afterward and converge on the same normalized-address uniqueness key.
INSERT INTO public.properties(
  owner_id, workspace_id, display_name, building_name, address_line_1,
  address_line_2, municipality, place_provider, provider_place_id,
  latitude, longitude, zoning_designation, zoning_source_url, price,
  project_type, notes
)
SELECT DISTINCT ON (
  coalesce(p.workspace_id::text, p.owner_id::text),
  public.normalize_property_address(
    nullif(trim(p.property_address), ''),
    p.address_line_2, NULL, p.municipality, NULL, NULL
  )
)
  p.owner_id, p.workspace_id, p.name, p.building_name,
  nullif(trim(p.property_address), ''),
  p.address_line_2, p.municipality,
  CASE WHEN p.address_provider IN ('google_places','openstreetmap','manual')
       THEN p.address_provider ELSE 'other' END,
  p.address_place_id, p.latitude, p.longitude, p.zoning_designation,
  CASE WHEN p.zoning_source ~* '^https?://' THEN p.zoning_source ELSE NULL END,
  nullif(p.acquisition_cost, 0), p.type::text, p.notes
FROM public.projects p
WHERE nullif(trim(p.property_address), '') IS NOT NULL
ORDER BY coalesce(p.workspace_id::text, p.owner_id::text),
  public.normalize_property_address(
    nullif(trim(p.property_address), ''),
    p.address_line_2, NULL, p.municipality, NULL, NULL
  ), p.updated_at DESC
ON CONFLICT DO NOTHING;

INSERT INTO public.properties(
  owner_id, workspace_id, display_name, building_name, address_line_1,
  address_line_2, municipality, place_provider, provider_place_id,
  latitude, longitude, zoning_designation, zoning_source_url,
  project_type, notes
)
SELECT DISTINCT ON (
  coalesce(c.workspace_id::text, c.owner_id::text),
  public.normalize_property_address(
    c.property_address, c.address_line_2, NULL, c.municipality, NULL, NULL
  )
)
  c.owner_id, c.workspace_id, c.name, c.building_name, c.property_address,
  c.address_line_2, c.municipality,
  CASE WHEN c.address_provider IN ('google_places','openstreetmap','manual')
       THEN c.address_provider ELSE 'other' END,
  c.address_place_id, c.latitude, c.longitude, c.zoning_designation,
  CASE WHEN c.zoning_source ~* '^https?://' THEN c.zoning_source ELSE NULL END,
  c.property_type, c.notes
FROM public.permit_cases c
WHERE nullif(trim(c.property_address), '') IS NOT NULL
ORDER BY coalesce(c.workspace_id::text, c.owner_id::text),
  public.normalize_property_address(
    c.property_address, c.address_line_2, NULL, c.municipality, NULL, NULL
  ),
  c.updated_at DESC
ON CONFLICT DO NOTHING;

UPDATE public.projects p
SET property_id = prop.id
FROM public.properties prop
WHERE p.property_id IS NULL
  AND nullif(trim(p.property_address), '') IS NOT NULL
  AND (
    (p.workspace_id IS NULL AND prop.workspace_id IS NULL AND prop.owner_id = p.owner_id)
    OR prop.workspace_id = p.workspace_id
  )
  AND prop.normalized_address = public.normalize_property_address(
    nullif(trim(p.property_address), ''),
    p.address_line_2, NULL, p.municipality, NULL, NULL
  );

UPDATE public.permit_cases c
SET property_id = prop.id
FROM public.properties prop
WHERE c.property_id IS NULL
  AND nullif(trim(c.property_address), '') IS NOT NULL
  AND (
    (c.workspace_id IS NULL AND prop.workspace_id IS NULL AND prop.owner_id = c.owner_id)
    OR prop.workspace_id = c.workspace_id
  )
  AND prop.normalized_address = public.normalize_property_address(
    c.property_address, c.address_line_2, NULL, c.municipality, NULL, NULL
  );

UPDATE public.documents d
SET property_id = p.property_id
FROM public.projects p
WHERE d.property_id IS NULL
  AND d.project_id = p.id
  AND p.property_id IS NOT NULL;

UPDATE public.documents d
SET property_id = c.property_id
FROM public.permit_cases c
WHERE d.property_id IS NULL
  AND d.permit_case_id = c.id
  AND c.property_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.search_properties(
  p_workspace_id uuid DEFAULT NULL,
  p_query text DEFAULT NULL,
  p_municipality text DEFAULT NULL,
  p_project_type text DEFAULT NULL,
  p_min_price numeric DEFAULT NULL,
  p_max_price numeric DEFAULT NULL,
  p_include_archived boolean DEFAULT false,
  p_limit integer DEFAULT 50
) RETURNS SETOF public.properties
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT p.*
  FROM public.properties p
  WHERE ((p_workspace_id IS NULL AND p.workspace_id IS NULL)
         OR p.workspace_id = p_workspace_id)
    AND (p_include_archived OR p.status = 'active')
    AND (p_municipality IS NULL OR lower(p.municipality) = lower(trim(p_municipality)))
    AND (
      p_project_type IS NULL
      OR lower(p.project_type) = lower(trim(p_project_type))
      OR EXISTS (
        SELECT 1 FROM public.projects pr
        WHERE pr.property_id = p.id AND lower(pr.type::text) = lower(trim(p_project_type))
      )
    )
    AND (p_min_price IS NULL OR p.price >= p_min_price)
    AND (p_max_price IS NULL OR p.price <= p_max_price)
    AND (
      nullif(trim(p_query), '') IS NULL
      OR position(lower(trim(p_query)) in lower(concat_ws(' ',
        p.display_name, p.building_name, p.address_line_1, p.address_line_2,
        p.unit, p.normalized_address, p.municipality, p.region, p.postal_code,
        p.zoning_designation, p.zoning_evidence::text, p.owner_name,
        p.broker_name, p.project_type, p.price::text, p.notes
      ))) > 0
      OR EXISTS (
        SELECT 1 FROM public.property_contacts pc
        JOIN public.relationship_contacts rc ON rc.id = pc.contact_id
        WHERE pc.property_id = p.id
          AND position(lower(trim(p_query)) in lower(concat_ws(' ',
            rc.full_name, rc.company, rc.title, rc.email, rc.phone,
            rc.notes, pc.role, pc.notes
          ))) > 0
      )
      OR EXISTS (
        SELECT 1 FROM public.projects pr WHERE pr.property_id = p.id
          AND position(lower(trim(p_query)) in lower(concat_ws(' ',
            pr.name, pr.location, pr.type::text, pr.status::text,
            pr.lead_owner, pr.source, pr.notes
          ))) > 0
      )
      OR EXISTS (
        SELECT 1 FROM public.permit_cases c WHERE c.property_id = p.id
          AND position(lower(trim(p_query)) in lower(concat_ws(' ',
            c.name, c.municipality, c.property_type, c.work_type,
            c.description, c.notes
          ))) > 0
      )
      OR EXISTS (
        SELECT 1 FROM public.property_urls u WHERE u.property_id = p.id
          AND position(lower(trim(p_query)) in lower(concat_ws(' ', u.label, u.url))) > 0
      )
    )
  ORDER BY p.updated_at DESC
  LIMIT least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

GRANT SELECT, INSERT, UPDATE ON public.properties TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_urls,
  public.property_contacts, public.property_tasks TO authenticated;
GRANT SELECT ON public.property_activity_events TO authenticated;
GRANT ALL ON public.properties, public.property_urls, public.property_contacts,
  public.property_tasks, public.property_activity_events TO service_role;
GRANT EXECUTE ON FUNCTION public.property_access(uuid),
  public.property_write_access(uuid),
  public.search_properties(uuid,text,text,text,numeric,numeric,boolean,integer)
  TO authenticated;
REVOKE ALL ON FUNCTION public.property_access(uuid),
  public.property_write_access(uuid),
  public.search_properties(uuid,text,text,text,numeric,numeric,boolean,integer)
  FROM PUBLIC, anon;
