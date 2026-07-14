-- Transactional Permit catalogue generation.
--
-- Catalogue rows are review candidates, never applicability conclusions. One
-- parent-scoped lock covers deterministic rule selection, Permit insertion,
-- paperwork insertion, audit triggers, and the response. Retries therefore
-- either observe the complete prior transaction or create the complete graph.

ALTER TABLE public.project_permits
  ADD COLUMN IF NOT EXISTS catalogue_rule_version text,
  ADD COLUMN IF NOT EXISTS catalogue_rule_snapshot jsonb;
ALTER TABLE public.project_permits
  DROP CONSTRAINT IF EXISTS project_permits_catalogue_snapshot_object;
ALTER TABLE public.project_permits
  ADD CONSTRAINT project_permits_catalogue_snapshot_object CHECK (
    catalogue_rule_snapshot IS NULL
    OR jsonb_typeof(catalogue_rule_snapshot) = 'object'
  );

-- Legacy duplicates remain immutable evidence. New transactional candidates
-- carry a snapshot, so these partial indexes can enforce retry identity without
-- deleting or rewriting any pre-existing record.
CREATE UNIQUE INDEX project_permits_case_catalogue_rule_unique
  ON public.project_permits(case_id,permit_rule_id)
  WHERE case_id IS NOT NULL
    AND permit_rule_id IS NOT NULL
    AND catalogue_rule_snapshot IS NOT NULL;
CREATE UNIQUE INDEX project_permits_project_catalogue_rule_unique
  ON public.project_permits(project_id,permit_rule_id)
  WHERE case_id IS NULL
    AND project_id IS NOT NULL
    AND permit_rule_id IS NOT NULL
    AND catalogue_rule_snapshot IS NOT NULL;

CREATE OR REPLACE FUNCTION public.permit_catalogue_municipality_approved(
  p_municipality text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path=public
AS $$
  SELECT public.canonical_property_municipality(p_municipality) = ANY (ARRAY[
    'Village of Anmore',
    'Village of Belcarra',
    'Bowen Island Municipality',
    'City of Burnaby',
    'City of Coquitlam',
    'City of Delta',
    'City of Langley',
    'Township of Langley',
    'Village of Lions Bay',
    'City of Maple Ridge',
    'City of New Westminster',
    'City of North Vancouver',
    'District of North Vancouver',
    'City of Pitt Meadows',
    'City of Port Coquitlam',
    'City of Port Moody',
    'City of Richmond',
    'City of Surrey',
    'City of Vancouver',
    'District of West Vancouver',
    'City of White Rock',
    'City of Kelowna'
  ]::text[]);
$$;

-- Scope signals only change review order and wording. They never set
-- applicability_status or is_required. Matches are deliberately limited to
-- exact recorded work types and exact, enumerated work-category labels.
CREATE OR REPLACE FUNCTION public.permit_catalogue_scope_signalled(
  p_permit_type text,
  p_work_type text,
  p_work_categories text[]
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path=public
AS $$
  WITH input AS (
    SELECT
      lower(trim(coalesce(p_permit_type,''))) AS permit_type,
      lower(trim(coalesce(p_work_type,''))) AS work_type
  ), category_keys AS (
    SELECT trim(both '_' FROM regexp_replace(
      lower(trim(category)), '[^[:alnum:]]+', '_', 'g'
    )) AS category_key
    FROM unnest(coalesce(p_work_categories,'{}'::text[])) category
  ), signalled_types AS (
    SELECT CASE work_type
      WHEN 'new_construction' THEN 'building'
      WHEN 'renovation' THEN 'building'
      WHEN 'addition' THEN 'building'
      WHEN 'accessory_secondary_dwelling' THEN 'building'
      WHEN 'industrial_alteration' THEN 'building'
      WHEN 'tenant_improvement' THEN 'tenant_improvement'
      WHEN 'demolition' THEN 'demolition'
      WHEN 'change_of_use' THEN 'occupancy_change_of_use'
      WHEN 'site_servicing' THEN 'excavation_shoring_servicing'
      ELSE NULL
    END AS permit_type
    FROM input
    UNION ALL
    SELECT CASE category_key
      WHEN 'structural_work' THEN 'building'
      WHEN 'plumbing' THEN 'plumbing'
      WHEN 'electrical' THEN 'electrical'
      WHEN 'mechanical_hvac' THEN 'mechanical_hvac'
      WHEN 'fire_life_safety' THEN 'fire_life_safety'
      WHEN 'excavation_or_shoring' THEN 'excavation_shoring_servicing'
      WHEN 'tree_removal' THEN 'tree'
      WHEN 'heritage_property' THEN 'heritage'
      WHEN 'environmental_work' THEN 'environmental_site'
      WHEN 'change_of_occupancy_or_use' THEN 'occupancy_change_of_use'
      WHEN 'site_servicing' THEN 'excavation_shoring_servicing'
      ELSE category_key
    END
    FROM category_keys
  )
  SELECT EXISTS (
    SELECT 1 FROM signalled_types signal,input
    WHERE signal.permit_type IS NOT NULL
      AND signal.permit_type=input.permit_type
  );
$$;

-- Every insert that claims a catalogue rule participates in the same parent
-- lock, including legacy/manual callers. This closes the race between a direct
-- insert and the governed RPC. Existing evidence is not deduplicated or moved.
CREATE OR REPLACE FUNCTION public.lock_project_permit_catalogue_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
BEGIN
  IF NEW.permit_rule_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.case_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'agir:permit-catalogue:case:' || NEW.case_id::text, 0
    ));
    IF EXISTS (
      SELECT 1 FROM public.project_permits existing
      WHERE existing.case_id=NEW.case_id
        AND existing.permit_rule_id=NEW.permit_rule_id
        AND existing.id IS DISTINCT FROM NEW.id
    ) THEN
      RAISE EXCEPTION 'This catalogue rule already exists for the Permit case'
        USING ERRCODE='23505';
    END IF;
  ELSIF NEW.project_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'agir:permit-catalogue:project:' || NEW.project_id::text, 0
    ));
    IF EXISTS (
      SELECT 1 FROM public.project_permits existing
      WHERE existing.case_id IS NULL
        AND existing.project_id=NEW.project_id
        AND existing.permit_rule_id=NEW.permit_rule_id
        AND existing.id IS DISTINCT FROM NEW.id
    ) THEN
      RAISE EXCEPTION 'This catalogue rule already exists for the project'
        USING ERRCODE='23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS project_permits_lock_catalogue_identity
  ON public.project_permits;
CREATE TRIGGER project_permits_lock_catalogue_identity
  BEFORE INSERT ON public.project_permits
  FOR EACH ROW EXECUTE FUNCTION public.lock_project_permit_catalogue_identity();

-- Catalogue linkage and snapshots are evidence identity. Ordinary callers
-- cannot forge or rewrite them. A trusted rule deletion may clear only the FK;
-- the immutable snapshot and version remain available to reviewers.
CREATE OR REPLACE FUNCTION public.protect_project_permit_catalogue_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public
AS $$
DECLARE
  v_trusted_rule_retirement boolean:=auth.uid() IS NULL
    AND OLD.permit_rule_id IS NOT NULL AND NEW.permit_rule_id IS NULL
    AND NEW.catalogue_rule_version IS NOT DISTINCT FROM OLD.catalogue_rule_version
    AND NEW.catalogue_rule_snapshot IS NOT DISTINCT FROM OLD.catalogue_rule_snapshot;
BEGIN
  IF TG_OP='INSERT'
     AND (
       NEW.catalogue_rule_version IS NOT NULL
       OR NEW.catalogue_rule_snapshot IS NOT NULL
     )
     AND current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Catalogue evidence can only be created by the governed generator';
  END IF;
  IF TG_OP='UPDATE' AND (
    NEW.catalogue_rule_version IS DISTINCT FROM OLD.catalogue_rule_version
    OR NEW.catalogue_rule_snapshot IS DISTINCT FROM OLD.catalogue_rule_snapshot
    OR (
      NEW.permit_rule_id IS DISTINCT FROM OLD.permit_rule_id
      AND NOT v_trusted_rule_retirement
    )
  ) THEN
    RAISE EXCEPTION 'Catalogue evidence identity cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS project_permits_protect_catalogue_evidence
  ON public.project_permits;
CREATE TRIGGER project_permits_protect_catalogue_evidence
  BEFORE INSERT OR UPDATE OF permit_rule_id,catalogue_rule_version,catalogue_rule_snapshot
  ON public.project_permits
  FOR EACH ROW EXECUTE FUNCTION public.protect_project_permit_catalogue_evidence();

CREATE OR REPLACE FUNCTION public.generate_permit_catalogue_candidates(
  p_parent_kind text,
  p_parent_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_catalog
AS $$
DECLARE
  v_actor uuid:=auth.uid();
  v_parent_kind text:=lower(trim(coalesce(p_parent_kind,'')));
  v_case_id uuid;
  v_project_id uuid;
  v_linked_case_id uuid;
  v_owner_id uuid;
  v_workspace_id uuid;
  v_property_id uuid;
  v_municipality text;
  v_project_municipality text;
  v_municipality_confirmed boolean:=false;
  v_archived_at timestamptz;
  v_work_type text;
  v_work_categories text[]:='{}'::text[];
  v_role public.workspace_role;
  v_jurisdiction_id uuid;
  v_jurisdiction_name text;
  v_created integer:=0;
  v_paperwork_created integer:=0;
  v_scope_signalled integer:=0;
  v_candidate_ids jsonb:='[]'::jsonb;
  v_project_workspace uuid;
  v_project_owner uuid;
  v_project_property uuid;
BEGIN
  IF v_actor IS NULL OR NOT public.permit_pilot_access() THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF p_parent_id IS NULL OR v_parent_kind NOT IN ('permit_case','project') THEN
    RAISE EXCEPTION 'A Permit case or project parent is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'agir:permit-catalogue:' ||
      CASE WHEN v_parent_kind='permit_case' THEN 'case' ELSE 'project' END ||
      ':' || p_parent_id::text,
    0
  ));

  IF v_parent_kind='permit_case' THEN
    SELECT
      permit_case.id,permit_case.project_id,permit_case.owner_id,
      permit_case.workspace_id,permit_case.property_id,permit_case.municipality,
      permit_case.municipality_confirmed,permit_case.archived_at,
      permit_case.work_type,permit_case.work_categories
    INTO
      v_case_id,v_project_id,v_owner_id,v_workspace_id,v_property_id,
      v_municipality,v_municipality_confirmed,v_archived_at,
      v_work_type,v_work_categories
    FROM public.permit_cases permit_case
    WHERE permit_case.id=p_parent_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Permit case write access is required'; END IF;
    IF v_workspace_id IS NULL THEN
      IF v_owner_id IS DISTINCT FROM v_actor THEN
        RAISE EXCEPTION 'Permit case write access is required';
      END IF;
    ELSE
      SELECT member.role INTO v_role
      FROM public.workspace_members member
      WHERE member.workspace_id=v_workspace_id AND member.user_id=v_actor
      FOR SHARE;
      IF v_role IS NULL OR v_role NOT IN ('owner','admin','member') THEN
        RAISE EXCEPTION 'Permit case write access is required';
      END IF;
    END IF;
    IF v_archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'Archived Permit cases are read-only';
    END IF;
    IF NOT v_municipality_confirmed THEN
      RAISE EXCEPTION 'Confirm the municipality before generating Permit candidates';
    END IF;

    IF v_project_id IS NOT NULL THEN
      SELECT project.workspace_id,project.owner_id,project.property_id,project.municipality
      INTO v_project_workspace,v_project_owner,v_project_property,v_project_municipality
      FROM public.projects project WHERE project.id=v_project_id FOR SHARE;
      IF NOT FOUND
        OR v_project_workspace IS DISTINCT FROM v_workspace_id
        OR (v_workspace_id IS NULL AND v_project_owner IS DISTINCT FROM v_owner_id)
        OR v_project_property IS DISTINCT FROM v_property_id
      THEN
        RAISE EXCEPTION 'Linked project and Permit case require parent reconciliation';
      END IF;
    END IF;
  ELSE
    SELECT
      project.id,project.owner_id,project.workspace_id,project.property_id,
      project.municipality,project.permit_project_type,project.work_categories
    INTO
      v_project_id,v_owner_id,v_workspace_id,v_property_id,
      v_municipality,v_work_type,v_work_categories
    FROM public.projects project
    WHERE project.id=p_parent_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Project write access is required'; END IF;
    IF v_workspace_id IS NULL THEN
      IF v_owner_id IS DISTINCT FROM v_actor THEN
        RAISE EXCEPTION 'Project write access is required';
      END IF;
    ELSE
      SELECT member.role INTO v_role
      FROM public.workspace_members member
      WHERE member.workspace_id=v_workspace_id AND member.user_id=v_actor
      FOR SHARE;
      IF v_role IS NULL OR v_role NOT IN ('owner','admin','member') THEN
        RAISE EXCEPTION 'Project write access is required';
      END IF;
    END IF;
    SELECT permit_case.id INTO v_linked_case_id
    FROM public.permit_cases permit_case
    WHERE permit_case.project_id=v_project_id
    LIMIT 1;
    IF v_linked_case_id IS NOT NULL THEN
      RAISE EXCEPTION
        'This project has a linked Permit case; generate candidates from the linked case';
    END IF;
  END IF;

  v_municipality:=public.canonical_property_municipality(v_municipality);
  IF NOT coalesce(public.permit_catalogue_municipality_approved(v_municipality),false) THEN
    RAISE EXCEPTION 'The confirmed municipality is not in the approved research catalogue';
  END IF;
  IF v_project_municipality IS NOT NULL
     AND public.canonical_property_municipality(v_project_municipality)
       IS DISTINCT FROM v_municipality THEN
    RAISE EXCEPTION 'Linked project and Permit case municipalities require reconciliation';
  END IF;

  SELECT jurisdiction.id,jurisdiction.name
  INTO v_jurisdiction_id,v_jurisdiction_name
  FROM public.jurisdictions jurisdiction
  WHERE jurisdiction.name=v_municipality
    AND jurisdiction.province='British Columbia'
    AND jurisdiction.jurisdiction_type='municipality'
    AND jurisdiction.active
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The confirmed municipality is not in the approved research catalogue';
  END IF;

  WITH ranked_rules AS MATERIALIZED (
    SELECT
      rule.*,
      to_jsonb(rule) AS rule_snapshot,
      public.permit_catalogue_scope_signalled(
        rule.permit_type,v_work_type,v_work_categories
      ) AS scope_signalled,
      row_number() OVER (
        PARTITION BY rule.permit_type
        ORDER BY
          CASE rule.verification_status
            WHEN 'verified' THEN 4
            WHEN 'potentially_applicable' THEN 3
            WHEN 'needs_review' THEN 2
            ELSE 1
          END DESC,
          rule.review_date DESC NULLS LAST,
          rule.effective_date DESC NULLS LAST,
          rule.rule_version DESC,
          rule.id ASC
      ) AS selection_position
    FROM public.permit_rules rule
    WHERE rule.jurisdiction_id=v_jurisdiction_id
      AND rule.superseded_at IS NULL
      AND rule.authority_scope='municipal'
  ), selected_rules AS MATERIALIZED (
    SELECT * FROM ranked_rules WHERE selection_position=1
  ), inserted_permits AS (
    INSERT INTO public.project_permits(
      case_id,project_id,owner_id,jurisdiction_id,permit_rule_id,
      name,permit_type,description,applicability_status,workflow_status,
      is_required,processing_duration_text,processing_duration_days,
      duration_source,application_url,source_location,source_text,source_kind,
      source_url,source_reviewed_at,source_freshness_status,
      source_official_status,confidence_band,notes,
      catalogue_rule_version,catalogue_rule_snapshot
    )
    SELECT
      v_case_id,v_project_id,v_actor,v_jurisdiction_id,rule.id,
      rule.name,rule.permit_type,rule.description,'unknown','not_started',
      NULL,rule.published_duration_text,rule.published_duration_days,
      CASE
        WHEN rule.published_duration_text IS NOT NULL
          OR rule.published_duration_days IS NOT NULL
        THEN coalesce(
          CASE WHEN rule.official_source_url ~* '^https?://'
            THEN rule.official_source_url END,
          'Catalogue rule ' || rule.id::text
        )
        ELSE NULL
      END,
      CASE WHEN rule.application_url ~* '^https?://' THEN rule.application_url
        WHEN rule.official_source_url ~* '^https?://' THEN rule.official_source_url END,
      rule.source_title,rule.source_text,
      CASE WHEN rule.verification_status='verified'
        THEN 'verified_source' ELSE 'needs_review' END,
      CASE WHEN rule.official_source_url ~* '^https?://' THEN rule.official_source_url END,
      CASE WHEN rule.review_date IS NOT NULL
        THEN rule.review_date::timestamp AT TIME ZONE 'UTC' END,
      rule.freshness_status,rule.official_source_status,
      CASE WHEN rule.scope_signalled THEN 'scope_signalled'
        ELSE 'catalogue_only_scope_unconfirmed' END,
      CASE WHEN rule.scope_signalled THEN
        'The recorded work mentions this category. Review the current source before deciding whether this approval applies.'
      ELSE
        'Catalogue result only. Review the work and current source before deciding whether this approval applies.'
      END,
      rule.rule_version,rule.rule_snapshot
    FROM selected_rules rule
    WHERE NOT EXISTS (
      SELECT 1 FROM public.project_permits existing
      WHERE existing.permit_rule_id=rule.id
        AND (
          (v_case_id IS NOT NULL AND existing.case_id=v_case_id)
          OR (
            v_case_id IS NULL AND existing.case_id IS NULL
            AND existing.project_id=v_project_id
          )
        )
    )
    ORDER BY rule.scope_signalled DESC,rule.permit_type,rule.id
    ON CONFLICT DO NOTHING
    RETURNING id,permit_rule_id,permit_type,confidence_band
  ), required_rows AS MATERIALIZED (
    SELECT
      inserted.id AS project_permit_id,
      rule.id AS permit_rule_id,
      trim(document_entry.value #>> '{}') AS name,
      document_entry.ordinality,
      row_number() OVER (
        PARTITION BY inserted.id,lower(trim(document_entry.value #>> '{}'))
        ORDER BY document_entry.ordinality
      ) AS duplicate_position,
      rule.verification_status,rule.official_source_url,rule.source_text
    FROM inserted_permits inserted
    JOIN selected_rules rule ON rule.id=inserted.permit_rule_id
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(rule.required_documents)='array'
        THEN rule.required_documents ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS document_entry(value,ordinality)
    WHERE jsonb_typeof(document_entry.value)='string'
      AND length(trim(document_entry.value #>> '{}'))>0
  ), inserted_requirements AS (
    INSERT INTO public.permit_requirements(
      project_permit_id,name,requirement_type,status,is_required,
      applicability_state,source_kind,source_url,source_text,notes
    )
    SELECT
      required.project_permit_id,required.name,'paperwork','missing',NULL,
      'unresolved',
      CASE WHEN required.verification_status='verified'
        THEN 'verified_source' ELSE 'needs_review' END,
      CASE WHEN required.official_source_url ~* '^https?://'
        THEN required.official_source_url END,
      required.source_text,
      'Possible paperwork if this approval applies. Confirm before relying on it.'
    FROM required_rows required
    WHERE required.duplicate_position=1
    RETURNING id
  )
  SELECT
    (SELECT count(*)::integer FROM inserted_permits),
    (SELECT count(*)::integer FROM inserted_requirements),
    (SELECT count(*)::integer FROM inserted_permits
      WHERE confidence_band='scope_signalled'),
    (SELECT coalesce(jsonb_agg(
        id ORDER BY (confidence_band='scope_signalled') DESC,permit_type,id
      ),'[]'::jsonb)
     FROM inserted_permits)
  INTO v_created,v_paperwork_created,v_scope_signalled,v_candidate_ids
  ;

  RETURN jsonb_build_object(
    'created',coalesce(v_created,0),
    'jurisdiction',v_jurisdiction_name,
    'paperworkCreated',coalesce(v_paperwork_created,0),
    'scopeSignalled',coalesce(v_scope_signalled,0),
    'candidateIds',coalesce(v_candidate_ids,'[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.permit_catalogue_municipality_approved(text),
  public.permit_catalogue_scope_signalled(text,text,text[]),
  public.lock_project_permit_catalogue_identity(),
  public.protect_project_permit_catalogue_evidence(),
  public.generate_permit_catalogue_candidates(text,uuid)
FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.permit_catalogue_municipality_approved(text),
  public.permit_catalogue_scope_signalled(text,text,text[]),
  public.generate_permit_catalogue_candidates(text,uuid)
TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lock_project_permit_catalogue_identity(),
  public.protect_project_permit_catalogue_evidence()
TO service_role;
