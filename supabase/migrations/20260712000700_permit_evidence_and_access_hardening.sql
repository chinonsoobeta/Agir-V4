-- Permit evidence and access hardening.
--
-- This migration keeps document research off production request threads,
-- makes reviewer decisions atomic, preserves source evidence, and separates
-- read-only viewer policies from contributor mutations.

-- Catalogue paperwork is only a possibility until the parent permit is
-- confirmed. Older defaults marked every inserted row required even when
-- applicability was unresolved; remove that implicit conclusion.
ALTER TABLE public.permit_requirements ALTER COLUMN is_required DROP DEFAULT;
ALTER TABLE public.permit_requirements ALTER COLUMN is_required DROP NOT NULL;
UPDATE public.permit_requirements r
SET is_required = NULL,
    applicability_state = 'unresolved'
FROM public.project_permits p
WHERE p.id = r.project_permit_id
  AND r.is_required = true
  AND p.applicability_status <> 'required';
UPDATE public.permit_requirements r
SET applicability_state = 'required'
FROM public.project_permits p
WHERE p.id = r.project_permit_id
  AND r.is_required = true
  AND p.applicability_status = 'required';
ALTER TABLE public.permit_requirements
  DROP CONSTRAINT IF EXISTS permit_requirements_required_state_consistency;
ALTER TABLE public.permit_requirements
  ADD CONSTRAINT permit_requirements_required_state_consistency CHECK (
    is_required IS DISTINCT FROM true OR applicability_state = 'required'
  );

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS address_region text,
  ADD COLUMN IF NOT EXISTS postal_code text;
ALTER TABLE public.permit_cases
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason text;
ALTER TABLE public.permit_cases
  ADD CONSTRAINT permit_cases_archive_state_check CHECK (
    (archived_at IS NULL AND archive_reason IS NULL)
    OR (archived_at IS NOT NULL AND length(trim(archive_reason)) > 0)
  );
-- Older permissive owner policies bypassed the archived-aware write helper.
-- Keep the read policy, but route every update through permit_cases_update.
DROP POLICY IF EXISTS permit_cases_personal_update ON public.permit_cases;
DROP POLICY IF EXISTS permit_cases_personal_delete ON public.permit_cases;
REVOKE DELETE ON public.permit_cases FROM authenticated;
REVOKE INSERT ON public.permit_cases FROM authenticated;
GRANT INSERT (
  owner_id, workspace_id, project_id, property_id, name, property_address,
  address_line_2, building_name, address_provider, address_place_id, latitude,
  longitude, municipality, municipality_confirmed, province, postal_code,
  property_type, work_type, project_context, work_categories, description,
  existing_use, proposed_use, known_conditions, notes, zoning_designation,
  zoning_source, zoning_verified_at, zoning_source_kind, target_date, issue_date,
  expiration_date
) ON public.permit_cases TO authenticated;
REVOKE UPDATE ON public.permit_cases FROM authenticated;
GRANT UPDATE (
  name, property_address, address_line_2, building_name, address_provider,
  address_place_id, latitude, longitude, municipality,
  municipality_confirmed, province, postal_code, property_type, work_type,
  project_context, work_categories, description, existing_use, proposed_use,
  known_conditions, notes, zoning_designation, zoning_source,
  zoning_verified_at, zoning_source_kind, target_date, issue_date,
  expiration_date
) ON public.permit_cases TO authenticated;

CREATE OR REPLACE FUNCTION public.permit_case_write_access(p_case_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.permit_pilot_access() AND EXISTS (
    SELECT 1 FROM public.permit_cases c
    WHERE c.id=p_case_id AND c.archived_at IS NULL
      AND (
        (c.workspace_id IS NULL AND c.owner_id=auth.uid())
        OR public.workspace_role(c.workspace_id) IN ('owner','admin','member')
      )
  )
$$;
REVOKE ALL ON FUNCTION public.permit_case_write_access(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.permit_case_write_access(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.set_permit_case_archived(
  p_case_id uuid,
  p_archived boolean,
  p_reason text
) RETURNS public.permit_cases
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_before public.permit_cases%ROWTYPE;
  v_after public.permit_cases%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication is required'; END IF;
  IF length(trim(coalesce(p_reason,''))) = 0
    THEN RAISE EXCEPTION 'A case archive reason is required'; END IF;
  SELECT * INTO v_before FROM public.permit_cases WHERE id=p_case_id FOR UPDATE;
  IF NOT FOUND OR NOT (
    (v_before.workspace_id IS NULL AND v_before.owner_id=v_actor)
    OR public.workspace_role(v_before.workspace_id) IN ('owner','admin','member')
  ) THEN RAISE EXCEPTION 'Permit case write access is required'; END IF;
  IF (p_archived AND v_before.archived_at IS NOT NULL)
     OR (NOT p_archived AND v_before.archived_at IS NULL)
    THEN RETURN v_before; END IF;

  UPDATE public.permit_cases
  SET archived_at=CASE WHEN p_archived THEN now() ELSE NULL END,
      archived_by=CASE WHEN p_archived THEN v_actor ELSE NULL END,
      archive_reason=CASE WHEN p_archived THEN left(trim(p_reason),1000) ELSE NULL END,
      updated_at=now()
  WHERE id=p_case_id RETURNING * INTO v_after;
  INSERT INTO public.permit_case_history(
    case_id,action,previous_data,new_data,reason,changed_by
  ) VALUES (
    p_case_id,
    CASE WHEN p_archived THEN 'case_archived' ELSE 'case_restored' END,
    jsonb_build_object(
      'archived_at',v_before.archived_at,
      'archived_by',v_before.archived_by,
      'archive_reason',v_before.archive_reason
    ),
    jsonb_build_object(
      'archived_at',v_after.archived_at,
      'archived_by',v_after.archived_by,
      'archive_reason',v_after.archive_reason
    ),
    left(trim(p_reason),1000),v_actor
  );
  RETURN v_after;
END;
$$;
REVOKE ALL ON FUNCTION public.set_permit_case_archived(uuid,boolean,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_permit_case_archived(uuid,boolean,text)
  TO authenticated;

-- A viewer can inspect collaboration history but cannot own executable work.
DROP POLICY IF EXISTS permit_case_assignments_write ON public.permit_case_assignments;
CREATE POLICY permit_case_assignments_write ON public.permit_case_assignments
  FOR ALL TO authenticated
  USING (public.permit_case_write_access(case_id))
  WITH CHECK (
    assigned_by=auth.uid() AND public.permit_case_write_access(case_id) AND
    EXISTS (
      SELECT 1 FROM public.permit_cases c
      WHERE c.id=case_id AND (
        (c.workspace_id IS NULL AND c.owner_id=assignee_id AND assignee_id=auth.uid())
        OR (c.workspace_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.workspace_members m
          WHERE m.workspace_id=c.workspace_id AND m.user_id=assignee_id
            AND m.role IN ('owner','admin','member')
        ))
      )
    )
  );
DROP POLICY IF EXISTS permit_case_handoffs_insert ON public.permit_case_handoffs;
CREATE POLICY permit_case_handoffs_insert ON public.permit_case_handoffs
  FOR INSERT TO authenticated
  WITH CHECK (
    initiated_by=auth.uid() AND from_user_id=auth.uid()
    AND public.permit_case_write_access(case_id)
    AND EXISTS (
      SELECT 1 FROM public.permit_cases c
      WHERE c.id=case_id AND c.workspace_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.workspace_members m
        WHERE m.workspace_id=c.workspace_id AND m.user_id=to_user_id
          AND m.role IN ('owner','admin','member')
      )
    )
  );

CREATE OR REPLACE FUNCTION public.respond_permit_case_handoff(
  p_handoff_id uuid,
  p_status text
) RETURNS public.permit_case_handoffs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_user uuid:=auth.uid();
  v_row public.permit_case_handoffs%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication is required'; END IF;
  IF p_status NOT IN ('accepted','rejected')
    THEN RAISE EXCEPTION 'invalid handoff response'; END IF;
  SELECT * INTO v_row FROM public.permit_case_handoffs
  WHERE id=p_handoff_id AND to_user_id=v_user AND status='pending'
  FOR UPDATE;
  IF NOT FOUND OR NOT public.permit_case_access(v_row.case_id)
    THEN RAISE EXCEPTION 'handoff not found or response not allowed'; END IF;
  IF p_status='accepted' AND NOT public.permit_case_write_access(v_row.case_id)
    THEN RAISE EXCEPTION 'Permit case write access is required to accept a handoff'; END IF;
  UPDATE public.permit_case_handoffs
  SET status=p_status,responded_at=now()
  WHERE id=v_row.id RETURNING * INTO v_row;
  IF p_status='accepted' THEN
    INSERT INTO public.permit_case_assignments(
      case_id,assignee_id,assigned_by,responsibility,status
    ) VALUES (
      v_row.case_id,v_row.to_user_id,v_user,'Permit case responsibility','active'
    )
    ON CONFLICT(case_id,assignee_id,responsibility) DO UPDATE SET
      assigned_by=excluded.assigned_by,status='active',updated_at=now();
  END IF;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.respond_permit_case_handoff(uuid,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.respond_permit_case_handoff(uuid,text)
  TO authenticated;

-- The legacy permit_project_access helper intentionally means contributor
-- access. Keep that contract for writes and introduce an explicit read helper
-- so workspace viewers can inspect evidence without being able to mutate it.
CREATE OR REPLACE FUNCTION public.permit_project_read_access(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.permit_pilot_access() AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_project_id
      AND (
        (p.workspace_id IS NULL AND p.owner_id = auth.uid())
        OR public.workspace_role(p.workspace_id) IN ('owner','admin','member','viewer')
      )
  )
$$;
REVOKE ALL ON FUNCTION public.permit_project_read_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.permit_project_read_access(uuid) TO authenticated;

ALTER TABLE public.extraction_jobs
  DROP CONSTRAINT IF EXISTS extraction_jobs_kind_check;
ALTER TABLE public.extraction_jobs
  ADD CONSTRAINT extraction_jobs_kind_check CHECK (
    kind IN (
      'document_verification', 'document_analysis', 'assumption_extraction',
      'underwriting', 'permit_case_research', 'permit_project_research'
    )
  ),
  ADD CONSTRAINT extraction_jobs_document_scope_check CHECK (
    kind NOT IN ('document_analysis','permit_case_research','permit_project_research')
    OR document_id IS NOT NULL
  );

-- Bind every document job to the document's authoritative tenant scope before
-- RLS runs. Client-supplied parent ids are never trusted and job identity cannot
-- be swapped after insertion.
CREATE OR REPLACE FUNCTION public.bind_extraction_job_to_permit_case()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_document public.documents%ROWTYPE;
  v_actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
      OR NEW.kind IS DISTINCT FROM OLD.kind
      OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
      OR NEW.document_id IS DISTINCT FROM OLD.document_id
      OR NEW.project_id IS DISTINCT FROM OLD.project_id
      OR NEW.permit_case_id IS DISTINCT FROM OLD.permit_case_id
    THEN RAISE EXCEPTION 'Extraction job identity and scope cannot be changed'; END IF;
    RETURN NEW;
  END IF;

  IF NEW.document_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_document FROM public.documents WHERE id = NEW.document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document job source is unavailable'; END IF;
  IF NEW.project_id IS NOT NULL AND NEW.project_id IS DISTINCT FROM v_document.project_id
    THEN RAISE EXCEPTION 'Document job project does not match its source'; END IF;
  IF NEW.permit_case_id IS NOT NULL
     AND NEW.permit_case_id IS DISTINCT FROM v_document.permit_case_id
    THEN RAISE EXCEPTION 'Document job Permit case does not match its source'; END IF;
  NEW.project_id := v_document.project_id;
  NEW.permit_case_id := v_document.permit_case_id;

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
DROP TRIGGER IF EXISTS extraction_jobs_bind_permit_case ON public.extraction_jobs;
CREATE TRIGGER extraction_jobs_bind_permit_case
  BEFORE INSERT OR UPDATE ON public.extraction_jobs
  FOR EACH ROW EXECUTE FUNCTION public.bind_extraction_job_to_permit_case();

ALTER TABLE public.permit_extraction_candidates
  DROP CONSTRAINT IF EXISTS permit_extraction_candidate_parent;
ALTER TABLE public.permit_extraction_candidates
  ADD CONSTRAINT permit_extraction_candidate_parent CHECK (
    (project_id IS NOT NULL)::integer + (permit_case_id IS NOT NULL)::integer = 1
  );

-- Reconcile legacy case pointers to the case's authoritative project link
-- before enforcing the invariant. Documents follow the same case link. A
-- mismatched evidence bridge is ambiguous, so fail closed instead of silently
-- deleting or moving it.
UPDATE public.project_permits p
SET project_id = c.project_id
FROM public.permit_cases c
WHERE p.case_id = c.id AND p.project_id IS DISTINCT FROM c.project_id;
UPDATE public.documents d
SET project_id = c.project_id
FROM public.permit_cases c
WHERE d.permit_case_id = c.id AND d.project_id IS DISTINCT FROM c.project_id;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.permit_documents link
    JOIN public.project_permits p ON p.id = link.permit_id
    JOIN public.documents d ON d.id = link.document_id
    WHERE NOT (
      coalesce(p.case_id IS NOT NULL AND d.permit_case_id = p.case_id,false)
      OR coalesce(p.project_id IS NOT NULL AND d.project_id = p.project_id,false)
    )
  ) THEN
    RAISE EXCEPTION
      'Permit evidence links cross a parent boundary; resolve them before applying this migration';
  END IF;
END $$;

-- A viewer may read case evidence but never mutate or erase it. Candidate
-- writes are worker-owned; reviewer transitions go through the locked RPC.
DROP POLICY IF EXISTS permit_candidates_all ON public.permit_extraction_candidates;
DROP POLICY IF EXISTS permit_candidates_select ON public.permit_extraction_candidates;
CREATE POLICY permit_candidates_select ON public.permit_extraction_candidates
  FOR SELECT TO authenticated
  USING (
    (permit_case_id IS NOT NULL AND public.permit_case_access(permit_case_id))
    OR (project_id IS NOT NULL AND public.permit_project_read_access(project_id))
  );
REVOKE INSERT, UPDATE, DELETE ON public.permit_extraction_candidates FROM authenticated;
GRANT SELECT ON public.permit_extraction_candidates TO authenticated;

-- Split the entire case-scoped Permit graph into read and write policies.
DROP POLICY IF EXISTS project_permits_all ON public.project_permits;
DROP POLICY IF EXISTS project_permits_select ON public.project_permits;
DROP POLICY IF EXISTS project_permits_insert ON public.project_permits;
DROP POLICY IF EXISTS project_permits_update ON public.project_permits;
DROP POLICY IF EXISTS project_permits_delete ON public.project_permits;
CREATE POLICY project_permits_select ON public.project_permits FOR SELECT TO authenticated
  USING (
    CASE WHEN case_id IS NOT NULL THEN public.permit_case_access(case_id)
         ELSE public.permit_project_read_access(project_id) END
  );
CREATE POLICY project_permits_insert ON public.project_permits FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid() AND
    CASE WHEN case_id IS NOT NULL THEN
      public.permit_case_write_access(case_id) AND (
        project_id IS NULL OR EXISTS (
          SELECT 1 FROM public.permit_cases c
          JOIN public.projects pr ON pr.id = project_permits.project_id
          WHERE c.id = project_permits.case_id
            AND pr.id IS NOT DISTINCT FROM c.project_id
            AND public.permit_project_access(pr.id)
        )
      )
         ELSE public.permit_project_access(project_id) END
  );
CREATE POLICY project_permits_update ON public.project_permits FOR UPDATE TO authenticated
  USING (
    CASE WHEN case_id IS NOT NULL THEN public.permit_case_write_access(case_id)
         ELSE public.permit_project_access(project_id) END
  )
  WITH CHECK (
    CASE WHEN case_id IS NOT NULL THEN
      public.permit_case_write_access(case_id) AND (
        project_id IS NULL OR EXISTS (
          SELECT 1 FROM public.permit_cases c
          JOIN public.projects pr ON pr.id = project_permits.project_id
          WHERE c.id = project_permits.case_id
            AND pr.id IS NOT DISTINCT FROM c.project_id
            AND public.permit_project_access(pr.id)
        )
      )
         ELSE public.permit_project_access(project_id) END
  );
CREATE POLICY project_permits_delete ON public.project_permits FOR DELETE TO authenticated
  USING (
    CASE WHEN case_id IS NOT NULL THEN public.permit_case_write_access(case_id)
         ELSE public.permit_project_access(project_id) END
  );
-- Permit records carry evidence and child history. They can be resolved or
-- marked not applicable, but ordinary users cannot erase the record graph.
REVOKE DELETE ON public.project_permits FROM authenticated;

DROP POLICY IF EXISTS permit_requirements_all ON public.permit_requirements;
DROP POLICY IF EXISTS permit_requirements_select ON public.permit_requirements;
DROP POLICY IF EXISTS permit_requirements_insert ON public.permit_requirements;
DROP POLICY IF EXISTS permit_requirements_update ON public.permit_requirements;
DROP POLICY IF EXISTS permit_requirements_delete ON public.permit_requirements;
CREATE POLICY permit_requirements_select ON public.permit_requirements FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_permits p WHERE p.id = project_permit_id
      AND (public.permit_case_access(p.case_id) OR public.permit_project_read_access(p.project_id))
  ));
CREATE POLICY permit_requirements_insert ON public.permit_requirements FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.project_permits p WHERE p.id = project_permit_id
      AND (public.permit_case_write_access(p.case_id) OR public.permit_project_access(p.project_id))
  ));
CREATE POLICY permit_requirements_update ON public.permit_requirements FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_permits p WHERE p.id = project_permit_id
      AND (public.permit_case_write_access(p.case_id) OR public.permit_project_access(p.project_id))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.project_permits p WHERE p.id = project_permit_id
      AND (public.permit_case_write_access(p.case_id) OR public.permit_project_access(p.project_id))
  ));
CREATE POLICY permit_requirements_delete ON public.permit_requirements FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_permits p WHERE p.id = project_permit_id
      AND (public.permit_case_write_access(p.case_id) OR public.permit_project_access(p.project_id))
  ));

DROP POLICY IF EXISTS permit_documents_all ON public.permit_documents;
DROP POLICY IF EXISTS permit_documents_select ON public.permit_documents;
DROP POLICY IF EXISTS permit_documents_insert ON public.permit_documents;
DROP POLICY IF EXISTS permit_documents_update ON public.permit_documents;
DROP POLICY IF EXISTS permit_documents_delete ON public.permit_documents;
CREATE POLICY permit_documents_select ON public.permit_documents FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_permits p WHERE p.id = permit_id
      AND (public.permit_case_access(p.case_id) OR public.permit_project_read_access(p.project_id))
  ));
CREATE POLICY permit_documents_insert ON public.permit_documents FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1
    FROM public.project_permits p
    JOIN public.documents d ON d.id = document_id
    WHERE p.id = permit_id
      AND (public.permit_case_write_access(p.case_id) OR public.permit_project_access(p.project_id))
      AND (
        (p.case_id IS NOT NULL AND d.permit_case_id = p.case_id)
        OR (p.project_id IS NOT NULL AND d.project_id = p.project_id)
      )
  ));
CREATE POLICY permit_documents_update ON public.permit_documents FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_permits p WHERE p.id = permit_id
      AND (public.permit_case_write_access(p.case_id) OR public.permit_project_access(p.project_id))
  ))
  WITH CHECK (EXISTS (
    SELECT 1
    FROM public.project_permits p
    JOIN public.documents d ON d.id = document_id
    WHERE p.id = permit_id
      AND (public.permit_case_write_access(p.case_id) OR public.permit_project_access(p.project_id))
      AND (
        (p.case_id IS NOT NULL AND d.permit_case_id = p.case_id)
        OR (p.project_id IS NOT NULL AND d.project_id = p.project_id)
      )
  ));
CREATE POLICY permit_documents_delete ON public.permit_documents FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_permits p WHERE p.id = permit_id
      AND (public.permit_case_write_access(p.case_id) OR public.permit_project_access(p.project_id))
  ));

DROP POLICY IF EXISTS permit_history_read ON public.permit_history;
CREATE POLICY permit_history_read ON public.permit_history FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_permits p WHERE p.id = project_permit_id
      AND (public.permit_case_access(p.case_id) OR public.permit_project_read_access(p.project_id))
  ));

CREATE OR REPLACE FUNCTION public.protect_project_permit_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_case_project uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.case_id IS DISTINCT FROM OLD.case_id
    OR (OLD.case_id IS NULL AND NEW.project_id IS DISTINCT FROM OLD.project_id)
  ) THEN RAISE EXCEPTION 'Permit authorship and parent cannot be changed'; END IF;
  IF NEW.case_id IS NOT NULL THEN
    SELECT project_id INTO v_case_project FROM public.permit_cases WHERE id = NEW.case_id;
    IF NEW.project_id IS DISTINCT FROM v_case_project
      THEN RAISE EXCEPTION 'Case Permit must use the case project link'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.protect_permit_requirement_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.project_permit_id IS DISTINCT FROM OLD.project_permit_id
    THEN RAISE EXCEPTION 'Paperwork cannot be moved to another Permit record'; END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.protect_permit_document_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (
    NEW.permit_id IS DISTINCT FROM OLD.permit_id
    OR NEW.document_id IS DISTINCT FROM OLD.document_id
  ) THEN RAISE EXCEPTION 'Document evidence must be unlinked before relinking'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS project_permits_protect_identity ON public.project_permits;
DROP TRIGGER IF EXISTS permit_requirements_protect_identity ON public.permit_requirements;
DROP TRIGGER IF EXISTS permit_documents_protect_identity ON public.permit_documents;
CREATE TRIGGER project_permits_protect_identity BEFORE INSERT OR UPDATE ON public.project_permits
  FOR EACH ROW EXECUTE FUNCTION public.protect_project_permit_identity();
CREATE TRIGGER permit_requirements_protect_identity BEFORE UPDATE ON public.permit_requirements
  FOR EACH ROW EXECUTE FUNCTION public.protect_permit_requirement_identity();
CREATE TRIGGER permit_documents_protect_identity BEFORE UPDATE ON public.permit_documents
  FOR EACH ROW EXECUTE FUNCTION public.protect_permit_document_identity();

-- Render every case-scoped Permit and child change into immutable case history.
-- Project-scoped records retain the existing append-only audit log behavior.
CREATE OR REPLACE FUNCTION public.audit_project_permit_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  p public.project_permits;
  v_reason text;
  v_actor uuid;
  v_action text := 'permit_' || lower(TG_OP);
BEGIN
  p := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  v_actor := coalesce(auth.uid(), p.owner_id);
  v_reason := CASE WHEN TG_OP = 'DELETE'
    THEN coalesce(OLD.required_reason, OLD.notes)
    ELSE coalesce(NEW.required_reason, NEW.notes, OLD.required_reason, OLD.notes)
  END;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.permit_history(
      project_permit_id,new_status,new_applicability_status,change_reason,
      source_document_id,source_text,changed_by
    ) VALUES (
      NEW.id,NEW.workflow_status,NEW.applicability_status,v_reason,
      NEW.source_document_id,NEW.source_text,v_actor
    );
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.permit_history(
      project_permit_id,previous_status,new_status,
      previous_applicability_status,new_applicability_status,change_reason,
      source_document_id,source_text,changed_by
    ) VALUES (
      NEW.id,OLD.workflow_status,NEW.workflow_status,
      OLD.applicability_status,NEW.applicability_status,v_reason,
      NEW.source_document_id,NEW.source_text,v_actor
    );
  END IF;

  IF p.case_id IS NOT NULL AND TG_OP = 'DELETE' THEN
    INSERT INTO public.permit_case_history(
      case_id,action,previous_data,new_data,reason,changed_by
    )
    SELECT
      p.case_id,v_action,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
      CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
      left(v_reason,1000),v_actor
    FROM public.permit_cases c WHERE c.id = p.case_id;
  ELSIF p.project_id IS NOT NULL THEN
    INSERT INTO public.audit_logs(
      project_id,workspace_id,owner_id,user_id,entity_type,entity_id,action,payload
    )
    SELECT p.project_id,pr.workspace_id,p.owner_id,v_actor,'permit',p.id,v_action,
      jsonb_build_object('table',TG_TABLE_NAME,'operation',TG_OP)
    FROM public.projects pr WHERE pr.id = p.project_id;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_permit_child_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_old jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_new jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  v_row jsonb := coalesce(v_new,v_old);
  v_permit_id uuid;
  p public.project_permits;
  v_actor uuid;
  v_reason text;
  v_entity text;
  v_action text;
BEGIN
  v_permit_id := coalesce(
    nullif(v_row->>'project_permit_id','')::uuid,
    nullif(v_row->>'permit_id','')::uuid
  );
  SELECT * INTO p FROM public.project_permits WHERE id = v_permit_id;
  IF NOT FOUND THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF;
  v_actor := coalesce(auth.uid(),p.owner_id);
  v_reason := coalesce(v_row->>'status_reason',v_row->>'notes');
  v_entity := CASE WHEN TG_TABLE_NAME = 'permit_requirements'
    THEN 'paperwork' ELSE 'permit_document' END;
  v_action := v_entity || '_' || lower(TG_OP);

  IF p.case_id IS NOT NULL THEN
    INSERT INTO public.permit_case_history(
      case_id,action,previous_data,new_data,reason,changed_by
    )
    SELECT p.case_id,v_action,v_old,v_new,left(v_reason,1000),v_actor
    FROM public.permit_cases c WHERE c.id = p.case_id;
  ELSIF p.project_id IS NOT NULL THEN
    INSERT INTO public.audit_logs(
      project_id,workspace_id,owner_id,user_id,entity_type,entity_id,action,payload
    )
    SELECT p.project_id,pr.workspace_id,p.owner_id,v_actor,'permit',p.id,
      'permit_' || TG_TABLE_NAME || '_' || lower(TG_OP),
      jsonb_build_object('table',TG_TABLE_NAME,'operation',TG_OP,
        'previous',v_old,'new',v_new)
    FROM public.projects pr WHERE pr.id = p.project_id;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- Standalone jobs inherit permit_case_id from their document before RLS is
-- checked. Viewers may observe progress but only contributors may queue/update.
DROP POLICY IF EXISTS "extraction_jobs_select_allowed" ON public.extraction_jobs;
DROP POLICY IF EXISTS "extraction_jobs_insert_allowed" ON public.extraction_jobs;
DROP POLICY IF EXISTS "extraction_jobs_update_allowed" ON public.extraction_jobs;
CREATE POLICY "extraction_jobs_select_allowed" ON public.extraction_jobs
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR (permit_case_id IS NOT NULL AND public.permit_case_access(permit_case_id))
    OR EXISTS (
      SELECT 1 FROM public.projects p WHERE p.id = extraction_jobs.project_id
        AND public.permit_project_read_access(p.id)
    )
  );
CREATE POLICY "extraction_jobs_insert_allowed" ON public.extraction_jobs
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid() AND
    CASE
      WHEN document_id IS NOT NULL AND permit_case_id IS NOT NULL
        THEN public.permit_case_write_access(permit_case_id)
      WHEN document_id IS NOT NULL AND project_id IS NOT NULL
        THEN public.permit_project_access(project_id)
      WHEN document_id IS NOT NULL
        THEN EXISTS (
          SELECT 1 FROM public.documents d
          WHERE d.id = extraction_jobs.document_id AND d.owner_id = auth.uid()
            AND d.project_id IS NULL AND d.permit_case_id IS NULL
        )
      WHEN permit_case_id IS NOT NULL THEN public.permit_case_write_access(permit_case_id)
      WHEN project_id IS NOT NULL THEN public.permit_project_access(project_id)
      ELSE false
    END
  );
CREATE POLICY "extraction_jobs_update_allowed" ON public.extraction_jobs
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (
    owner_id = auth.uid() AND
    CASE
      WHEN permit_case_id IS NOT NULL THEN public.permit_case_write_access(permit_case_id)
      WHEN project_id IS NOT NULL THEN public.permit_project_access(project_id)
      ELSE true
    END
  );

-- Worker output and its append-only audit event commit together. The function
-- rechecks the requesting user's current role so a queued job cannot write
-- after access is revoked.
CREATE OR REPLACE FUNCTION public.record_permit_research_candidates(
  p_document_id uuid,
  p_scope text,
  p_requested_by uuid,
  p_candidates jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_document public.documents%ROWTYPE;
  v_workspace_id uuid;
  v_parent_id uuid;
  v_created_ids jsonb := '[]'::jsonb;
  v_created integer := 0;
  v_version text;
BEGIN
  IF p_scope NOT IN ('case', 'project') THEN RAISE EXCEPTION 'invalid Permit research scope'; END IF;
  IF p_requested_by IS NULL THEN RAISE EXCEPTION 'requesting user is required'; END IF;
  IF jsonb_typeof(p_candidates) <> 'array' OR jsonb_array_length(p_candidates) > 50
    THEN RAISE EXCEPTION 'invalid Permit research candidates'; END IF;

  SELECT * INTO v_document FROM public.documents WHERE id = p_document_id FOR SHARE;
  IF NOT FOUND OR v_document.scan_status <> 'clean'
     OR v_document.status NOT IN ('uploaded', 'analyzed')
    THEN RAISE EXCEPTION 'verified document is unavailable'; END IF;

  IF p_scope = 'case' THEN
    v_parent_id := v_document.permit_case_id;
    SELECT c.workspace_id INTO v_workspace_id
    FROM public.permit_cases c
    WHERE c.id = v_parent_id
      AND c.archived_at IS NULL
      AND (
        (c.workspace_id IS NULL AND c.owner_id = p_requested_by)
        OR EXISTS (
          SELECT 1 FROM public.workspace_members m
          WHERE m.workspace_id = c.workspace_id AND m.user_id = p_requested_by
            AND m.role IN ('owner','admin','member')
        )
      );
  ELSE
    v_parent_id := v_document.project_id;
    SELECT p.workspace_id INTO v_workspace_id
    FROM public.projects p
    WHERE p.id = v_parent_id
      AND (
        (p.workspace_id IS NULL AND p.owner_id = p_requested_by)
        OR EXISTS (
          SELECT 1 FROM public.workspace_members m
          WHERE m.workspace_id = p.workspace_id AND m.user_id = p_requested_by
            AND m.role IN ('owner','admin','member')
        )
      );
  END IF;
  IF v_parent_id IS NULL OR NOT FOUND THEN RAISE EXCEPTION 'Permit research access denied'; END IF;

  v_version := 'permit-research-' || p_scope || '-v1';
  WITH candidate_rows AS (
    SELECT
      left(trim(value->>'candidate_name'), 250) AS candidate_name,
      left(coalesce(nullif(trim(value->>'permit_type'), ''), 'other'), 100) AS permit_type,
      left(nullif(trim(value->>'description'), ''), 2000) AS description,
      left(trim(value->>'source_location'), 500) AS source_location,
      left(trim(value->>'source_text'), 10000) AS source_text,
      greatest(0, least(1, coalesce((value->>'confidence_score')::numeric, 0))) AS confidence_score
    FROM jsonb_array_elements(p_candidates) value
    WHERE length(trim(coalesce(value->>'candidate_name', ''))) > 0
      AND length(trim(coalesce(value->>'source_location', ''))) > 0
      AND length(trim(coalesce(value->>'source_text', ''))) > 0
  ), inserted AS (
    INSERT INTO public.permit_extraction_candidates(
      project_id, permit_case_id, owner_id, document_id, candidate_name,
      permit_type, description, source_location, source_text,
      confidence_score, review_status, extraction_version
    )
    SELECT
      CASE WHEN p_scope = 'project' THEN v_parent_id ELSE NULL END,
      CASE WHEN p_scope = 'case' THEN v_parent_id ELSE NULL END,
      v_document.owner_id, v_document.id, candidate_name,
      permit_type, description, source_location, source_text,
      confidence_score, 'needs_review', v_version
    FROM candidate_rows
    ON CONFLICT(document_id,candidate_name,source_location,extraction_version) DO NOTHING
    RETURNING id
  )
  SELECT coalesce(jsonb_agg(id), '[]'::jsonb), count(*)::integer
  INTO v_created_ids, v_created
  FROM inserted;

  IF v_created > 0 AND p_scope = 'case' THEN
    INSERT INTO public.permit_case_history(
      case_id, action, previous_data, new_data, reason, changed_by
    ) VALUES (
      v_parent_id, 'case_document_research_completed', NULL,
      jsonb_build_object(
        'document_id', v_document.id,
        'candidate_ids', v_created_ids,
        'candidate_count', v_created,
        'extraction_version', v_version
      ),
      'Sourced Permit clues created from a verified document.', p_requested_by
    );
  ELSIF v_created > 0 THEN
    INSERT INTO public.audit_logs(
      project_id, workspace_id, owner_id, user_id,
      entity_type, entity_id, action, payload
    ) VALUES (
      v_parent_id, v_workspace_id, p_requested_by, p_requested_by,
      'permit_extraction_candidate', NULL, 'permit_document_research_completed',
      jsonb_build_object(
        'document_id', v_document.id,
        'candidate_ids', v_created_ids,
        'candidate_count', v_created,
        'extraction_version', v_version
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'created', v_created,
    'candidateCount', jsonb_array_length(p_candidates)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_permit_research_candidates(uuid,text,uuid,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_permit_research_candidates(uuid,text,uuid,jsonb)
  TO service_role;

-- One locked transaction performs the only allowed candidate decision. The
-- source, parent, uploader, trusted timestamp, and reviewer cannot be forged.
CREATE OR REPLACE FUNCTION public.review_permit_extraction_candidate(
  p_candidate_id uuid,
  p_decision text,
  p_reason text
) RETURNS TABLE(candidate_id uuid, decision text, project_permit_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_candidate public.permit_extraction_candidates%ROWTYPE;
  v_permit_id uuid;
  v_workspace_id uuid;
  v_case_project_id uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication is required'; END IF;
  IF p_decision NOT IN ('accepted', 'rejected') THEN RAISE EXCEPTION 'invalid review decision'; END IF;
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'a review reason is required'; END IF;

  SELECT * INTO v_candidate
  FROM public.permit_extraction_candidates
  WHERE id = p_candidate_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'candidate was not found'; END IF;
  IF v_candidate.permit_case_id IS NOT NULL THEN
    IF NOT public.permit_case_write_access(v_candidate.permit_case_id)
      THEN RAISE EXCEPTION 'permit case write access is required'; END IF;
    SELECT workspace_id, project_id INTO v_workspace_id, v_case_project_id
    FROM public.permit_cases WHERE id = v_candidate.permit_case_id;
  ELSE
    IF NOT public.permit_project_access(v_candidate.project_id)
      THEN RAISE EXCEPTION 'project write access is required'; END IF;
    SELECT workspace_id INTO v_workspace_id
    FROM public.projects WHERE id = v_candidate.project_id;
  END IF;

  IF v_candidate.review_status <> 'needs_review' THEN
    IF v_candidate.review_status = p_decision THEN
      RETURN QUERY SELECT v_candidate.id, v_candidate.review_status, v_candidate.project_permit_id;
      RETURN;
    END IF;
    RAISE EXCEPTION 'candidate has already been reviewed';
  END IF;

  IF p_decision = 'accepted' THEN
    IF v_candidate.permit_case_id IS NOT NULL
       AND coalesce(v_candidate.permit_type, 'other') <> 'other' THEN
      PERFORM pg_advisory_xact_lock(hashtextextended(
        'agir:permit-candidate:' || v_candidate.permit_case_id::text || ':' ||
        coalesce(v_candidate.permit_type, 'other'), 0
      ));
      SELECT id INTO v_permit_id
      FROM public.project_permits
      WHERE case_id = v_candidate.permit_case_id
        AND permit_type = coalesce(v_candidate.permit_type, 'other')
      ORDER BY
        (workflow_status <> 'not_started') DESC,
        (applicability_status IN ('required','not_required','not_applicable')) DESC,
        source_reviewed_at DESC NULLS LAST,
        created_at ASC
      LIMIT 1
      FOR UPDATE;
    END IF;
    IF v_permit_id IS NULL THEN
      INSERT INTO public.project_permits(
        case_id, project_id, owner_id, jurisdiction_id, name, permit_type,
        description, applicability_status, workflow_status, is_required,
        processing_duration_text, processing_duration_days, duration_source,
        source_document_id, source_location, source_text, source_kind,
        confidence_score, confidence_band, required_reason, notes
      ) VALUES (
        v_candidate.permit_case_id,
        CASE WHEN v_candidate.permit_case_id IS NOT NULL
          THEN v_case_project_id ELSE v_candidate.project_id END,
        v_actor,
        v_candidate.jurisdiction_id, v_candidate.candidate_name,
        coalesce(v_candidate.permit_type, 'other'), v_candidate.description,
        'needs_review', 'not_started', NULL,
        v_candidate.processing_duration_text, v_candidate.processing_duration_days,
        CASE WHEN v_candidate.processing_duration_text IS NOT NULL
          THEN 'Project document: ' || v_candidate.document_id::text ELSE NULL END,
        v_candidate.document_id, v_candidate.source_location, v_candidate.source_text,
        'extracted', v_candidate.confidence_score,
        'document_clue_reviewed_scope_unconfirmed', left(trim(p_reason), 1000),
        'Accepted for research. This does not confirm a Permit requirement.'
      ) RETURNING id INTO v_permit_id;
    END IF;
  END IF;

  UPDATE public.permit_extraction_candidates
  SET review_status = p_decision,
      reviewed_by = v_actor,
      reviewed_at = now(),
      review_reason = left(trim(p_reason), 1000),
      project_permit_id = v_permit_id,
      updated_at = now()
  WHERE id = v_candidate.id
  RETURNING * INTO v_candidate;

  IF v_candidate.permit_case_id IS NOT NULL THEN
    INSERT INTO public.permit_case_history(
      case_id, action, previous_data, new_data, reason, changed_by
    ) VALUES (
      v_candidate.permit_case_id,
      'document_candidate_' || p_decision,
      jsonb_build_object('review_status', 'needs_review'),
      jsonb_build_object(
        'candidate_id', v_candidate.id,
        'review_status', p_decision,
        'project_permit_id', v_permit_id,
        'document_id', v_candidate.document_id,
        'source_location', v_candidate.source_location,
        'source_text', v_candidate.source_text
      ),
      left(trim(p_reason), 1000), v_actor
    );
  ELSE
    INSERT INTO public.audit_logs(
      project_id, workspace_id, owner_id, user_id,
      entity_type, entity_id, action, payload
    ) VALUES (
      v_candidate.project_id, v_workspace_id, v_actor, v_actor,
      'permit_extraction_candidate', v_candidate.id,
      'document_candidate_' || p_decision,
      jsonb_build_object(
        'project_permit_id', v_permit_id,
        'document_id', v_candidate.document_id,
        'source_location', v_candidate.source_location,
        'reason', left(trim(p_reason), 1000)
      )
    );
  END IF;

  RETURN QUERY SELECT v_candidate.id, v_candidate.review_status, v_permit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.review_permit_extraction_candidate(uuid,text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_permit_extraction_candidate(uuid,text,text)
  TO authenticated;
REVOKE ALL ON FUNCTION public.protect_project_permit_identity()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_permit_requirement_identity()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_permit_document_identity()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bind_extraction_job_to_permit_case()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_project_permit_change()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_permit_child_change()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_project_permit_identity() TO service_role;
GRANT EXECUTE ON FUNCTION public.protect_permit_requirement_identity() TO service_role;
GRANT EXECUTE ON FUNCTION public.protect_permit_document_identity() TO service_role;
GRANT EXECUTE ON FUNCTION public.bind_extraction_job_to_permit_case() TO service_role;
GRANT EXECUTE ON FUNCTION public.audit_project_permit_change() TO service_role;
GRANT EXECUTE ON FUNCTION public.audit_permit_child_change() TO service_role;
