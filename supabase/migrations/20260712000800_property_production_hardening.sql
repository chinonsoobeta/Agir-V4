-- Production hardening for the canonical Property workspace.
--
-- This migration preserves institutional records through user deprovisioning,
-- makes property identity deliberately conservative, closes tenant-drift paths,
-- makes the case transfer/link RPCs property-aware, and maintains an indexed
-- cross-workspace search document that includes immutable history.

-- ---------------------------------------------------------------------------
-- Lifecycle-safe attribution
-- ---------------------------------------------------------------------------

-- Install the complete continuity guard in the same committed migration that
-- relaxes attribution FKs. Migration 009 intentionally recreates this guard,
-- so there is no deploy window in which either a personal root or an older
-- CASCADE-backed Underwriting record can disappear during user deletion.
DO $$
DECLARE v_fk record;
BEGIN
  FOR v_fk IN
    SELECT fk.conrelid,n.nspname AS schema_name,c.relname AS table_name,
      a.attname AS column_name
    FROM pg_constraint fk
    JOIN pg_class c ON c.oid=fk.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=fk.conrelid AND a.attnum=fk.conkey[1]
    WHERE fk.contype='f' AND fk.confrelid='auth.users'::regclass
      AND cardinality(fk.conkey)=1 AND n.nspname='public'
      AND c.relname<>ALL(ARRAY[
        'profiles','user_roles','user_preferences','workspace_members',
        'workspace_invitations','pilot_user_access',
        'notification_preferences','notification_events'
      ])
      AND NOT EXISTS (
        SELECT 1 FROM pg_index existing_index
        WHERE existing_index.indrelid=fk.conrelid
          AND existing_index.indisvalid AND existing_index.indpred IS NULL
          AND existing_index.indexprs IS NULL
          AND (existing_index.indkey::smallint[])[1]=fk.conkey[1]
      )
  LOOP
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.%I (%I)',
      'agir_deprovision_'||substr(md5(
        v_fk.schema_name||'.'||v_fk.table_name||'.'||v_fk.column_name
      ),1,16)||'_idx',
      v_fk.schema_name,v_fk.table_name,v_fk.column_name
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.user_deprovision_blockers(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_catalog
AS $$
DECLARE
  v_fk record;
  v_count bigint;
  v_blockers jsonb:='{}'::jsonb;
  v_disposable_tables constant text[]:=ARRAY[
    'profiles','user_roles','user_preferences','workspace_members',
    'workspace_invitations','pilot_user_access',
    'notification_preferences','notification_events'
  ];
BEGIN
  IF p_user_id IS NULL THEN RETURN v_blockers; END IF;

  FOR v_fk IN
    SELECT n.nspname AS schema_name,c.relname AS table_name,a.attname AS column_name
    FROM pg_constraint fk
    JOIN pg_class c ON c.oid=fk.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=fk.conrelid AND a.attnum=fk.conkey[1]
    WHERE fk.contype='f' AND fk.confrelid='auth.users'::regclass
      AND fk.confdeltype='c' AND cardinality(fk.conkey)=1
      AND n.nspname='public' AND NOT (c.relname=ANY(v_disposable_tables))
    ORDER BY c.relname,a.attname
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I.%I WHERE %I=$1',
      v_fk.schema_name,v_fk.table_name,v_fk.column_name
    ) INTO v_count USING p_user_id;
    IF v_count>0 THEN
      v_blockers:=v_blockers||jsonb_build_object(
        v_fk.table_name||'.'||v_fk.column_name,v_count
      );
    END IF;
  END LOOP;

  SELECT count(*) INTO v_count
  FROM public.workspace_members mine
  WHERE mine.user_id=p_user_id AND mine.role='owner'
    AND NOT EXISTS (
      SELECT 1 FROM public.workspace_members successor
      WHERE successor.workspace_id=mine.workspace_id
        AND successor.user_id<>p_user_id AND successor.role='owner'
    );
  IF v_count>0 THEN
    v_blockers:=v_blockers||jsonb_build_object('workspace_members.sole_owner',v_count);
  END IF;

  -- Re-evaluated at delete time after the FK changes below: every SET NULL
  -- owner/workspace root, including personal contacts, remains a blocker.
  FOR v_fk IN
    SELECT n.nspname AS schema_name,c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p') AND n.nspname='public'
      AND EXISTS (
        SELECT 1 FROM pg_attribute owner_column
        WHERE owner_column.attrelid=c.oid AND owner_column.attname='owner_id'
          AND owner_column.attnum>0 AND NOT owner_column.attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute workspace_column
        WHERE workspace_column.attrelid=c.oid AND workspace_column.attname='workspace_id'
          AND workspace_column.attnum>0 AND NOT workspace_column.attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_constraint owner_fk
        JOIN pg_attribute owner_fk_column
          ON owner_fk_column.attrelid=owner_fk.conrelid
         AND owner_fk_column.attnum=owner_fk.conkey[1]
        WHERE owner_fk.contype='f' AND owner_fk.conrelid=c.oid
          AND owner_fk.confrelid='auth.users'::regclass
          AND owner_fk.confdeltype='n' AND cardinality(owner_fk.conkey)=1
          AND owner_fk_column.attname='owner_id'
      )
      AND EXISTS (
        SELECT 1 FROM pg_constraint workspace_fk
        JOIN pg_attribute workspace_fk_column
          ON workspace_fk_column.attrelid=workspace_fk.conrelid
         AND workspace_fk_column.attnum=workspace_fk.conkey[1]
        WHERE workspace_fk.contype='f' AND workspace_fk.conrelid=c.oid
          AND workspace_fk.confrelid='public.workspaces'::regclass
          AND cardinality(workspace_fk.conkey)=1
          AND workspace_fk_column.attname='workspace_id'
      )
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I.%I WHERE owner_id=$1 AND workspace_id IS NULL',
      v_fk.schema_name,v_fk.table_name
    ) INTO v_count USING p_user_id;
    IF v_count>0 THEN
      v_blockers:=v_blockers||jsonb_build_object(
        v_fk.table_name||'.personal_owner',v_count
      );
    END IF;
  END LOOP;

  SELECT count(*) INTO v_count
  FROM public.documents
  WHERE owner_id=p_user_id AND project_id IS NULL
    AND permit_case_id IS NULL AND property_id IS NULL;
  IF v_count>0 THEN
    v_blockers:=v_blockers||jsonb_build_object('documents.personal_owner',v_count);
  END IF;
  RETURN v_blockers;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_governed_user_deprovisioning()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_catalog
AS $$
DECLARE v_blockers jsonb;
BEGIN
  v_blockers:=public.user_deprovision_blockers(OLD.id);
  IF v_blockers<>'{}'::jsonb THEN
    RAISE EXCEPTION 'Governed offboarding is required before deleting this user'
      USING ERRCODE='23503',
        DETAIL='Durable business records still reference the user: '||v_blockers::text,
        HINT='Reassign, export, retain, or deliberately remove each blocker under the approved offboarding policy.';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS auth_users_governed_deprovisioning ON auth.users;
CREATE TRIGGER auth_users_governed_deprovisioning
  BEFORE DELETE ON auth.users FOR EACH ROW
  EXECUTE FUNCTION public.guard_governed_user_deprovisioning();
REVOKE ALL ON FUNCTION public.guard_governed_user_deprovisioning()
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.user_deprovision_blockers(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_governed_user_deprovisioning() TO service_role;
GRANT EXECUTE ON FUNCTION public.user_deprovision_blockers(uuid) TO service_role;

ALTER TABLE public.workspaces DROP CONSTRAINT IF EXISTS workspaces_created_by_fkey;
ALTER TABLE public.workspaces ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_owner_id_fkey;
ALTER TABLE public.properties ALTER COLUMN owner_id DROP NOT NULL;
ALTER TABLE public.properties
  ADD CONSTRAINT properties_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_workspace_id_fkey;
ALTER TABLE public.properties
  ADD CONSTRAINT properties_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;

-- Contacts linked to an institutional property must not disappear when the
-- user who first entered the contact is deprovisioned.
ALTER TABLE public.relationship_contacts
  DROP CONSTRAINT IF EXISTS relationship_contacts_owner_id_fkey;
ALTER TABLE public.relationship_contacts ALTER COLUMN owner_id DROP NOT NULL;
ALTER TABLE public.relationship_contacts
  ADD CONSTRAINT relationship_contacts_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Preserve the property-linked deal, Permit, document, and extraction graph
-- when an originating user is removed. owner_id remains required on new rows
-- by RLS/application validation; NULL is reserved for retained attribution.
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_owner_id_fkey;
ALTER TABLE public.projects ALTER COLUMN owner_id DROP NOT NULL;
ALTER TABLE public.projects ADD CONSTRAINT projects_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_workspace_id_fkey;
ALTER TABLE public.projects ADD CONSTRAINT projects_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;

ALTER TABLE public.permit_cases DROP CONSTRAINT IF EXISTS permit_cases_owner_id_fkey;
ALTER TABLE public.permit_cases ALTER COLUMN owner_id DROP NOT NULL;
ALTER TABLE public.permit_cases ADD CONSTRAINT permit_cases_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.permit_cases DROP CONSTRAINT IF EXISTS permit_cases_workspace_id_fkey;
ALTER TABLE public.permit_cases ADD CONSTRAINT permit_cases_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_owner_id_fkey;
ALTER TABLE public.documents ALTER COLUMN owner_id DROP NOT NULL;
ALTER TABLE public.documents ADD CONSTRAINT documents_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.project_permits DROP CONSTRAINT IF EXISTS project_permits_owner_id_fkey;
ALTER TABLE public.project_permits ALTER COLUMN owner_id DROP NOT NULL;
ALTER TABLE public.project_permits ADD CONSTRAINT project_permits_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.permit_extraction_candidates
  DROP CONSTRAINT IF EXISTS permit_extraction_candidates_owner_id_fkey;
ALTER TABLE public.permit_extraction_candidates ALTER COLUMN owner_id DROP NOT NULL;
ALTER TABLE public.permit_extraction_candidates
  ADD CONSTRAINT permit_extraction_candidates_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.extraction_jobs DROP CONSTRAINT IF EXISTS extraction_jobs_owner_id_fkey;
ALTER TABLE public.extraction_jobs ALTER COLUMN owner_id DROP NOT NULL;
ALTER TABLE public.extraction_jobs ADD CONSTRAINT extraction_jobs_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.permit_case_history DROP CONSTRAINT IF EXISTS permit_case_history_changed_by_fkey;
ALTER TABLE public.permit_case_history ALTER COLUMN changed_by DROP NOT NULL;
ALTER TABLE public.permit_case_history ADD CONSTRAINT permit_case_history_changed_by_fkey
  FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.permit_history DROP CONSTRAINT IF EXISTS permit_history_changed_by_fkey;
ALTER TABLE public.permit_history ALTER COLUMN changed_by DROP NOT NULL;
ALTER TABLE public.permit_history ADD CONSTRAINT permit_history_changed_by_fkey
  FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.property_urls DROP CONSTRAINT IF EXISTS property_urls_created_by_fkey;
ALTER TABLE public.property_urls ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.property_urls
  ADD CONSTRAINT property_urls_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.property_contacts DROP CONSTRAINT IF EXISTS property_contacts_created_by_fkey;
ALTER TABLE public.property_contacts ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.property_contacts
  ADD CONSTRAINT property_contacts_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.property_tasks DROP CONSTRAINT IF EXISTS property_tasks_created_by_fkey;
ALTER TABLE public.property_tasks ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.property_tasks
  ADD CONSTRAINT property_tasks_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Property children are retained records, not disposable attachments. These
-- RESTRICT edges make deletion an explicit recovery/retention operation rather
-- than a cascading side effect.
ALTER TABLE public.property_urls DROP CONSTRAINT IF EXISTS property_urls_property_id_fkey;
ALTER TABLE public.property_urls ADD CONSTRAINT property_urls_property_id_fkey
  FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE RESTRICT;
ALTER TABLE public.property_contacts DROP CONSTRAINT IF EXISTS property_contacts_property_id_fkey;
ALTER TABLE public.property_contacts ADD CONSTRAINT property_contacts_property_id_fkey
  FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE RESTRICT;
ALTER TABLE public.property_contacts DROP CONSTRAINT IF EXISTS property_contacts_contact_id_fkey;
ALTER TABLE public.property_contacts ADD CONSTRAINT property_contacts_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.relationship_contacts(id) ON DELETE RESTRICT;
ALTER TABLE public.property_tasks DROP CONSTRAINT IF EXISTS property_tasks_property_id_fkey;
ALTER TABLE public.property_tasks ADD CONSTRAINT property_tasks_property_id_fkey
  FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE RESTRICT;
ALTER TABLE public.property_activity_events
  DROP CONSTRAINT IF EXISTS property_activity_events_property_id_fkey;
ALTER TABLE public.property_activity_events
  ADD CONSTRAINT property_activity_events_property_id_fkey
  FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE RESTRICT;

DO $$
DECLARE v_constraint text;
BEGIN
  FOR v_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.properties'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%archived_by%'
  LOOP
    EXECUTE format('ALTER TABLE public.properties DROP CONSTRAINT %I', v_constraint);
  END LOOP;
END $$;
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_archive_state_check;
ALTER TABLE public.properties
  ADD CONSTRAINT properties_archive_state_check CHECK (
    (status = 'active' AND archived_at IS NULL)
    OR (status = 'archived' AND archived_at IS NOT NULL
        AND length(trim(archive_reason)) > 0)
  );

DROP POLICY IF EXISTS property_urls_update ON public.property_urls;
CREATE POLICY property_urls_update ON public.property_urls FOR UPDATE TO authenticated
  USING (public.property_write_access(property_id))
  WITH CHECK (public.property_write_access(property_id));
DROP POLICY IF EXISTS property_contacts_update ON public.property_contacts;
CREATE POLICY property_contacts_update ON public.property_contacts FOR UPDATE TO authenticated
  USING (public.property_write_access(property_id))
  WITH CHECK (public.property_write_access(property_id));

-- ---------------------------------------------------------------------------
-- Canonical identity
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.canonical_property_municipality(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE regexp_replace(lower(trim(p_value)), '\s+', ' ', 'g')
    WHEN 'anmore' THEN 'Village of Anmore'
    WHEN 'village of anmore' THEN 'Village of Anmore'
    WHEN 'belcarra' THEN 'Village of Belcarra'
    WHEN 'village of belcarra' THEN 'Village of Belcarra'
    WHEN 'bowen island' THEN 'Bowen Island Municipality'
    WHEN 'bowen island municipality' THEN 'Bowen Island Municipality'
    WHEN 'burnaby' THEN 'City of Burnaby'
    WHEN 'city of burnaby' THEN 'City of Burnaby'
    WHEN 'coquitlam' THEN 'City of Coquitlam'
    WHEN 'city of coquitlam' THEN 'City of Coquitlam'
    WHEN 'delta' THEN 'City of Delta'
    WHEN 'city of delta' THEN 'City of Delta'
    WHEN 'langley city' THEN 'City of Langley'
    WHEN 'city of langley' THEN 'City of Langley'
    WHEN 'langley township' THEN 'Township of Langley'
    WHEN 'township of langley' THEN 'Township of Langley'
    WHEN 'lions bay' THEN 'Village of Lions Bay'
    WHEN 'village of lions bay' THEN 'Village of Lions Bay'
    WHEN 'maple ridge' THEN 'City of Maple Ridge'
    WHEN 'city of maple ridge' THEN 'City of Maple Ridge'
    WHEN 'new westminster' THEN 'City of New Westminster'
    WHEN 'city of new westminster' THEN 'City of New Westminster'
    WHEN 'north vancouver city' THEN 'City of North Vancouver'
    WHEN 'city of north vancouver' THEN 'City of North Vancouver'
    WHEN 'north vancouver district' THEN 'District of North Vancouver'
    WHEN 'district of north vancouver' THEN 'District of North Vancouver'
    WHEN 'pitt meadows' THEN 'City of Pitt Meadows'
    WHEN 'city of pitt meadows' THEN 'City of Pitt Meadows'
    WHEN 'port coquitlam' THEN 'City of Port Coquitlam'
    WHEN 'city of port coquitlam' THEN 'City of Port Coquitlam'
    WHEN 'port moody' THEN 'City of Port Moody'
    WHEN 'city of port moody' THEN 'City of Port Moody'
    WHEN 'richmond' THEN 'City of Richmond'
    WHEN 'city of richmond' THEN 'City of Richmond'
    WHEN 'surrey' THEN 'City of Surrey'
    WHEN 'city of surrey' THEN 'City of Surrey'
    WHEN 'vancouver' THEN 'City of Vancouver'
    WHEN 'city of vancouver' THEN 'City of Vancouver'
    WHEN 'west vancouver' THEN 'District of West Vancouver'
    WHEN 'district of west vancouver' THEN 'District of West Vancouver'
    WHEN 'white rock' THEN 'City of White Rock'
    WHEN 'city of white rock' THEN 'City of White Rock'
    WHEN 'kelowna' THEN 'City of Kelowna'
    WHEN 'city of kelowna' THEN 'City of Kelowna'
    ELSE nullif(trim(p_value), '')
  END;
$$;

CREATE OR REPLACE FUNCTION public.property_unit_identity(p_unit text, p_address_line_2 text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT coalesce(nullif(lower(trim(p_unit)), ''),
                  nullif(lower(trim(p_address_line_2)), ''), '');
$$;

CREATE OR REPLACE FUNCTION public.canonical_property_region(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE regexp_replace(lower(trim(p_value)), '[^[:alnum:]]+', '', 'g')
    WHEN 'bc' THEN 'BC'
    WHEN 'britishcolumbia' THEN 'BC'
    ELSE nullif(upper(trim(p_value)), '')
  END;
$$;

CREATE OR REPLACE FUNCTION public.property_identity_is_strong(
  p_place_provider text,
  p_provider_place_id text,
  p_municipality text,
  p_postal_code text,
  p_latitude numeric,
  p_longitude numeric
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT nullif(trim(p_provider_place_id), '') IS NOT NULL
    OR (
      public.canonical_property_municipality(p_municipality) IS NOT NULL
      AND nullif(regexp_replace(upper(p_postal_code), '\s+', '', 'g'), '') IS NOT NULL
    )
    OR (p_latitude IS NOT NULL AND p_longitude IS NOT NULL);
$$;

CREATE OR REPLACE FUNCTION public.property_identity_key(
  p_normalized_address text,
  p_place_provider text,
  p_provider_place_id text,
  p_unit text,
  p_address_line_2 text,
  p_municipality text,
  p_postal_code text,
  p_latitude numeric,
  p_longitude numeric
) RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE
    WHEN nullif(trim(p_provider_place_id), '') IS NOT NULL
      THEN 'place:' || lower(coalesce(nullif(trim(p_place_provider), ''), 'other')) || ':' ||
        trim(p_provider_place_id) || ':' ||
        public.property_unit_identity(p_unit, p_address_line_2)
    WHEN public.canonical_property_municipality(p_municipality) IS NOT NULL
      AND nullif(regexp_replace(upper(p_postal_code), '\s+', '', 'g'), '') IS NOT NULL
      THEN 'address:' || p_normalized_address
    WHEN p_latitude IS NOT NULL AND p_longitude IS NOT NULL
      THEN 'coordinate:' || round(p_latitude, 6)::text || ':' || round(p_longitude, 6)::text || ':' ||
        public.property_unit_identity(p_unit, p_address_line_2)
    ELSE NULL
  END;
$$;

ALTER TABLE public.properties ADD COLUMN identity_key text GENERATED ALWAYS AS (
  public.property_identity_key(
    normalized_address,place_provider,provider_place_id,unit,address_line_2,
    municipality,postal_code,latitude,longitude
  )
) STORED;

DROP INDEX IF EXISTS public.properties_workspace_address_unique;
DROP INDEX IF EXISTS public.properties_personal_address_unique;
DROP INDEX IF EXISTS public.properties_workspace_place_unique;
DROP INDEX IF EXISTS public.properties_personal_place_unique;

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
  NEW.municipality := public.canonical_property_municipality(NEW.municipality);
  NEW.region := public.canonical_property_region(NEW.region);
  NEW.postal_code := nullif(upper(trim(NEW.postal_code)), '');
  NEW.country_code := upper(trim(NEW.country_code));
  NEW.currency := upper(trim(NEW.currency));
  NEW.provider_place_id := nullif(trim(NEW.provider_place_id), '');
  NEW.normalized_address := public.normalize_property_address(
    NEW.address_line_1, NEW.address_line_2, NEW.unit, NEW.municipality,
    NEW.region, NEW.postal_code
  );
  NEW.updated_at := now();

  IF TG_OP = 'UPDATE' AND NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION 'Property workspace cannot be changed';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.owner_id IS DISTINCT FROM OLD.owner_id
     AND NOT (auth.uid() IS NULL AND OLD.owner_id IS NOT NULL AND NEW.owner_id IS NULL) THEN
    RAISE EXCEPTION 'Property attribution cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_parent_property_municipality()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.municipality := public.canonical_property_municipality(NEW.municipality);
  IF TG_TABLE_NAME='projects' THEN
    NEW.address_region := public.canonical_property_region(NEW.address_region);
  ELSIF TG_TABLE_NAME='permit_cases' THEN
    NEW.province := coalesce(public.canonical_property_region(NEW.province), 'BC');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_00_normalize_property_municipality
  BEFORE INSERT OR UPDATE OF municipality,address_region ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.normalize_parent_property_municipality();
CREATE TRIGGER permit_cases_00_normalize_property_municipality
  BEFORE INSERT OR UPDATE OF municipality,province ON public.permit_cases
  FOR EACH ROW EXECUTE FUNCTION public.normalize_parent_property_municipality();

UPDATE public.properties
SET municipality = public.canonical_property_municipality(municipality)
WHERE municipality IS DISTINCT FROM public.canonical_property_municipality(municipality);
UPDATE public.projects
SET municipality = public.canonical_property_municipality(municipality)
WHERE municipality IS DISTINCT FROM public.canonical_property_municipality(municipality);
UPDATE public.projects SET address_region=public.canonical_property_region(address_region)
WHERE address_region IS DISTINCT FROM public.canonical_property_region(address_region);
UPDATE public.permit_cases
SET municipality = public.canonical_property_municipality(municipality)
WHERE municipality IS DISTINCT FROM public.canonical_property_municipality(municipality);
UPDATE public.permit_cases SET province=coalesce(public.canonical_property_region(province),'BC')
WHERE province IS DISTINCT FROM coalesce(public.canonical_property_region(province),'BC');

-- Migrations 004/005 predated the structured region/postal fields added in
-- 007. Reconcile the best linked parent before computing the final identity so
-- provider/place/unit and manual municipality+postal identities converge.
WITH parent_sources AS (
  SELECT p.property_id,p.updated_at,p.building_name,p.address_line_2,
    p.municipality,p.address_region AS region,p.postal_code,
    p.address_provider,p.address_place_id,p.latitude,p.longitude
  FROM public.projects p WHERE p.property_id IS NOT NULL
  UNION ALL
  SELECT c.property_id,c.updated_at,c.building_name,c.address_line_2,
    c.municipality,c.province AS region,c.postal_code,
    c.address_provider,c.address_place_id,c.latitude,c.longitude
  FROM public.permit_cases c WHERE c.property_id IS NOT NULL
), ranked_sources AS (
  SELECT source.*,row_number() OVER (
    PARTITION BY source.property_id
    ORDER BY (source.address_place_id IS NOT NULL) DESC,
      (source.postal_code IS NOT NULL) DESC,source.updated_at DESC
  ) AS position
  FROM parent_sources source
)
UPDATE public.properties property SET
  building_name=coalesce(property.building_name,source.building_name),
  address_line_2=coalesce(property.address_line_2,source.address_line_2),
  municipality=coalesce(property.municipality,source.municipality),
  region=coalesce(property.region,source.region),
  postal_code=coalesce(property.postal_code,source.postal_code),
  place_provider=CASE
    WHEN source.address_place_id IS NOT NULL
      AND (property.provider_place_id IS NULL
        OR property.provider_place_id=source.address_place_id)
      THEN CASE
        WHEN source.address_provider IN ('google_places','openstreetmap')
          THEN source.address_provider
        ELSE 'other'
      END
    ELSE property.place_provider
  END,
  provider_place_id=coalesce(property.provider_place_id,source.address_place_id),
  latitude=coalesce(property.latitude,source.latitude),
  longitude=coalesce(property.longitude,source.longitude)
FROM ranked_sources source
WHERE property.id=source.property_id AND source.position=1;

UPDATE public.properties SET place_provider = 'other'
WHERE place_provider = 'manual' AND provider_place_id IS NOT NULL;
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_manual_provider_id_check;
ALTER TABLE public.properties ADD CONSTRAINT properties_manual_provider_id_check
  CHECK (place_provider <> 'manual' OR provider_place_id IS NULL);

-- Reconcile strong identities before restoring uniqueness. Weak manual rows
-- intentionally have identity_key NULL and are never merged automatically.
DROP TRIGGER IF EXISTS projects_validate_property ON public.projects;
DROP TRIGGER IF EXISTS permit_cases_validate_property ON public.permit_cases;
DROP TRIGGER IF EXISTS documents_validate_property ON public.documents;
DROP TRIGGER IF EXISTS property_urls_validate ON public.property_urls;
DROP TRIGGER IF EXISTS property_contacts_validate ON public.property_contacts;
DROP TRIGGER IF EXISTS property_tasks_validate ON public.property_tasks;
DROP TRIGGER IF EXISTS projects_propagate_property ON public.projects;
DROP TRIGGER IF EXISTS permit_cases_propagate_property ON public.permit_cases;

CREATE TEMP TABLE property_merge_map(
  loser_id uuid PRIMARY KEY,
  winner_id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO property_merge_map(loser_id,winner_id)
WITH ranked AS (
  SELECT id,
    first_value(id) OVER (
      PARTITION BY coalesce(workspace_id::text, 'personal:' || owner_id::text), identity_key
      ORDER BY updated_at DESC, created_at ASC, id
    ) AS winner_id,
    row_number() OVER (
      PARTITION BY coalesce(workspace_id::text, 'personal:' || owner_id::text), identity_key
      ORDER BY updated_at DESC, created_at ASC, id
    ) AS position
  FROM public.properties
  WHERE status='active' AND identity_key IS NOT NULL
    AND (workspace_id IS NOT NULL OR owner_id IS NOT NULL)
)
SELECT id,winner_id FROM ranked WHERE position>1;

-- Preserve every duplicate deterministically and record the provenance before
-- the redundant shell is removed.
DO $$
DECLARE merge_row record; winner_state jsonb;
BEGIN
  FOR merge_row IN
    SELECT map.loser_id,map.winner_id,loser.*
    FROM property_merge_map map
    JOIN public.properties loser ON loser.id=map.loser_id
    ORDER BY map.winner_id,loser.updated_at DESC,loser.created_at,loser.id
  LOOP
    UPDATE public.properties winner SET
      display_name=coalesce(winner.display_name,merge_row.display_name),
      building_name=coalesce(winner.building_name,merge_row.building_name),
      region=coalesce(winner.region,merge_row.region),
      postal_code=coalesce(winner.postal_code,merge_row.postal_code),
      latitude=coalesce(winner.latitude,merge_row.latitude),
      longitude=coalesce(winner.longitude,merge_row.longitude),
      zoning_designation=coalesce(winner.zoning_designation,merge_row.zoning_designation),
      zoning_source_url=coalesce(winner.zoning_source_url,merge_row.zoning_source_url),
      zoning_verified_at=coalesce(winner.zoning_verified_at,merge_row.zoning_verified_at),
      zoning_evidence=CASE WHEN winner.zoning_evidence='[]'::jsonb
        THEN merge_row.zoning_evidence ELSE winner.zoning_evidence END,
      price=coalesce(winner.price,merge_row.price),
      owner_name=coalesce(winner.owner_name,merge_row.owner_name),
      broker_name=coalesce(winner.broker_name,merge_row.broker_name),
      project_type=coalesce(winner.project_type,merge_row.project_type),
      notes=CASE
        WHEN winner.notes IS NULL THEN merge_row.notes
        WHEN merge_row.notes IS NULL OR winner.notes=merge_row.notes THEN winner.notes
        ELSE winner.notes || E'\n\nMerged record note: ' || merge_row.notes END
    WHERE winner.id=merge_row.winner_id RETURNING to_jsonb(winner.*) INTO winner_state;

    INSERT INTO public.property_activity_events(
      property_id,actor_id,event_type,entity_type,entity_id,
      before_state,after_state,reason,metadata
    ) VALUES (
      merge_row.winner_id,NULL,'property_identity_merged','property',merge_row.loser_id,
      to_jsonb(merge_row),winner_state,'Automatic strong-identity reconciliation',
      jsonb_build_object('loser_property_id',merge_row.loser_id,
        'winner_property_id',merge_row.winner_id,'identity_key',merge_row.identity_key)
    );
  END LOOP;
END $$;

UPDATE public.projects row SET property_id=map.winner_id
FROM property_merge_map map WHERE row.property_id=map.loser_id;
UPDATE public.permit_cases row SET property_id=map.winner_id
FROM property_merge_map map WHERE row.property_id=map.loser_id;
UPDATE public.documents row SET property_id=map.winner_id
FROM property_merge_map map WHERE row.property_id=map.loser_id;

-- MIGRATION_SAFETY_REVIEW: exact duplicate URLs are already preserved on the
-- winner and their immutable activity is moved below.
DELETE FROM public.property_urls loser
USING property_merge_map map
WHERE loser.property_id=map.loser_id AND EXISTS (
  SELECT 1 FROM public.property_urls winner
  WHERE winner.property_id=map.winner_id AND winner.url=loser.url
);
UPDATE public.property_urls row SET property_id=map.winner_id
FROM property_merge_map map WHERE row.property_id=map.loser_id;

-- MIGRATION_SAFETY_REVIEW: exact duplicate contact-role links are already
-- preserved on the winner and their immutable activity is moved below.
DELETE FROM public.property_contacts loser
USING property_merge_map map
WHERE loser.property_id=map.loser_id AND EXISTS (
  SELECT 1 FROM public.property_contacts winner
  WHERE winner.property_id=map.winner_id
    AND winner.contact_id=loser.contact_id AND winner.role=loser.role
);
UPDATE public.property_contacts row SET property_id=map.winner_id
FROM property_merge_map map WHERE row.property_id=map.loser_id;

WITH task_targets AS (
  SELECT task.id,
    coalesce(map.winner_id,task.property_id) AS target_property_id,
    row_number() OVER (
      PARTITION BY coalesce(map.winner_id,task.property_id)
      ORDER BY (map.winner_id IS NULL) DESC, task.created_at, task.id
    ) AS position
  FROM public.property_tasks task
  LEFT JOIN property_merge_map map ON map.loser_id=task.property_id
  WHERE task.is_next_action AND task.status IN ('todo','in_progress','blocked')
    AND (map.loser_id IS NOT NULL OR task.property_id IN (SELECT winner_id FROM property_merge_map))
)
UPDATE public.property_tasks task SET is_next_action=false
FROM task_targets target
WHERE task.id=target.id AND target.position>1;
UPDATE public.property_tasks row SET property_id=map.winner_id
FROM property_merge_map map WHERE row.property_id=map.loser_id;
UPDATE public.property_activity_events row SET property_id=map.winner_id
FROM property_merge_map map WHERE row.property_id=map.loser_id;

-- MIGRATION_SAFETY_REVIEW: only strong-identity duplicate shells are removed;
-- all facts, links, workflow rows and a full before-state merge event survive.
DELETE FROM public.properties loser
USING property_merge_map map WHERE loser.id=map.loser_id;

-- An explicitly linked case and project are one property boundary. Fill a
-- missing side; fail closed when old data asserts two different properties.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.permit_cases c JOIN public.projects p ON p.id=c.project_id
    WHERE c.property_id IS NOT NULL AND p.property_id IS NOT NULL
      AND c.property_id<>p.property_id
  ) THEN
    RAISE EXCEPTION 'Property reconciliation required: linked Permit case and deal disagree';
  END IF;
END $$;
UPDATE public.permit_cases c SET property_id=p.property_id
FROM public.projects p
WHERE c.project_id=p.id AND c.property_id IS NULL AND p.property_id IS NOT NULL;
UPDATE public.projects p SET property_id=c.property_id
FROM public.permit_cases c
WHERE c.project_id=p.id AND p.property_id IS NULL AND c.property_id IS NOT NULL;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.documents d
    LEFT JOIN public.projects p ON p.id=d.project_id
    LEFT JOIN public.permit_cases c ON c.id=d.permit_case_id
    WHERE p.property_id IS NOT NULL AND c.property_id IS NOT NULL
      AND p.property_id<>c.property_id
  ) THEN
    RAISE EXCEPTION 'Property reconciliation required: document parents disagree';
  END IF;
END $$;
UPDATE public.documents d SET property_id=p.property_id
FROM public.projects p
WHERE d.property_id IS NULL AND d.project_id=p.id AND p.property_id IS NOT NULL;
UPDATE public.documents d SET property_id=c.property_id
FROM public.permit_cases c
WHERE d.property_id IS NULL AND d.permit_case_id=c.id AND c.property_id IS NOT NULL;

CREATE UNIQUE INDEX properties_workspace_identity_unique
  ON public.properties(workspace_id,identity_key)
  WHERE workspace_id IS NOT NULL AND status='active' AND identity_key IS NOT NULL;
CREATE UNIQUE INDEX properties_personal_identity_unique
  ON public.properties(owner_id,identity_key)
  WHERE workspace_id IS NULL AND owner_id IS NOT NULL
    AND status='active' AND identity_key IS NOT NULL;

-- Authenticated users cannot mint these rows. They are short-lived, internal
-- transaction capabilities used by the two explicit move/link RPCs below.
CREATE TABLE public.property_link_change_authorizations (
  transaction_id bigint NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('projects','permit_cases','documents')),
  entity_id uuid NOT NULL,
  target_property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE,
  target_workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  target_project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(transaction_id, entity_type, entity_id)
);
ALTER TABLE public.property_link_change_authorizations ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.property_link_change_authorizations TO service_role;

CREATE OR REPLACE FUNCTION public.authorize_property_link_change(
  p_entity_type text,
  p_entity_id uuid,
  p_target_property_id uuid,
  p_target_workspace_id uuid,
  p_target_project_id uuid,
  p_actor_id uuid,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_entity_type NOT IN ('projects','permit_cases','documents')
     OR nullif(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A valid property-link authorization is required';
  END IF;
  INSERT INTO public.property_link_change_authorizations(
    transaction_id,entity_type,entity_id,target_property_id,
    target_workspace_id,target_project_id,actor_id,reason
  ) VALUES (
    txid_current(),p_entity_type,p_entity_id,p_target_property_id,
    p_target_workspace_id,p_target_project_id,p_actor_id,left(trim(p_reason),1000)
  )
  ON CONFLICT(transaction_id,entity_type,entity_id) DO UPDATE SET
    target_property_id=excluded.target_property_id,
    target_workspace_id=excluded.target_workspace_id,
    target_project_id=excluded.target_project_id,
    actor_id=excluded.actor_id,
    reason=excluded.reason;
END;
$$;
REVOKE ALL ON FUNCTION public.authorize_property_link_change(text,uuid,uuid,uuid,uuid,uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_property_link_change(text,uuid,uuid,uuid,uuid,uuid,text)
  TO service_role;

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
  v_provider_place_id text;
  v_region text;
  v_postal_code text;
  v_property_id uuid;
  v_price numeric;
  v_project_type text;
  v_identity_key text;
BEGIN
  IF NEW.property_id IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='permit_cases' THEN
    IF NEW.project_id IS NOT NULL THEN
      SELECT property_id INTO v_property_id FROM public.projects WHERE id=NEW.project_id;
      IF v_property_id IS NOT NULL THEN NEW.property_id:=v_property_id; RETURN NEW; END IF;
    END IF;
  END IF;

  v_address:=nullif(trim(NEW.property_address),'');
  IF v_address IS NULL THEN RETURN NEW; END IF;
  v_provider:=CASE
    WHEN NEW.address_provider IN ('google_places','openstreetmap','manual') THEN NEW.address_provider
    WHEN NEW.address_provider IS NULL THEN 'manual' ELSE 'other' END;
  v_provider_place_id:=nullif(trim(NEW.address_place_id),'');
  IF v_provider='manual' AND v_provider_place_id IS NOT NULL THEN v_provider:='other'; END IF;
  IF TG_TABLE_NAME='projects' THEN
    v_region:=public.canonical_property_region(to_jsonb(NEW)->>'address_region');
  ELSE
    v_region:=public.canonical_property_region(to_jsonb(NEW)->>'province');
  END IF;
  v_postal_code:=nullif(trim(to_jsonb(NEW)->>'postal_code'),'');
  v_normalized:=public.normalize_property_address(
    v_address,NEW.address_line_2,NULL,NEW.municipality,v_region,v_postal_code
  );
  v_identity_key:=public.property_identity_key(
    v_normalized,v_provider,v_provider_place_id,NULL,NEW.address_line_2,
    NEW.municipality,v_postal_code,NEW.latitude,NEW.longitude
  );
  IF v_identity_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'agir:property-identity:' || coalesce(NEW.workspace_id::text,'personal:'||NEW.owner_id::text)
      || ':' || v_identity_key,0
    ));
    SELECT id INTO v_property_id FROM public.properties
    WHERE status='active' AND identity_key=v_identity_key AND (
      (NEW.workspace_id IS NULL AND workspace_id IS NULL AND owner_id=NEW.owner_id)
      OR (NEW.workspace_id IS NOT NULL AND workspace_id=NEW.workspace_id)
    ) LIMIT 1;
  END IF;
  IF v_property_id IS NULL THEN
    IF TG_TABLE_NAME='projects' THEN
      v_price:=nullif(NEW.acquisition_cost,0); v_project_type:=NEW.type::text;
    ELSE
      v_price:=NULL; v_project_type:=NEW.property_type;
    END IF;
    INSERT INTO public.properties(
      owner_id,workspace_id,display_name,building_name,address_line_1,address_line_2,
      municipality,region,postal_code,place_provider,provider_place_id,latitude,longitude,
      zoning_designation,zoning_source_url,price,project_type,notes
    ) VALUES (
      NEW.owner_id,NEW.workspace_id,NEW.name,NEW.building_name,v_address,NEW.address_line_2,
      NEW.municipality,v_region,v_postal_code,v_provider,v_provider_place_id,
      NEW.latitude,NEW.longitude,
      NEW.zoning_designation,
      CASE WHEN NEW.zoning_source ~* '^https?://' THEN NEW.zoning_source ELSE NULL END,
      v_price,v_project_type,NEW.notes
    ) RETURNING id INTO v_property_id;
  END IF;
  NEW.property_id:=v_property_id;
  RETURN NEW;
END;
$$;

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
  v_project_workspace uuid;
  v_project_owner uuid;
  v_case_workspace uuid;
  v_case_owner uuid;
  v_project_property uuid;
  v_case_property uuid;
  v_authorized boolean:=false;
  v_deprovisioning boolean:=false;
BEGIN
  IF TG_OP='UPDATE' THEN
    v_deprovisioning:=auth.uid() IS NULL
      AND OLD.owner_id IS NOT NULL AND NEW.owner_id IS NULL
      AND NEW.property_id IS NOT DISTINCT FROM OLD.property_id;
    IF NEW.owner_id IS DISTINCT FROM OLD.owner_id AND NOT v_deprovisioning THEN
      RAISE EXCEPTION 'Record attribution cannot be changed';
    END IF;
  END IF;

  IF TG_TABLE_NAME='documents' THEN
    IF NEW.project_id IS NOT NULL THEN
      SELECT workspace_id,owner_id,property_id
      INTO v_project_workspace,v_project_owner,v_project_property
      FROM public.projects WHERE id=NEW.project_id;
    END IF;
    IF NEW.permit_case_id IS NOT NULL THEN
      SELECT workspace_id,owner_id,property_id
      INTO v_case_workspace,v_case_owner,v_case_property
      FROM public.permit_cases WHERE id=NEW.permit_case_id;
    END IF;
    IF NEW.project_id IS NOT NULL AND NEW.permit_case_id IS NOT NULL AND (
      v_project_workspace IS DISTINCT FROM v_case_workspace
      OR (v_project_workspace IS NULL AND v_project_owner IS DISTINCT FROM v_case_owner
        AND NOT (v_deprovisioning AND (
          v_project_owner IS NULL OR v_case_owner IS NULL
        )))
    ) THEN
      RAISE EXCEPTION 'Document parents must belong to the same workspace';
    END IF;
    IF v_project_property IS NOT NULL AND v_case_property IS NOT NULL
       AND v_project_property<>v_case_property THEN
      RAISE EXCEPTION 'Document parents must belong to the same property';
    END IF;
    IF NEW.project_id IS NULL AND NEW.permit_case_id IS NULL THEN
      v_parent_workspace:=NULL; v_parent_owner:=NEW.owner_id;
    ELSE
      v_parent_workspace:=coalesce(v_project_workspace,v_case_workspace);
      v_parent_owner:=coalesce(v_project_owner,v_case_owner);
    END IF;
  ELSE
    v_parent_workspace:=NEW.workspace_id; v_parent_owner:=NEW.owner_id;
    IF TG_TABLE_NAME='permit_cases' THEN
      IF NEW.project_id IS NOT NULL THEN
        SELECT workspace_id,owner_id,property_id
        INTO v_project_workspace,v_project_owner,v_project_property
        FROM public.projects WHERE id=NEW.project_id;
        IF v_project_workspace IS DISTINCT FROM NEW.workspace_id
          OR (NEW.workspace_id IS NULL AND v_project_owner IS DISTINCT FROM NEW.owner_id
            AND NOT (v_deprovisioning AND v_project_owner IS NULL)) THEN
          RAISE EXCEPTION 'Linked deal and Permit case must belong to the same workspace';
        END IF;
      END IF;
    ELSIF TG_TABLE_NAME='projects' THEN
      SELECT property_id INTO v_case_property FROM public.permit_cases
      WHERE project_id=NEW.id AND property_id IS NOT NULL AND property_id<>NEW.property_id LIMIT 1;
    END IF;
  END IF;

  IF TG_OP='UPDATE' AND OLD.property_id IS NOT NULL
     AND NEW.property_id IS DISTINCT FROM OLD.property_id THEN
    SELECT EXISTS(
      SELECT 1 FROM public.property_link_change_authorizations a
      WHERE a.transaction_id=txid_current() AND a.entity_type=TG_TABLE_NAME
        AND a.entity_id=NEW.id AND a.target_property_id IS NOT DISTINCT FROM NEW.property_id
        AND a.target_workspace_id IS NOT DISTINCT FROM v_parent_workspace
        AND (
          TG_TABLE_NAME='projects'
          OR a.target_project_id IS NOT DISTINCT FROM
            nullif(to_jsonb(NEW)->>'project_id','')::uuid
        )
        AND a.actor_id IS NOT DISTINCT FROM auth.uid()
    ) INTO v_authorized;
    IF NOT v_authorized THEN
      RAISE EXCEPTION 'Linked records require an explicit property move operation';
    END IF;
  END IF;

  IF NEW.property_id IS NULL THEN
    IF coalesce(v_project_property,v_case_property) IS NOT NULL THEN
      RAISE EXCEPTION 'Linked deal, Permit case, and document must use one property';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO v_property FROM public.properties WHERE id=NEW.property_id;
  IF NOT FOUND OR (auth.uid() IS NOT NULL AND NOT public.property_write_access(NEW.property_id)) THEN
    RAISE EXCEPTION 'Property write access denied';
  END IF;
  IF TG_TABLE_NAME='documents'
     AND coalesce(v_project_property,v_case_property) IS NOT NULL
     AND NEW.property_id<>coalesce(v_project_property,v_case_property) THEN
    RAISE EXCEPTION 'Document must belong to its parent property';
  END IF;
  IF TG_TABLE_NAME='permit_cases' THEN
    IF v_project_property IS NOT NULL AND v_project_property<>NEW.property_id THEN
      RAISE EXCEPTION 'Linked deal and Permit case must belong to the same property';
    END IF;
  END IF;
  IF TG_TABLE_NAME='projects' AND v_case_property IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.permit_cases linked_case
    WHERE linked_case.project_id=NEW.id
      AND linked_case.property_id IS DISTINCT FROM NEW.property_id
      AND NOT EXISTS (
        SELECT 1 FROM public.property_link_change_authorizations link_authorization
        WHERE link_authorization.transaction_id=txid_current()
          AND link_authorization.entity_type='permit_cases'
          AND link_authorization.entity_id=linked_case.id
          AND link_authorization.target_property_id IS NOT DISTINCT FROM NEW.property_id
          AND link_authorization.target_workspace_id IS NOT DISTINCT FROM v_parent_workspace
          AND link_authorization.target_project_id=NEW.id
          AND link_authorization.actor_id IS NOT DISTINCT FROM auth.uid()
      )
  ) THEN
    RAISE EXCEPTION 'Linked deal and Permit case must belong to the same property';
  END IF;

  IF NOT (
    (v_property.workspace_id IS NULL AND v_parent_workspace IS NULL
      AND (
        v_property.owner_id=v_parent_owner
        OR (v_deprovisioning AND v_parent_owner IS NULL
          AND (v_property.owner_id IS NULL OR v_property.owner_id=OLD.owner_id))
      ))
    OR (v_property.workspace_id IS NOT NULL AND v_property.workspace_id=v_parent_workspace)
  ) THEN
    RAISE EXCEPTION 'Linked record must belong to the same property workspace';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_validate_property
  BEFORE INSERT OR UPDATE OF property_id,workspace_id,owner_id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.validate_property_record_link();
CREATE TRIGGER permit_cases_validate_property
  BEFORE INSERT OR UPDATE OF property_id,workspace_id,owner_id,project_id ON public.permit_cases
  FOR EACH ROW EXECUTE FUNCTION public.validate_property_record_link();
CREATE TRIGGER documents_validate_property
  BEFORE INSERT OR UPDATE OF property_id,project_id,permit_case_id,owner_id ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.validate_property_record_link();

CREATE OR REPLACE FUNCTION public.protect_retained_owner_attribution()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  v_old_owner uuid:=nullif(to_jsonb(OLD)->>'owner_id','')::uuid;
  v_new_owner uuid:=nullif(to_jsonb(NEW)->>'owner_id','')::uuid;
BEGIN
  IF v_new_owner IS DISTINCT FROM v_old_owner AND NOT (
    auth.uid() IS NULL AND v_old_owner IS NOT NULL AND v_new_owner IS NULL
  ) THEN RAISE EXCEPTION 'Record attribution cannot be changed'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER relationship_contacts_protect_attribution
  BEFORE UPDATE OF owner_id ON public.relationship_contacts
  FOR EACH ROW EXECUTE FUNCTION public.protect_retained_owner_attribution();
CREATE TRIGGER extraction_jobs_protect_attribution
  BEFORE UPDATE OF owner_id ON public.extraction_jobs
  FOR EACH ROW EXECUTE FUNCTION public.protect_retained_owner_attribution();
CREATE TRIGGER permit_candidates_protect_attribution
  BEFORE UPDATE OF owner_id ON public.permit_extraction_candidates
  FOR EACH ROW EXECUTE FUNCTION public.protect_retained_owner_attribution();

CREATE OR REPLACE FUNCTION public.validate_property_child_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_property public.properties%ROWTYPE; v_contact public.relationship_contacts%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND NEW.property_id IS DISTINCT FROM OLD.property_id THEN
    RAISE EXCEPTION 'A property child cannot be moved to another property';
  END IF;
  IF TG_OP='UPDATE' AND NEW.created_by IS DISTINCT FROM OLD.created_by
     AND NOT (auth.uid() IS NULL AND OLD.created_by IS NOT NULL AND NEW.created_by IS NULL) THEN
    RAISE EXCEPTION 'Property child authorship cannot be changed';
  END IF;
  SELECT * INTO v_property FROM public.properties WHERE id=NEW.property_id;
  IF NOT FOUND OR (auth.uid() IS NOT NULL AND NOT public.property_write_access(NEW.property_id)) THEN
    RAISE EXCEPTION 'Property write access denied';
  END IF;
  IF TG_TABLE_NAME='property_contacts' THEN
    SELECT * INTO v_contact FROM public.relationship_contacts WHERE id=NEW.contact_id;
    IF NOT FOUND OR NOT (
      (v_property.workspace_id IS NULL AND v_contact.workspace_id IS NULL
        AND v_property.owner_id=v_contact.owner_id)
      OR (v_property.workspace_id IS NOT NULL AND v_contact.workspace_id=v_property.workspace_id)
    ) THEN RAISE EXCEPTION 'Contact must belong to the same property workspace'; END IF;
  ELSIF TG_TABLE_NAME='property_tasks' THEN
    IF NEW.assigned_to IS NOT NULL THEN
      IF NOT (
        (v_property.workspace_id IS NULL AND NEW.assigned_to=v_property.owner_id)
        OR (v_property.workspace_id IS NOT NULL AND EXISTS(
          SELECT 1 FROM public.workspace_members m
          WHERE m.workspace_id=v_property.workspace_id AND m.user_id=NEW.assigned_to
        ))
      ) THEN RAISE EXCEPTION 'Task assignee must belong to the property workspace'; END IF;
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

-- Keep linked deal/case address fields as projections of the canonical record.
-- Parent forms cannot silently create a second identity after a link exists;
-- edits are made once on the Property record and projected to both modes.
CREATE OR REPLACE FUNCTION public.validate_canonical_property_projection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_property public.properties%ROWTYPE; v_expected_line_2 text;
BEGIN
  IF NEW.property_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_property FROM public.properties WHERE id=NEW.property_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Canonical property not found'; END IF;
  v_expected_line_2:=coalesce(v_property.unit,v_property.address_line_2);

  IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND NEW.property_id IS DISTINCT FROM OLD.property_id) THEN
    NEW.property_address:=v_property.address_line_1;
    NEW.address_line_2:=v_expected_line_2;
    NEW.building_name:=v_property.building_name;
    NEW.municipality:=v_property.municipality;
    NEW.address_provider:=v_property.place_provider;
    NEW.address_place_id:=v_property.provider_place_id;
    NEW.latitude:=v_property.latitude;
    NEW.longitude:=v_property.longitude;
    NEW.postal_code:=v_property.postal_code;
    IF TG_TABLE_NAME='projects' THEN NEW.address_region:=v_property.region;
    ELSE NEW.province:=coalesce(v_property.region,NEW.province); END IF;
    RETURN NEW;
  END IF;

  IF nullif(trim(NEW.property_address),'') IS DISTINCT FROM v_property.address_line_1
    OR nullif(trim(NEW.address_line_2),'') IS DISTINCT FROM v_expected_line_2
    OR nullif(trim(NEW.building_name),'') IS DISTINCT FROM v_property.building_name
    OR public.canonical_property_municipality(NEW.municipality)
      IS DISTINCT FROM v_property.municipality
    OR nullif(trim(NEW.address_place_id),'') IS DISTINCT FROM v_property.provider_place_id
    OR NEW.address_provider IS DISTINCT FROM v_property.place_provider
    OR NEW.latitude IS DISTINCT FROM v_property.latitude
    OR NEW.longitude IS DISTINCT FROM v_property.longitude
    OR nullif(upper(trim(NEW.postal_code)),'') IS DISTINCT FROM v_property.postal_code
    OR (
      TG_TABLE_NAME='projects' AND v_property.region IS NOT NULL AND
      public.canonical_property_region(to_jsonb(NEW)->>'address_region')
        IS DISTINCT FROM v_property.region
    )
    OR (
      TG_TABLE_NAME='permit_cases' AND v_property.region IS NOT NULL AND
      public.canonical_property_region(to_jsonb(NEW)->>'province')
        IS DISTINCT FROM v_property.region
    )
  THEN
    RAISE EXCEPTION 'Edit the address from the canonical Property record';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER projects_validate_canonical_projection
  BEFORE INSERT OR UPDATE OF property_id,property_address,address_line_2,building_name,
    municipality,address_region,postal_code,address_provider,address_place_id,latitude,longitude
  ON public.projects FOR EACH ROW
  EXECUTE FUNCTION public.validate_canonical_property_projection();
CREATE TRIGGER permit_cases_validate_canonical_projection
  BEFORE INSERT OR UPDATE OF property_id,property_address,address_line_2,building_name,
    municipality,province,postal_code,address_provider,address_place_id,latitude,longitude
  ON public.permit_cases FOR EACH ROW
  EXECUTE FUNCTION public.validate_canonical_property_projection();

CREATE OR REPLACE FUNCTION public.project_canonical_property_address()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_line_2 text:=coalesce(NEW.unit,NEW.address_line_2);
BEGIN
  IF TG_OP='UPDATE' AND (
    NEW.address_line_1 IS NOT DISTINCT FROM OLD.address_line_1
    AND NEW.address_line_2 IS NOT DISTINCT FROM OLD.address_line_2
    AND NEW.unit IS NOT DISTINCT FROM OLD.unit
    AND NEW.building_name IS NOT DISTINCT FROM OLD.building_name
    AND NEW.municipality IS NOT DISTINCT FROM OLD.municipality
    AND NEW.region IS NOT DISTINCT FROM OLD.region
    AND NEW.postal_code IS NOT DISTINCT FROM OLD.postal_code
    AND NEW.place_provider IS NOT DISTINCT FROM OLD.place_provider
    AND NEW.provider_place_id IS NOT DISTINCT FROM OLD.provider_place_id
    AND NEW.latitude IS NOT DISTINCT FROM OLD.latitude
    AND NEW.longitude IS NOT DISTINCT FROM OLD.longitude
  ) THEN RETURN NEW; END IF;

  UPDATE public.projects SET
    property_address=NEW.address_line_1,address_line_2=v_line_2,
    building_name=NEW.building_name,municipality=NEW.municipality,
    address_region=NEW.region,postal_code=NEW.postal_code,
    address_provider=NEW.place_provider,address_place_id=NEW.provider_place_id,
    latitude=NEW.latitude,longitude=NEW.longitude
  WHERE property_id=NEW.id;
  UPDATE public.permit_cases SET
    property_address=NEW.address_line_1,address_line_2=v_line_2,
    building_name=NEW.building_name,municipality=NEW.municipality,
    province=coalesce(NEW.region,province),postal_code=NEW.postal_code,
    address_provider=NEW.place_provider,address_place_id=NEW.provider_place_id,
    latitude=NEW.latitude,longitude=NEW.longitude
  WHERE property_id=NEW.id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER properties_project_canonical_address
  AFTER UPDATE OF address_line_1,address_line_2,unit,building_name,municipality,
    region,postal_code,place_provider,provider_place_id,latitude,longitude
  ON public.properties FOR EACH ROW
  EXECUTE FUNCTION public.project_canonical_property_address();

CREATE OR REPLACE FUNCTION public.audit_property_record_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_reason text; v_actor uuid:=auth.uid(); v_authorized_actor uuid;
BEGIN
  IF TG_OP='UPDATE' AND NEW.property_id IS NOT DISTINCT FROM OLD.property_id THEN RETURN NEW; END IF;
  SELECT a.reason,a.actor_id INTO v_reason,v_authorized_actor
  FROM public.property_link_change_authorizations a
  WHERE a.transaction_id=txid_current() AND a.entity_type=TG_TABLE_NAME
    AND a.entity_id=NEW.id LIMIT 1;
  v_actor:=coalesce(v_actor,v_authorized_actor);
  IF TG_OP='UPDATE' AND OLD.property_id IS NOT NULL THEN
    INSERT INTO public.property_activity_events(
      property_id,actor_id,event_type,entity_type,entity_id,before_state,after_state,reason
    ) VALUES (
      OLD.property_id,v_actor,TG_TABLE_NAME||'_unlinked',TG_TABLE_NAME,NEW.id,
      jsonb_build_object('property_id',OLD.property_id),
      jsonb_build_object('property_id',NEW.property_id),v_reason
    );
  END IF;
  IF NEW.property_id IS NOT NULL THEN
    INSERT INTO public.property_activity_events(
      property_id,actor_id,event_type,entity_type,entity_id,before_state,after_state,reason
    ) VALUES (
      NEW.property_id,v_actor,TG_TABLE_NAME||'_linked',TG_TABLE_NAME,NEW.id,
      jsonb_build_object('property_id',CASE WHEN TG_OP='UPDATE' THEN OLD.property_id END),
      jsonb_build_object('property_id',NEW.property_id),v_reason
    );
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
    OR (TG_OP='UPDATE' AND NEW.property_id IS NOT DISTINCT FROM OLD.property_id) THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME='projects' THEN
    UPDATE public.permit_cases SET property_id=NEW.property_id
    WHERE project_id=NEW.id AND property_id IS NULL;
    UPDATE public.documents SET property_id=NEW.property_id
    WHERE project_id=NEW.id AND property_id IS NULL;
  ELSE
    IF NEW.project_id IS NOT NULL THEN
      UPDATE public.projects SET property_id=NEW.property_id
      WHERE id=NEW.project_id AND property_id IS NULL;
    END IF;
    UPDATE public.documents SET property_id=NEW.property_id
    WHERE permit_case_id=NEW.id AND property_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER projects_propagate_property
  AFTER INSERT OR UPDATE OF property_id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.propagate_parent_property();
CREATE TRIGGER permit_cases_propagate_property
  AFTER INSERT OR UPDATE OF property_id ON public.permit_cases
  FOR EACH ROW EXECUTE FUNCTION public.propagate_parent_property();

-- Selecting a next action is a lock-first operation. The earlier row trigger
-- acquired its advisory lock only after PostgreSQL had locked the task row,
-- which allowed a row-lock/advisory-lock cycle under concurrent updates.
CREATE TABLE public.property_next_action_authorizations (
  transaction_id bigint NOT NULL,
  task_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  PRIMARY KEY(transaction_id,task_id)
);
REVOKE ALL ON public.property_next_action_authorizations
  FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.property_next_action_authorizations TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_property_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.title:=trim(NEW.title);
  NEW.updated_at:=now();
  IF NEW.status='done' AND NEW.completed_at IS NULL THEN
    NEW.completed_at:=now();
  ELSIF NEW.status<>'done' THEN
    NEW.completed_at:=NULL;
  END IF;
  IF NEW.status IN ('done','cancelled') THEN NEW.is_next_action:=false; END IF;

  IF NEW.is_next_action
    AND (TG_OP='INSERT' OR NOT OLD.is_next_action)
    AND NOT EXISTS (
      SELECT 1 FROM public.property_next_action_authorizations next_action_authorization
      WHERE next_action_authorization.transaction_id=txid_current()
        AND next_action_authorization.task_id=NEW.id
        AND next_action_authorization.actor_id=auth.uid()
    )
  THEN
    RAISE EXCEPTION 'Use set_property_next_action to select the next action';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_property_next_action(
  p_task_id uuid,p_enabled boolean DEFAULT true
) RETURNS public.property_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_property_id uuid;
  v_task public.property_tasks%ROWTYPE;
  v_result public.property_tasks%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication is required'; END IF;

  -- This first read deliberately takes no row lock. The property-scoped
  -- advisory lock is always acquired before any task row can be locked.
  SELECT property_id INTO v_property_id
  FROM public.property_tasks WHERE id=p_task_id;
  IF v_property_id IS NULL OR NOT public.property_write_access(v_property_id) THEN
    RAISE EXCEPTION 'Property task access denied';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('agir:property-next-action:'||v_property_id::text,0)
  );
  SELECT * INTO v_task FROM public.property_tasks WHERE id=p_task_id FOR UPDATE;
  IF NOT FOUND OR v_task.property_id<>v_property_id THEN
    RAISE EXCEPTION 'Property task is unavailable';
  END IF;

  IF coalesce(p_enabled,true) THEN
    IF v_task.status NOT IN ('todo','in_progress','blocked') THEN
      RAISE EXCEPTION 'Only an open task can be the next action';
    END IF;
    UPDATE public.property_tasks SET is_next_action=false
    WHERE property_id=v_property_id AND id<>p_task_id
      AND is_next_action AND status IN ('todo','in_progress','blocked');
    INSERT INTO public.property_next_action_authorizations(
      transaction_id,task_id,actor_id
    ) VALUES (txid_current(),p_task_id,auth.uid())
    ON CONFLICT(transaction_id,task_id) DO UPDATE SET actor_id=excluded.actor_id;
    UPDATE public.property_tasks SET is_next_action=true
    WHERE id=p_task_id RETURNING * INTO v_result;
  ELSE
    UPDATE public.property_tasks SET is_next_action=false
    WHERE id=p_task_id RETURNING * INTO v_result;
  END IF;
  DELETE FROM public.property_next_action_authorizations
  WHERE transaction_id=txid_current() AND task_id=p_task_id;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.set_property_next_action(uuid,boolean)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_property_next_action(uuid,boolean)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.copy_property_to_workspace(
  p_source_property_id uuid,p_workspace_id uuid,p_actor_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_source public.properties%ROWTYPE; v_result uuid;
BEGIN
  IF p_source_property_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_source FROM public.properties WHERE id=p_source_property_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Canonical property not found'; END IF;
  IF v_source.workspace_id=p_workspace_id THEN RETURN v_source.id; END IF;
  IF v_source.identity_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'agir:property-identity:'||p_workspace_id::text||':'||v_source.identity_key,0
    ));
    SELECT id INTO v_result FROM public.properties
    WHERE workspace_id=p_workspace_id AND status='active'
      AND identity_key=v_source.identity_key LIMIT 1;
  END IF;
  IF v_result IS NULL THEN
    INSERT INTO public.properties(
      owner_id,workspace_id,display_name,building_name,address_line_1,address_line_2,unit,
      municipality,region,postal_code,country_code,place_provider,provider_place_id,
      latitude,longitude,zoning_designation,zoning_source_url,zoning_verified_at,
      zoning_evidence,price,currency,owner_name,broker_name,project_type,notes
    ) VALUES (
      p_actor_id,p_workspace_id,v_source.display_name,v_source.building_name,
      v_source.address_line_1,v_source.address_line_2,v_source.unit,v_source.municipality,
      v_source.region,v_source.postal_code,v_source.country_code,v_source.place_provider,
      v_source.provider_place_id,v_source.latitude,v_source.longitude,
      v_source.zoning_designation,v_source.zoning_source_url,v_source.zoning_verified_at,
      v_source.zoning_evidence,v_source.price,v_source.currency,v_source.owner_name,
      v_source.broker_name,v_source.project_type,v_source.notes
    ) RETURNING id INTO v_result;
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.copy_property_to_workspace(uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.transfer_permit_case_to_workspace(
  p_case_id uuid,p_workspace_id uuid,p_reason text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_case public.permit_cases%ROWTYPE; v_target_property uuid; v_document record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication is required'; END IF;
  IF nullif(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'A transfer reason is required'; END IF;
  SELECT * INTO v_case FROM public.permit_cases WHERE id=p_case_id FOR UPDATE;
  IF NOT FOUND OR v_case.owner_id<>auth.uid() OR v_case.workspace_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only the owner can move a personal permit case';
  END IF;
  IF public.workspace_role(p_workspace_id) NOT IN ('owner','admin','member') THEN
    RAISE EXCEPTION 'You cannot move this case into that workspace';
  END IF;
  IF v_case.project_id IS NOT NULL OR EXISTS(
    SELECT 1 FROM public.documents d
    WHERE d.permit_case_id=p_case_id AND d.project_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Unlink the Permit case from its deal before moving it';
  END IF;
  IF EXISTS(
    SELECT 1 FROM public.documents d WHERE d.permit_case_id=p_case_id
      AND d.property_id IS NOT NULL
      AND d.property_id IS DISTINCT FROM v_case.property_id
  ) THEN RAISE EXCEPTION 'Property reconciliation is required before moving this case'; END IF;

  v_target_property:=public.copy_property_to_workspace(
    v_case.property_id,p_workspace_id,auth.uid()
  );
  IF v_case.property_id IS NOT NULL
    AND v_target_property IS DISTINCT FROM v_case.property_id THEN
    PERFORM public.authorize_property_link_change(
      'permit_cases',p_case_id,v_target_property,p_workspace_id,NULL,
      auth.uid(),p_reason
    );
  END IF;
  FOR v_document IN
    SELECT id,property_id FROM public.documents WHERE permit_case_id=p_case_id FOR UPDATE
  LOOP
    IF v_document.property_id IS NOT NULL
      AND v_document.property_id IS DISTINCT FROM v_target_property THEN
      PERFORM public.authorize_property_link_change(
        'documents',v_document.id,v_target_property,p_workspace_id,NULL,
        auth.uid(),p_reason
      );
    END IF;
  END LOOP;

  UPDATE public.permit_cases SET
    workspace_id=p_workspace_id,property_id=v_target_property,updated_at=now()
  WHERE id=p_case_id;
  UPDATE public.documents SET property_id=v_target_property
  WHERE permit_case_id=p_case_id AND property_id IS DISTINCT FROM v_target_property;
  INSERT INTO public.permit_case_history(
    case_id,action,previous_data,new_data,reason,changed_by
  ) VALUES (
    p_case_id,'case_workspace_transferred',
    jsonb_build_object('workspace_id',NULL,'property_id',v_case.property_id),
    jsonb_build_object('workspace_id',p_workspace_id,'property_id',v_target_property),
    left(trim(p_reason),1000),auth.uid()
  );
  -- MIGRATION_SAFETY_REVIEW: transaction capabilities are consumed and removed.
  DELETE FROM public.property_link_change_authorizations
  WHERE transaction_id=txid_current();
  RETURN p_case_id;
END;
$$;
REVOKE ALL ON FUNCTION public.transfer_permit_case_to_workspace(uuid,uuid,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transfer_permit_case_to_workspace(uuid,uuid,text)
  TO authenticated;

-- Governed resolution path for a personal Property root. The operation moves
-- every linked deal/case/document through the same transaction capabilities
-- used by case linking, copies property-owned research, preserves immutable
-- activity/search history, and removes the now-empty personal shell.
CREATE OR REPLACE FUNCTION public.transfer_personal_property_to_workspace(
  p_property_id uuid,p_workspace_id uuid,p_reason text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_source public.properties%ROWTYPE;
  v_target_property uuid;
  v_record record;
  v_new_contact uuid;
  v_new_task uuid;
  v_next_task uuid;
  v_project_ids uuid[];
  v_case_ids uuid[];
  v_document_ids uuid[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication is required'; END IF;
  IF nullif(trim(p_reason),'') IS NULL THEN
    RAISE EXCEPTION 'A transfer reason is required';
  END IF;
  SELECT * INTO v_source FROM public.properties
  WHERE id=p_property_id FOR UPDATE;
  IF NOT FOUND OR v_source.workspace_id IS NOT NULL
    OR v_source.owner_id IS DISTINCT FROM auth.uid() OR v_source.status<>'active'
  THEN
    RAISE EXCEPTION 'Only the owner can move an active personal property';
  END IF;
  IF public.workspace_role(p_workspace_id) NOT IN ('owner','admin','member') THEN
    RAISE EXCEPTION 'You cannot move this property into that workspace';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.documents document
    WHERE document.property_id=p_property_id
      AND document.project_id IS NULL AND document.permit_case_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Attach standalone property documents to a deal or Permit case before moving the property';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.projects project
    WHERE project.property_id=p_property_id
      AND (project.workspace_id IS NOT NULL OR project.owner_id IS DISTINCT FROM auth.uid())
  ) OR EXISTS (
    SELECT 1 FROM public.permit_cases permit_case
    WHERE permit_case.property_id=p_property_id
      AND (permit_case.workspace_id IS NOT NULL OR permit_case.owner_id IS DISTINCT FROM auth.uid())
  ) THEN
    RAISE EXCEPTION 'Property-linked records require ownership reconciliation before transfer';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.permit_cases permit_case
    JOIN public.projects project ON project.id=permit_case.project_id
    WHERE project.property_id=p_property_id
      AND permit_case.property_id IS DISTINCT FROM p_property_id
  ) OR EXISTS (
    SELECT 1 FROM public.documents document
    WHERE (
      document.project_id IN (
        SELECT project.id FROM public.projects project
        WHERE project.property_id=p_property_id
      ) OR document.permit_case_id IN (
        SELECT permit_case.id FROM public.permit_cases permit_case
        JOIN public.projects project ON project.id=permit_case.project_id
        WHERE project.property_id=p_property_id
      )
    ) AND document.property_id IS DISTINCT FROM p_property_id
  ) THEN
    RAISE EXCEPTION 'Property-linked records require canonical reconciliation before transfer';
  END IF;

  v_target_property:=public.copy_property_to_workspace(
    p_property_id,p_workspace_id,auth.uid()
  );

  -- Standalone Permit cases already have a hardened graph transfer operation.
  FOR v_record IN
    SELECT id FROM public.permit_cases
    WHERE property_id=p_property_id AND project_id IS NULL
    ORDER BY id FOR UPDATE
  LOOP
    PERFORM public.transfer_permit_case_to_workspace(
      v_record.id,p_workspace_id,p_reason
    );
  END LOOP;

  SELECT coalesce(array_agg(project.id ORDER BY project.id),'{}'::uuid[])
  INTO v_project_ids
  FROM public.projects project WHERE project.property_id=p_property_id;
  SELECT coalesce(array_agg(permit_case.id ORDER BY permit_case.id),'{}'::uuid[])
  INTO v_case_ids
  FROM public.permit_cases permit_case
  WHERE permit_case.project_id=ANY(v_project_ids);
  SELECT coalesce(array_agg(document.id ORDER BY document.id),'{}'::uuid[])
  INTO v_document_ids
  FROM public.documents document
  WHERE document.property_id=p_property_id
     OR document.project_id=ANY(v_project_ids)
     OR document.permit_case_id=ANY(v_case_ids);

  -- Pre-authorize the complete deal graph before moving its root. The project
  -- validator requires every linked case to carry a matching capability so no
  -- cross-tenant intermediate state is reachable from an ordinary UPDATE.
  FOR v_record IN
    SELECT id FROM public.projects
    WHERE id=ANY(v_project_ids) ORDER BY id FOR UPDATE
  LOOP
    PERFORM public.authorize_property_link_change(
      'projects',v_record.id,v_target_property,p_workspace_id,NULL,
      auth.uid(),p_reason
    );
  END LOOP;
  FOR v_record IN
    SELECT permit_case.id,permit_case.project_id
    FROM public.permit_cases permit_case
    WHERE permit_case.id=ANY(v_case_ids)
    ORDER BY permit_case.id FOR UPDATE OF permit_case
  LOOP
    PERFORM public.authorize_property_link_change(
      'permit_cases',v_record.id,v_target_property,p_workspace_id,
      v_record.project_id,auth.uid(),p_reason
    );
  END LOOP;
  FOR v_record IN
    SELECT document.id,document.project_id
    FROM public.documents document
    WHERE document.id=ANY(v_document_ids)
    ORDER BY document.id FOR UPDATE OF document
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.documents document
      WHERE document.id=v_record.id AND document.property_id IS NOT NULL
        AND document.property_id IS DISTINCT FROM v_target_property
    ) THEN
      PERFORM public.authorize_property_link_change(
        'documents',v_record.id,v_target_property,p_workspace_id,
        v_record.project_id,auth.uid(),p_reason
      );
    END IF;
  END LOOP;

  UPDATE public.projects SET
    workspace_id=p_workspace_id,property_id=v_target_property,updated_at=now()
  WHERE id=ANY(v_project_ids);
  UPDATE public.permit_cases permit_case SET
    workspace_id=p_workspace_id,property_id=v_target_property,updated_at=now()
  WHERE permit_case.id=ANY(v_case_ids);
  UPDATE public.documents document SET property_id=v_target_property
  WHERE document.id=ANY(v_document_ids);

  INSERT INTO public.permit_case_history(
    case_id,action,previous_data,new_data,reason,changed_by
  )
  SELECT permit_case.id,'case_workspace_transferred',
    jsonb_build_object('workspace_id',NULL,'property_id',p_property_id),
    jsonb_build_object('workspace_id',p_workspace_id,'property_id',v_target_property),
    left(trim(p_reason),1000),auth.uid()
  FROM public.permit_cases permit_case
  WHERE permit_case.id=ANY(v_case_ids);

  INSERT INTO public.property_urls(property_id,created_by,url,label,created_at)
  SELECT v_target_property,auth.uid(),url,label,created_at
  FROM public.property_urls WHERE property_id=p_property_id
  ON CONFLICT(property_id,url) DO NOTHING;

  FOR v_record IN
    SELECT link.role,link.notes,link.created_at,
      contact.full_name,contact.company,contact.title,contact.email,contact.phone,
      contact.relationship_type,contact.strength,contact.last_contacted_at,
      contact.next_follow_up_at,contact.notes AS contact_notes,
      contact.created_at AS contact_created_at,contact.updated_at AS contact_updated_at
    FROM public.property_contacts link
    JOIN public.relationship_contacts contact ON contact.id=link.contact_id
    WHERE link.property_id=p_property_id
    ORDER BY link.id
  LOOP
    INSERT INTO public.relationship_contacts(
      owner_id,workspace_id,full_name,company,title,email,phone,relationship_type,
      strength,last_contacted_at,next_follow_up_at,notes,created_at,updated_at
    ) VALUES (
      auth.uid(),p_workspace_id,v_record.full_name,v_record.company,v_record.title,
      v_record.email,v_record.phone,v_record.relationship_type,v_record.strength,
      v_record.last_contacted_at,v_record.next_follow_up_at,v_record.contact_notes,
      v_record.contact_created_at,v_record.contact_updated_at
    ) RETURNING id INTO v_new_contact;
    INSERT INTO public.property_contacts(
      property_id,contact_id,created_by,role,notes,created_at
    ) VALUES (
      v_target_property,v_new_contact,auth.uid(),v_record.role,
      v_record.notes,v_record.created_at
    ) ON CONFLICT(property_id,contact_id,role) DO NOTHING;
  END LOOP;

  FOR v_record IN
    SELECT * FROM public.property_tasks
    WHERE property_id=p_property_id ORDER BY created_at,id
  LOOP
    INSERT INTO public.property_tasks(
      property_id,created_by,assigned_to,title,notes,status,priority,due_at,
      completed_at,is_next_action,created_at,updated_at
    ) VALUES (
      v_target_property,auth.uid(),v_record.assigned_to,v_record.title,v_record.notes,
      v_record.status,v_record.priority,v_record.due_at,v_record.completed_at,
      false,v_record.created_at,v_record.updated_at
    ) RETURNING id INTO v_new_task;
    IF v_record.is_next_action AND v_next_task IS NULL AND NOT EXISTS (
      SELECT 1 FROM public.property_tasks target_task
      WHERE target_task.property_id=v_target_property AND target_task.is_next_action
        AND target_task.status IN ('todo','in_progress','blocked')
    ) THEN
      v_next_task:=v_new_task;
    END IF;
  END LOOP;
  IF v_next_task IS NOT NULL THEN
    PERFORM public.set_property_next_action(v_next_task,true);
  END IF;

  -- Child DELETE events are retained and then re-parented with the rest of the
  -- immutable source activity. The empty personal shell can then be removed.
  DELETE FROM public.property_contacts WHERE property_id=p_property_id;
  DELETE FROM public.property_urls WHERE property_id=p_property_id;
  DELETE FROM public.property_tasks WHERE property_id=p_property_id;

  INSERT INTO public.property_search_documents(
    property_id,source_type,source_key,search_text,updated_at
  )
  SELECT v_target_property,'history',
    'transfer:'||p_property_id::text||':'||source_type||':'||source_key,
    search_text,updated_at
  FROM public.property_search_documents WHERE property_id=p_property_id
  ON CONFLICT(property_id,source_type,source_key) DO UPDATE SET
    search_text=excluded.search_text,updated_at=excluded.updated_at;
  DELETE FROM public.property_search_documents WHERE property_id=p_property_id;

  UPDATE public.property_activity_events SET property_id=v_target_property
  WHERE property_id=p_property_id;
  INSERT INTO public.property_activity_events(
    property_id,actor_id,event_type,entity_type,entity_id,
    before_state,after_state,reason,metadata
  ) VALUES (
    v_target_property,auth.uid(),'property_workspace_transferred','property',
    v_target_property,to_jsonb(v_source),
    jsonb_build_object('property_id',v_target_property,'workspace_id',p_workspace_id),
    left(trim(p_reason),1000),
    jsonb_build_object('source_property_id',p_property_id,
      'target_property_id',v_target_property,'workspace_id',p_workspace_id)
  );
  DELETE FROM public.properties WHERE id=p_property_id;
  DELETE FROM public.property_link_change_authorizations
  WHERE transaction_id=txid_current();
  RETURN v_target_property;
END;
$$;
REVOKE ALL ON FUNCTION public.transfer_personal_property_to_workspace(uuid,uuid,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transfer_personal_property_to_workspace(uuid,uuid,text)
  TO authenticated;

-- A case may acquire its first same-tenant canonical property through the
-- Property workspace UI. Reassignments remain capability-gated by the trigger.
GRANT UPDATE(property_id) ON public.permit_cases TO authenticated;

CREATE OR REPLACE FUNCTION public.set_permit_case_project(
  p_case_id uuid,p_expected_version bigint,p_reason text,p_project_id uuid DEFAULT NULL
) RETURNS public.permit_cases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_case public.permit_cases%ROWTYPE;
  v_project public.projects%ROWTYPE;
  v_result public.permit_cases%ROWTYPE;
  v_target_property uuid;
  v_document record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication is required'; END IF;
  IF nullif(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'A linking reason is required'; END IF;
  SELECT * INTO v_case FROM public.permit_cases WHERE id=p_case_id FOR UPDATE;
  IF NOT FOUND OR NOT public.permit_case_write_access(p_case_id) THEN
    RAISE EXCEPTION 'Permit case access denied';
  END IF;
  IF v_case.row_version<>p_expected_version THEN RAISE EXCEPTION 'Permit case version conflict'; END IF;

  v_target_property:=v_case.property_id;
  IF p_project_id IS NOT NULL THEN
    SELECT * INTO v_project FROM public.projects WHERE id=p_project_id FOR UPDATE;
    IF NOT FOUND OR NOT public.permit_project_access(p_project_id)
      OR v_project.workspace_id IS DISTINCT FROM v_case.workspace_id
      OR (v_case.workspace_id IS NULL AND v_project.owner_id IS DISTINCT FROM v_case.owner_id) THEN
      RAISE EXCEPTION 'Project access denied';
    END IF;
    IF EXISTS(
      SELECT 1 FROM public.permit_cases
      WHERE project_id=p_project_id AND id<>p_case_id
    ) THEN RAISE EXCEPTION 'This deal is already linked to another Permit case'; END IF;
    IF v_project.property_id IS NULL AND v_case.property_id IS NOT NULL THEN
      UPDATE public.projects SET property_id=v_case.property_id WHERE id=p_project_id
      RETURNING * INTO v_project;
    END IF;
    v_target_property:=coalesce(v_project.property_id,v_case.property_id);
  END IF;

  IF v_case.property_id IS NOT NULL
    AND v_case.property_id IS DISTINCT FROM v_target_property THEN
    PERFORM public.authorize_property_link_change(
      'permit_cases',p_case_id,v_target_property,v_case.workspace_id,p_project_id,
      auth.uid(),p_reason
    );
  END IF;
  FOR v_document IN
    SELECT id,property_id FROM public.documents WHERE permit_case_id=p_case_id FOR UPDATE
  LOOP
    IF v_document.property_id IS NOT NULL
      AND v_document.property_id IS DISTINCT FROM v_target_property THEN
      PERFORM public.authorize_property_link_change(
        'documents',v_document.id,v_target_property,v_case.workspace_id,p_project_id,
        auth.uid(),p_reason
      );
    END IF;
  END LOOP;

  UPDATE public.permit_cases SET project_id=p_project_id,property_id=v_target_property
  WHERE id=p_case_id RETURNING * INTO v_result;
  UPDATE public.project_permits SET project_id=p_project_id WHERE case_id=p_case_id;
  UPDATE public.documents SET project_id=p_project_id,property_id=v_target_property
  WHERE permit_case_id=p_case_id;
  INSERT INTO public.permit_case_history(
    case_id,action,previous_data,new_data,reason,changed_by
  ) VALUES (
    p_case_id,
    CASE WHEN p_project_id IS NULL THEN 'case_project_unlinked' ELSE 'case_project_linked' END,
    jsonb_build_object('project_id',v_case.project_id,'property_id',v_case.property_id),
    jsonb_build_object('project_id',p_project_id,'property_id',v_target_property),
    left(trim(p_reason),1000),auth.uid()
  );
  -- MIGRATION_SAFETY_REVIEW: transaction capabilities are consumed and removed.
  DELETE FROM public.property_link_change_authorizations
  WHERE transaction_id=txid_current();
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.set_permit_case_project(uuid,bigint,text,uuid)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_permit_case_project(uuid,bigint,text,uuid)
  TO authenticated;

-- 007 makes Permit parent identity immutable and emits case/project audit
-- events. Preserve that contract while allowing only the FK-driven
-- owner_id -> NULL transition used during user deprovisioning.
CREATE OR REPLACE FUNCTION public.protect_project_permit_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_case_project uuid; v_trusted_deprovision boolean;
BEGIN
  v_trusted_deprovision:=TG_OP='UPDATE' AND auth.uid() IS NULL
    AND OLD.owner_id IS NOT NULL AND NEW.owner_id IS NULL
    AND NEW.case_id IS NOT DISTINCT FROM OLD.case_id
    AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id;
  IF TG_OP='UPDATE' AND (
    (NEW.owner_id IS DISTINCT FROM OLD.owner_id AND NOT v_trusted_deprovision)
    OR NEW.case_id IS DISTINCT FROM OLD.case_id
    OR (OLD.case_id IS NULL AND NEW.project_id IS DISTINCT FROM OLD.project_id)
  ) THEN RAISE EXCEPTION 'Permit authorship and parent cannot be changed'; END IF;
  IF NEW.case_id IS NOT NULL THEN
    SELECT project_id INTO v_case_project FROM public.permit_cases WHERE id=NEW.case_id;
    IF NEW.project_id IS DISTINCT FROM v_case_project
      THEN RAISE EXCEPTION 'Case Permit must use the case project link'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.bind_extraction_job_to_permit_case()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_document public.documents%ROWTYPE;
  v_actor uuid:=auth.uid();
  v_trusted_deprovision boolean:=false;
BEGIN
  IF TG_OP='UPDATE' THEN
    v_trusted_deprovision:=v_actor IS NULL
      AND OLD.owner_id IS NOT NULL AND NEW.owner_id IS NULL
      AND NEW.kind IS NOT DISTINCT FROM OLD.kind
      AND NEW.idempotency_key IS NOT DISTINCT FROM OLD.idempotency_key
      AND NEW.document_id IS NOT DISTINCT FROM OLD.document_id
      AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id
      AND NEW.permit_case_id IS NOT DISTINCT FROM OLD.permit_case_id;
    IF (NEW.owner_id IS DISTINCT FROM OLD.owner_id AND NOT v_trusted_deprovision)
      OR NEW.kind IS DISTINCT FROM OLD.kind
      OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
      OR NEW.document_id IS DISTINCT FROM OLD.document_id
      OR NEW.project_id IS DISTINCT FROM OLD.project_id
      OR NEW.permit_case_id IS DISTINCT FROM OLD.permit_case_id
    THEN RAISE EXCEPTION 'Extraction job identity and scope cannot be changed'; END IF;
    RETURN NEW;
  END IF;

  IF NEW.document_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_document FROM public.documents WHERE id=NEW.document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document job source is unavailable'; END IF;
  IF NEW.project_id IS NOT NULL AND NEW.project_id IS DISTINCT FROM v_document.project_id
    THEN RAISE EXCEPTION 'Document job project does not match its source'; END IF;
  IF NEW.permit_case_id IS NOT NULL
    AND NEW.permit_case_id IS DISTINCT FROM v_document.permit_case_id
    THEN RAISE EXCEPTION 'Document job Permit case does not match its source'; END IF;
  NEW.project_id:=v_document.project_id;
  NEW.permit_case_id:=v_document.permit_case_id;
  IF v_actor IS NOT NULL THEN
    IF NEW.owner_id IS DISTINCT FROM v_actor THEN
      RAISE EXCEPTION 'Extraction job requester does not match the authenticated user';
    ELSIF NEW.permit_case_id IS NOT NULL THEN
      IF NOT public.permit_case_write_access(NEW.permit_case_id)
        THEN RAISE EXCEPTION 'Permit case write access is required'; END IF;
    ELSIF NEW.project_id IS NOT NULL THEN
      IF NOT public.permit_project_access(NEW.project_id)
        THEN RAISE EXCEPTION 'Project write access is required'; END IF;
    ELSIF v_document.owner_id IS DISTINCT FROM v_actor THEN
      RAISE EXCEPTION 'Document job access is denied';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_project_permit_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  p public.project_permits;
  v_reason text;
  v_history_actor uuid;
  v_audit_actor uuid;
  v_audit_owner uuid;
  v_action text:='permit_'||lower(TG_OP);
  v_trusted_deprovision boolean:=false;
BEGIN
  p:=CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  IF TG_OP='UPDATE' THEN
    v_trusted_deprovision:=auth.uid() IS NULL
      AND OLD.owner_id IS NOT NULL AND NEW.owner_id IS NULL
      AND NEW.case_id IS NOT DISTINCT FROM OLD.case_id
      AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id;
  END IF;
  v_history_actor:=CASE WHEN v_trusted_deprovision THEN NULL
    ELSE coalesce(auth.uid(),p.owner_id,CASE WHEN TG_OP<>'INSERT' THEN OLD.owner_id END) END;
  v_audit_actor:=coalesce(
    auth.uid(),p.owner_id,CASE WHEN TG_OP<>'INSERT' THEN OLD.owner_id END
  );
  v_audit_owner:=coalesce(p.owner_id,
    CASE WHEN TG_OP<>'INSERT' THEN OLD.owner_id END,v_audit_actor);
  v_reason:=CASE WHEN TG_OP='DELETE' THEN coalesce(OLD.required_reason,OLD.notes)
    WHEN TG_OP='INSERT' THEN coalesce(NEW.required_reason,NEW.notes)
    ELSE coalesce(NEW.required_reason,NEW.notes,OLD.required_reason,OLD.notes) END;

  IF TG_OP='INSERT' THEN
    INSERT INTO public.permit_history(
      project_permit_id,new_status,new_applicability_status,change_reason,
      source_document_id,source_text,changed_by
    ) VALUES (
      NEW.id,NEW.workflow_status,NEW.applicability_status,v_reason,
      NEW.source_document_id,NEW.source_text,v_history_actor
    );
  ELSIF TG_OP='UPDATE' THEN
    INSERT INTO public.permit_history(
      project_permit_id,previous_status,new_status,
      previous_applicability_status,new_applicability_status,change_reason,
      source_document_id,source_text,changed_by
    ) VALUES (
      NEW.id,OLD.workflow_status,NEW.workflow_status,
      OLD.applicability_status,NEW.applicability_status,v_reason,
      NEW.source_document_id,NEW.source_text,v_history_actor
    );
  END IF;

  IF p.case_id IS NOT NULL AND TG_OP='DELETE' THEN
    INSERT INTO public.permit_case_history(
      case_id,action,previous_data,new_data,reason,changed_by
    )
    SELECT p.case_id,v_action,
      CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,
      CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END,
      left(v_reason,1000),v_history_actor
    FROM public.permit_cases c WHERE c.id=p.case_id;
  ELSIF p.project_id IS NOT NULL AND v_audit_owner IS NOT NULL
    AND v_audit_actor IS NOT NULL THEN
    INSERT INTO public.audit_logs(
      project_id,workspace_id,owner_id,user_id,entity_type,entity_id,action,payload
    )
    SELECT p.project_id,pr.workspace_id,v_audit_owner,v_audit_actor,
      'permit',p.id,v_action,
      jsonb_build_object('table',TG_TABLE_NAME,'operation',TG_OP,
        'attribution_removed',v_trusted_deprovision)
    FROM public.projects pr WHERE pr.id=p.project_id;
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- ---------------------------------------------------------------------------
-- Indexed current + historical property search and paginated activity
-- ---------------------------------------------------------------------------

CREATE TABLE public.property_search_documents (
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
  source_type text NOT NULL CHECK (source_type IN (
    'property','property_url','property_contact','property_task',
    'project','permit_case','document','history'
  )),
  source_key text NOT NULL,
  search_text text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(property_id,source_type,source_key)
);
CREATE INDEX property_search_documents_property_idx
  ON public.property_search_documents(property_id,source_type);
CREATE INDEX property_search_documents_text_trgm_idx
  ON public.property_search_documents USING gin(search_text gin_trgm_ops);
ALTER TABLE public.property_search_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY property_search_documents_select ON public.property_search_documents
  FOR SELECT TO authenticated USING (public.property_access(property_id));
GRANT SELECT ON public.property_search_documents TO authenticated;
GRANT ALL ON public.property_search_documents TO service_role;

CREATE OR REPLACE FUNCTION public.normalize_property_search_text(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public AS $$
  SELECT trim(regexp_replace(lower(coalesce(p_value,'')),'\s+',' ','g'));
$$;

CREATE OR REPLACE FUNCTION public.refresh_property_search_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_new jsonb:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  v_row jsonb:=coalesce(v_new,v_old);
  v_old_property uuid;
  v_property uuid;
  v_source_type text;
  v_source_key text;
  v_text text;
  v_old_text text;
  v_contact jsonb;
BEGIN
  v_source_type:=CASE TG_TABLE_NAME
    WHEN 'properties' THEN 'property'
    WHEN 'property_urls' THEN 'property_url'
    WHEN 'property_contacts' THEN 'property_contact'
    WHEN 'property_tasks' THEN 'property_task'
    WHEN 'projects' THEN 'project'
    WHEN 'permit_cases' THEN 'permit_case'
    WHEN 'documents' THEN 'document'
  END;
  v_property:=CASE WHEN TG_TABLE_NAME='properties'
    THEN nullif(v_row->>'id','')::uuid
    ELSE nullif(v_row->>'property_id','')::uuid END;
  v_old_property:=CASE WHEN TG_TABLE_NAME='properties'
    THEN nullif(v_old->>'id','')::uuid
    ELSE nullif(v_old->>'property_id','')::uuid END;
  v_source_key:=v_row->>'id';
  IF TG_TABLE_NAME='property_contacts' THEN
    SELECT to_jsonb(contact.*) INTO v_contact FROM public.relationship_contacts contact
    WHERE contact.id=nullif(v_row->>'contact_id','')::uuid;
    v_text:=concat_ws(' ',v_row::text,v_contact::text);
    v_old_text:=concat_ws(' ',v_old::text,v_contact::text);
  ELSE
    v_text:=v_row::text;
    v_old_text:=v_old::text;
  END IF;

  IF TG_OP IN ('UPDATE','DELETE') AND v_old_property IS NOT NULL THEN
    INSERT INTO public.property_search_documents(
      property_id,source_type,source_key,search_text,updated_at
    ) VALUES (
      v_old_property,'history',gen_random_uuid()::text,
      public.normalize_property_search_text(v_old_text),now()
    );
  END IF;
  IF TG_OP IN ('UPDATE','DELETE') AND v_old_property IS NOT NULL THEN
    DELETE FROM public.property_search_documents
    WHERE property_id=v_old_property AND source_type=v_source_type
      AND source_key=coalesce(v_old->>'id','');
  ELSIF TG_OP IN ('UPDATE','DELETE') AND TG_TABLE_NAME='properties' THEN
    DELETE FROM public.property_search_documents
    WHERE property_id=nullif(v_old->>'id','')::uuid AND source_type='property'
      AND source_key=coalesce(v_old->>'id','');
  END IF;
  IF TG_OP<>'DELETE' AND v_property IS NOT NULL THEN
    INSERT INTO public.property_search_documents(
      property_id,source_type,source_key,search_text,updated_at
    ) VALUES (
      v_property,v_source_type,v_source_key,
      public.normalize_property_search_text(v_text),now()
    ) ON CONFLICT(property_id,source_type,source_key) DO UPDATE SET
      search_text=excluded.search_text,updated_at=excluded.updated_at;
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_contact_property_search_documents()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_link record; v_contact jsonb:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
BEGIN
  FOR v_link IN
    SELECT pc.id,pc.property_id,to_jsonb(pc.*) AS link_json
    FROM public.property_contacts pc
    WHERE pc.contact_id=coalesce(NEW.id,OLD.id)
  LOOP
    IF TG_OP IN ('UPDATE','DELETE') THEN
      INSERT INTO public.property_search_documents(
        property_id,source_type,source_key,search_text,updated_at
      ) VALUES (
        v_link.property_id,'history',gen_random_uuid()::text,
        public.normalize_property_search_text(
          concat_ws(' ',v_link.link_json::text,to_jsonb(OLD)::text)
        ),now()
      );
    END IF;
    INSERT INTO public.property_search_documents(
      property_id,source_type,source_key,search_text,updated_at
    ) VALUES (
      v_link.property_id,'property_contact',v_link.id::text,
      public.normalize_property_search_text(concat_ws(' ',v_link.link_json::text,v_contact::text)),
      now()
    ) ON CONFLICT(property_id,source_type,source_key) DO UPDATE SET
      search_text=excluded.search_text,updated_at=excluded.updated_at;
  END LOOP;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.index_property_history_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.property_search_documents(
    property_id,source_type,source_key,search_text,updated_at
  ) VALUES (
    NEW.property_id,'history',NEW.id::text,
    public.normalize_property_search_text(to_jsonb(NEW)::text),NEW.created_at
  ) ON CONFLICT(property_id,source_type,source_key) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.index_related_property_history_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_property_id uuid; v_source_key text;
BEGIN
  IF TG_TABLE_NAME='permit_case_history' THEN
    SELECT property_id INTO v_property_id FROM public.permit_cases WHERE id=NEW.case_id;
    v_source_key:='case_history:'||NEW.id::text;
  ELSE
    SELECT property_id INTO v_property_id FROM public.projects WHERE id=NEW.project_id;
    v_source_key:='project_audit:'||NEW.id::text;
  END IF;
  IF v_property_id IS NOT NULL THEN
    INSERT INTO public.property_search_documents(
      property_id,source_type,source_key,search_text,updated_at
    ) VALUES (
      v_property_id,'history',v_source_key,
      public.normalize_property_search_text(to_jsonb(NEW)::text),
      coalesce(
        nullif(to_jsonb(NEW)->>'changed_at','')::timestamptz,
        nullif(to_jsonb(NEW)->>'created_at','')::timestamptz,
        now()
      )
    ) ON CONFLICT(property_id,source_type,source_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER properties_refresh_search AFTER INSERT OR UPDATE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.refresh_property_search_document();
CREATE TRIGGER property_urls_refresh_search AFTER INSERT OR UPDATE OR DELETE ON public.property_urls
  FOR EACH ROW EXECUTE FUNCTION public.refresh_property_search_document();
CREATE TRIGGER property_contacts_refresh_search AFTER INSERT OR UPDATE OR DELETE ON public.property_contacts
  FOR EACH ROW EXECUTE FUNCTION public.refresh_property_search_document();
CREATE TRIGGER property_tasks_refresh_search AFTER INSERT OR UPDATE OR DELETE ON public.property_tasks
  FOR EACH ROW EXECUTE FUNCTION public.refresh_property_search_document();
CREATE TRIGGER projects_refresh_property_search AFTER INSERT OR UPDATE OR DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.refresh_property_search_document();
CREATE TRIGGER permit_cases_refresh_property_search AFTER INSERT OR UPDATE OR DELETE ON public.permit_cases
  FOR EACH ROW EXECUTE FUNCTION public.refresh_property_search_document();
CREATE TRIGGER documents_refresh_property_search AFTER INSERT OR UPDATE OR DELETE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.refresh_property_search_document();
CREATE TRIGGER relationship_contacts_refresh_property_search
  AFTER UPDATE OR DELETE ON public.relationship_contacts
  FOR EACH ROW EXECUTE FUNCTION public.refresh_contact_property_search_documents();
CREATE TRIGGER property_activity_index_search AFTER INSERT ON public.property_activity_events
  FOR EACH ROW EXECUTE FUNCTION public.index_property_history_event();
CREATE TRIGGER permit_case_history_index_property_search
  AFTER INSERT ON public.permit_case_history FOR EACH ROW
  EXECUTE FUNCTION public.index_related_property_history_event();
CREATE TRIGGER audit_logs_index_property_search
  AFTER INSERT ON public.audit_logs FOR EACH ROW
  EXECUTE FUNCTION public.index_related_property_history_event();

INSERT INTO public.property_search_documents(property_id,source_type,source_key,search_text,updated_at)
SELECT p.id,'property',p.id::text,public.normalize_property_search_text(to_jsonb(p)::text),p.updated_at
FROM public.properties p;
INSERT INTO public.property_search_documents(property_id,source_type,source_key,search_text,updated_at)
SELECT u.property_id,'property_url',u.id::text,
  public.normalize_property_search_text(to_jsonb(u)::text),u.created_at
FROM public.property_urls u;
INSERT INTO public.property_search_documents(property_id,source_type,source_key,search_text,updated_at)
SELECT pc.property_id,'property_contact',pc.id::text,
  public.normalize_property_search_text(concat_ws(' ',to_jsonb(pc)::text,to_jsonb(rc)::text)),pc.created_at
FROM public.property_contacts pc JOIN public.relationship_contacts rc ON rc.id=pc.contact_id;
INSERT INTO public.property_search_documents(property_id,source_type,source_key,search_text,updated_at)
SELECT task.property_id,'property_task',task.id::text,
  public.normalize_property_search_text(to_jsonb(task)::text),task.updated_at
FROM public.property_tasks task;
INSERT INTO public.property_search_documents(property_id,source_type,source_key,search_text,updated_at)
SELECT p.property_id,'project',p.id::text,
  public.normalize_property_search_text(to_jsonb(p)::text),p.updated_at
FROM public.projects p WHERE p.property_id IS NOT NULL;
INSERT INTO public.property_search_documents(property_id,source_type,source_key,search_text,updated_at)
SELECT c.property_id,'permit_case',c.id::text,
  public.normalize_property_search_text(to_jsonb(c)::text),c.updated_at
FROM public.permit_cases c WHERE c.property_id IS NOT NULL;
INSERT INTO public.property_search_documents(property_id,source_type,source_key,search_text,updated_at)
SELECT d.property_id,'document',d.id::text,
  public.normalize_property_search_text(to_jsonb(d)::text),d.upload_date
FROM public.documents d WHERE d.property_id IS NOT NULL;
INSERT INTO public.property_search_documents(property_id,source_type,source_key,search_text,updated_at)
SELECT event.property_id,'history',event.id::text,
  public.normalize_property_search_text(to_jsonb(event)::text),event.created_at
FROM public.property_activity_events event;
INSERT INTO public.property_search_documents(property_id,source_type,source_key,search_text,updated_at)
SELECT c.property_id,'history','case_history:'||history.id::text,
  public.normalize_property_search_text(to_jsonb(history)::text),history.changed_at
FROM public.permit_case_history history
JOIN public.permit_cases c ON c.id=history.case_id
WHERE c.property_id IS NOT NULL
ON CONFLICT(property_id,source_type,source_key) DO NOTHING;
INSERT INTO public.property_search_documents(property_id,source_type,source_key,search_text,updated_at)
SELECT p.property_id,'history','project_audit:'||audit.id::text,
  public.normalize_property_search_text(to_jsonb(audit)::text),audit.created_at
FROM public.audit_logs audit
JOIN public.projects p ON p.id=audit.project_id
WHERE p.property_id IS NOT NULL
ON CONFLICT(property_id,source_type,source_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS property_activity_keyset_idx
  ON public.property_activity_events(property_id,created_at DESC,id DESC);

CREATE OR REPLACE FUNCTION public.property_query_tokens(p_query text)
RETURNS SETOF text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT token
  FROM (
    SELECT DISTINCT token
    FROM regexp_split_to_table(
      public.normalize_property_search_text(left(coalesce(p_query,''),500)),'\s+'
    ) token
    WHERE token<>''
    ORDER BY token
    LIMIT 20
  ) bounded_tokens;
$$;

CREATE OR REPLACE FUNCTION public.property_search_like_pattern(p_token text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT '%' || replace(replace(replace(
    p_token,E'\\',E'\\\\'
  ),'%',E'\\%'),'_',E'\\_') || '%';
$$;

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
  SELECT property.* FROM public.properties property
  WHERE (
      (p_workspace_id IS NULL AND property.workspace_id IS NULL)
      OR property.workspace_id=p_workspace_id
    )
    AND (p_include_archived OR property.status='active')
    AND (p_query IS NULL OR char_length(p_query)<=500)
    AND (
      p_query IS NULL OR (
        SELECT count(*)<=20
        FROM regexp_split_to_table(
          public.normalize_property_search_text(p_query),'\s+'
        ) token WHERE token<>''
      )
    )
    AND (
      p_municipality IS NULL
      OR property.municipality=public.canonical_property_municipality(p_municipality)
    )
    AND (
      p_project_type IS NULL OR lower(property.project_type)=lower(trim(p_project_type))
      OR EXISTS (
        SELECT 1 FROM public.projects project
        WHERE project.property_id=property.id
          AND lower(project.type::text)=lower(trim(p_project_type))
      )
    )
    AND (p_min_price IS NULL OR property.price>=p_min_price)
    AND (p_max_price IS NULL OR property.price<=p_max_price)
    AND (
      nullif(trim(p_query),'') IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.property_query_tokens(p_query) token
        WHERE NOT EXISTS (
          SELECT 1 FROM public.property_search_documents document
          WHERE document.property_id=property.id
            AND document.search_text LIKE public.property_search_like_pattern(token)
              ESCAPE E'\\'
        )
      )
    )
  ORDER BY property.updated_at DESC,property.id DESC
  LIMIT least(greatest(coalesce(p_limit,50),1),200);
$$;

CREATE OR REPLACE FUNCTION public.property_search_match_scopes(
  p_property_ids uuid[],p_query text
) RETURNS TABLE(property_id uuid,match_scope text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH requested AS (
    SELECT DISTINCT candidate.property_id
    FROM unnest(coalesce(p_property_ids,'{}'::uuid[])) AS candidate(property_id)
    WHERE candidate.property_id IS NOT NULL
    ORDER BY candidate.property_id
    LIMIT 200
  ), scopes AS (
    SELECT requested.property_id,
      NOT EXISTS (
        SELECT 1 FROM public.property_query_tokens(p_query) token
        WHERE NOT EXISTS (
          SELECT 1 FROM public.property_search_documents document
          WHERE document.property_id=requested.property_id
            AND document.source_type<>'history'
            AND document.search_text LIKE public.property_search_like_pattern(token)
              ESCAPE E'\\'
        )
      ) AS current_match,
      NOT EXISTS (
        SELECT 1 FROM public.property_query_tokens(p_query) token
        WHERE NOT EXISTS (
          SELECT 1 FROM public.property_search_documents document
          WHERE document.property_id=requested.property_id
            AND document.source_type='history'
            AND document.search_text LIKE public.property_search_like_pattern(token)
              ESCAPE E'\\'
        )
      ) AS history_match
    FROM requested
    WHERE nullif(trim(p_query),'') IS NOT NULL
      AND char_length(p_query)<=500
      AND (
        SELECT count(*)<=20
        FROM regexp_split_to_table(
          public.normalize_property_search_text(p_query),'\s+'
        ) token WHERE token<>''
      )
      AND public.property_access(requested.property_id)
  )
  SELECT scopes.property_id,CASE
    WHEN scopes.current_match AND scopes.history_match THEN 'current_and_historical'
    WHEN scopes.history_match THEN 'historical'
    WHEN scopes.current_match THEN 'current'
  END
  FROM scopes
  WHERE scopes.current_match OR scopes.history_match;
$$;

CREATE OR REPLACE FUNCTION public.list_property_activity(
  p_property_id uuid,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50
) RETURNS TABLE(
  id uuid,property_id uuid,actor_id uuid,event_type text,entity_type text,
  entity_id uuid,before_state jsonb,after_state jsonb,reason text,metadata jsonb,
  created_at timestamptz,total_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT event.id,event.property_id,event.actor_id,event.event_type,event.entity_type,
    event.entity_id,event.before_state,event.after_state,event.reason,event.metadata,
    event.created_at,
    (SELECT count(*) FROM public.property_activity_events all_events
      WHERE all_events.property_id=p_property_id) AS total_count
  FROM public.property_activity_events event
  WHERE event.property_id=p_property_id
    AND (
      (p_before_created_at IS NULL AND p_before_id IS NULL)
      OR (
        p_before_created_at IS NOT NULL AND p_before_id IS NOT NULL
        AND (event.created_at,event.id)<(p_before_created_at,p_before_id)
      )
    )
  ORDER BY event.created_at DESC,event.id DESC
  LIMIT least(greatest(coalesce(p_limit,50),1),100)+1;
$$;

REVOKE ALL ON FUNCTION public.search_properties(
  uuid,text,text,text,numeric,numeric,boolean,integer
),public.property_search_match_scopes(uuid[],text),
  public.list_property_activity(uuid,timestamptz,uuid,integer)
FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.search_properties(
  uuid,text,text,text,numeric,numeric,boolean,integer
),public.property_search_match_scopes(uuid[],text),
  public.list_property_activity(uuid,timestamptz,uuid,integer)
TO authenticated;
