-- Neutral permit-case boundary. Existing project permit rows are backfilled in
-- place; project_id remains as a compatibility pointer and is nullable only for
-- genuinely standalone cases. Recovery: restore project_id from permit_cases.project_id,
-- then remove case_id after confirming no standalone rows remain.
CREATE TABLE public.permit_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id uuid UNIQUE REFERENCES public.projects(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  property_address text,
  municipality text,
  municipality_confirmed boolean NOT NULL DEFAULT false,
  province text NOT NULL DEFAULT 'British Columbia',
  property_type text CHECK (property_type IN ('residential','commercial','industrial','mixed_use','institutional','other')),
  work_type text CHECK (work_type IN ('new_construction','renovation','tenant_improvement','demolition','addition','change_of_use','accessory_secondary_dwelling','site_servicing','industrial_alteration','other')),
  project_context text CHECK (project_context IN ('single_family_residential','multifamily_residential','commercial','industrial','mixed_use','large_development','other')),
  work_categories text[] NOT NULL DEFAULT '{}',
  description text, existing_use text, proposed_use text, known_conditions text, notes text,
  zoning_designation text, zoning_source text, zoning_verified_at timestamptz,
  zoning_source_kind text NOT NULL DEFAULT 'unknown' CHECK (zoning_source_kind IN ('verified_source','analyst','unknown','not_applicable')),
  target_date date, issue_date date, expiration_date date,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (zoning_designation IS NULL OR (zoning_source IS NOT NULL AND zoning_verified_at IS NOT NULL AND zoning_source_kind IN ('verified_source','analyst')))
);

INSERT INTO public.permit_cases(owner_id,workspace_id,project_id,name,property_address,municipality,municipality_confirmed,property_type,work_type,work_categories,description,zoning_designation,zoning_source,zoning_verified_at,zoning_source_kind,created_at,updated_at)
SELECT p.owner_id,p.workspace_id,p.id,p.name,p.property_address,p.municipality,(p.municipality IS NOT NULL),
       CASE WHEN p.property_type IN ('residential','commercial','industrial','mixed_use') THEN p.property_type END,
       CASE WHEN p.permit_project_type IN ('new_construction','renovation','tenant_improvement','demolition','addition','change_of_use','other') THEN p.permit_project_type END,
       p.work_categories,p.project_description,p.zoning_designation,p.zoning_source,p.zoning_verified_at,
       CASE WHEN p.zoning_designation IS NULL THEN 'unknown' WHEN p.zoning_source IS NOT NULL AND p.zoning_verified_at IS NOT NULL THEN 'analyst' ELSE 'unknown' END,
       p.created_at,p.updated_at
FROM public.projects p
WHERE EXISTS (SELECT 1 FROM public.project_permits pp WHERE pp.project_id=p.id)
ON CONFLICT(project_id) DO NOTHING;

ALTER TABLE public.project_permits ADD COLUMN case_id uuid REFERENCES public.permit_cases(id) ON DELETE CASCADE;
UPDATE public.project_permits pp SET case_id=pc.id FROM public.permit_cases pc WHERE pc.project_id=pp.project_id AND pp.case_id IS NULL;
ALTER TABLE public.project_permits ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE public.project_permits ADD CONSTRAINT project_permits_case_or_project CHECK (case_id IS NOT NULL OR project_id IS NOT NULL);
CREATE INDEX permit_cases_owner_idx ON public.permit_cases(owner_id,updated_at DESC);
CREATE INDEX permit_cases_workspace_idx ON public.permit_cases(workspace_id,updated_at DESC);
CREATE INDEX project_permits_case_idx ON public.project_permits(case_id,created_at DESC);

CREATE OR REPLACE FUNCTION public.permit_case_access(p_case_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS (SELECT 1 FROM public.permit_cases c WHERE c.id=p_case_id AND
   ((c.workspace_id IS NULL AND c.owner_id=auth.uid()) OR public.workspace_role(c.workspace_id) IN ('owner','admin','member','viewer')))
$$;
CREATE OR REPLACE FUNCTION public.permit_case_write_access(p_case_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS (SELECT 1 FROM public.permit_cases c WHERE c.id=p_case_id AND
   ((c.workspace_id IS NULL AND c.owner_id=auth.uid()) OR public.workspace_role(c.workspace_id) IN ('owner','admin','member')))
$$;

ALTER TABLE public.permit_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY permit_cases_select ON public.permit_cases FOR SELECT TO authenticated USING (public.permit_case_access(id));
CREATE POLICY permit_cases_insert ON public.permit_cases FOR INSERT TO authenticated WITH CHECK (owner_id=auth.uid() AND (workspace_id IS NULL OR public.workspace_role(workspace_id) IN ('owner','admin','member')));
CREATE POLICY permit_cases_update ON public.permit_cases FOR UPDATE TO authenticated USING (public.permit_case_write_access(id)) WITH CHECK (public.permit_case_write_access(id));
CREATE POLICY permit_cases_delete ON public.permit_cases FOR DELETE TO authenticated USING (public.permit_case_write_access(id));

DROP POLICY project_permits_all ON public.project_permits;
CREATE POLICY project_permits_all ON public.project_permits FOR ALL TO authenticated
 USING (CASE WHEN case_id IS NOT NULL THEN public.permit_case_access(case_id) ELSE public.permit_project_access(project_id) END)
 WITH CHECK (owner_id=auth.uid() AND CASE WHEN case_id IS NOT NULL THEN public.permit_case_write_access(case_id) ELSE public.permit_project_access(project_id) END);

DROP POLICY permit_requirements_all ON public.permit_requirements;
CREATE POLICY permit_requirements_all ON public.permit_requirements FOR ALL TO authenticated
 USING (EXISTS (SELECT 1 FROM public.project_permits p WHERE p.id=project_permit_id AND (public.permit_case_access(p.case_id) OR public.permit_project_access(p.project_id))))
 WITH CHECK (EXISTS (SELECT 1 FROM public.project_permits p WHERE p.id=project_permit_id AND (public.permit_case_write_access(p.case_id) OR public.permit_project_access(p.project_id))));
DROP POLICY permit_documents_all ON public.permit_documents;
CREATE POLICY permit_documents_all ON public.permit_documents FOR ALL TO authenticated
 USING (EXISTS (SELECT 1 FROM public.project_permits p WHERE p.id=permit_id AND (public.permit_case_access(p.case_id) OR public.permit_project_access(p.project_id))))
 WITH CHECK (EXISTS (SELECT 1 FROM public.project_permits p JOIN public.documents d ON d.id=document_id WHERE p.id=permit_id AND d.owner_id=auth.uid() AND (public.permit_case_write_access(p.case_id) OR public.permit_project_access(p.project_id))));
DROP POLICY permit_history_read ON public.permit_history;
CREATE POLICY permit_history_read ON public.permit_history FOR SELECT TO authenticated
 USING (EXISTS (SELECT 1 FROM public.project_permits p WHERE p.id=project_permit_id AND (public.permit_case_access(p.case_id) OR public.permit_project_access(p.project_id))));

CREATE TABLE public.permit_case_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES public.permit_cases(id) ON DELETE CASCADE,
 action text NOT NULL, previous_data jsonb, new_data jsonb, reason text,
 changed_by uuid NOT NULL REFERENCES auth.users(id), changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.permit_case_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY permit_case_history_read ON public.permit_case_history FOR SELECT TO authenticated USING (public.permit_case_access(case_id));
CREATE INDEX permit_case_history_case_idx ON public.permit_case_history(case_id,changed_at DESC);
CREATE OR REPLACE FUNCTION public.audit_permit_case_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 INSERT INTO public.permit_case_history(case_id,action,previous_data,new_data,changed_by)
 VALUES(COALESCE(NEW.id,OLD.id),'case_'||lower(TG_OP),CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END,auth.uid());
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER permit_cases_audit AFTER INSERT OR UPDATE OR DELETE ON public.permit_cases FOR EACH ROW EXECUTE FUNCTION public.audit_permit_case_change();
GRANT SELECT,INSERT,UPDATE,DELETE ON public.permit_cases TO authenticated;
GRANT SELECT ON public.permit_case_history TO authenticated;
GRANT ALL ON public.permit_cases,public.permit_case_history TO service_role;
