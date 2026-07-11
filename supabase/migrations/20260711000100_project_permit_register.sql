-- Project permit register. Permit facts are isolated from underwriting inputs.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS property_address text,
  ADD COLUMN IF NOT EXISTS municipality text,
  ADD COLUMN IF NOT EXISTS permit_project_type text,
  ADD COLUMN IF NOT EXISTS property_type text,
  ADD COLUMN IF NOT EXISTS project_description text,
  ADD COLUMN IF NOT EXISTS work_categories text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS zoning_designation text,
  ADD COLUMN IF NOT EXISTS zoning_source text,
  ADD COLUMN IF NOT EXISTS zoning_verified_at timestamptz;

CREATE TABLE public.jurisdictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, province text NOT NULL,
  regional_area text, jurisdiction_type text NOT NULL, official_url text NOT NULL,
  permit_portal_url text, active boolean NOT NULL DEFAULT true, last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(name, province)
);

CREATE TABLE public.permit_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), jurisdiction_id uuid NOT NULL REFERENCES public.jurisdictions(id) ON DELETE CASCADE,
  name text NOT NULL, permit_type text NOT NULL, description text, applicability_conditions text,
  official_source_url text, source_title text, source_text text, source_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  required_documents jsonb NOT NULL DEFAULT '[]', published_duration_text text, published_duration_days numeric,
  application_url text, effective_date date, review_date date, rule_version text NOT NULL,
  verification_status text NOT NULL CHECK (verification_status IN ('verified','potentially_applicable','unknown','needs_review')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(jurisdiction_id, name, rule_version)
);

CREATE TABLE public.project_permits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, jurisdiction_id uuid REFERENCES public.jurisdictions(id) ON DELETE SET NULL,
  permit_rule_id uuid REFERENCES public.permit_rules(id) ON DELETE SET NULL, name text NOT NULL, permit_type text NOT NULL,
  description text, applicability_status text NOT NULL DEFAULT 'unknown' CHECK (applicability_status IN ('unknown','potentially_required','required','not_required','not_applicable','needs_review')),
  workflow_status text NOT NULL DEFAULT 'not_started' CHECK (workflow_status IN ('not_started','application_ready','submitted','under_review','corrections_requested','approved','issued','expired','rejected','blocked')),
  is_required boolean, required_reason text, processing_duration_text text, processing_duration_days numeric,
  duration_source text, responsible_party text, application_url text, application_date date, target_date date, issued_date date, expiration_date date,
  confidence_score numeric CHECK (confidence_score BETWEEN 0 AND 1), confidence_band text,
  source_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL, source_location text, source_text text,
  source_kind text NOT NULL DEFAULT 'unknown' CHECK (source_kind IN ('verified_source','analyst','extracted','reported','unknown','needs_review','not_applicable')),
  notes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (processing_duration_days IS NULL OR duration_source IS NOT NULL),
  CHECK (source_kind <> 'analyst' OR required_reason IS NOT NULL OR notes IS NOT NULL),
  CHECK (is_required IS NULL OR applicability_status IN ('required','not_required'))
);

CREATE TABLE public.permit_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_permit_id uuid NOT NULL REFERENCES public.project_permits(id) ON DELETE CASCADE,
  name text NOT NULL, description text, requirement_type text NOT NULL DEFAULT 'paperwork', status text NOT NULL DEFAULT 'missing',
  is_required boolean NOT NULL DEFAULT true, document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  source_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL, source_text text, due_date date, notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.permit_documents (
  permit_id uuid NOT NULL REFERENCES public.project_permits(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE, document_role text NOT NULL DEFAULT 'supporting',
  is_required boolean NOT NULL DEFAULT false, is_received boolean NOT NULL DEFAULT true, received_at timestamptz, notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (permit_id, document_id)
);

CREATE TABLE public.permit_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_permit_id uuid NOT NULL REFERENCES public.project_permits(id) ON DELETE CASCADE,
  previous_status text, new_status text, previous_applicability_status text, new_applicability_status text,
  change_reason text, source_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL, source_text text,
  changed_by uuid NOT NULL REFERENCES auth.users(id), changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX project_permits_project_idx ON public.project_permits(project_id, created_at DESC);
CREATE INDEX project_permits_owner_idx ON public.project_permits(owner_id);
CREATE INDEX project_permits_jurisdiction_idx ON public.project_permits(jurisdiction_id);
CREATE INDEX permit_rules_jurisdiction_idx ON public.permit_rules(jurisdiction_id);
CREATE INDEX permit_requirements_permit_idx ON public.permit_requirements(project_permit_id);
CREATE INDEX permit_history_permit_idx ON public.permit_history(project_permit_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.permit_project_access(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS (SELECT 1 FROM public.projects p WHERE p.id=p_project_id AND ((p.workspace_id IS NULL AND p.owner_id=auth.uid()) OR public.workspace_role(p.workspace_id) IN ('owner','admin','member')))
$$;

ALTER TABLE public.jurisdictions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.permit_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_permits ENABLE ROW LEVEL SECURITY; ALTER TABLE public.permit_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permit_documents ENABLE ROW LEVEL SECURITY; ALTER TABLE public.permit_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY jurisdictions_read ON public.jurisdictions FOR SELECT TO authenticated USING (active);
CREATE POLICY permit_rules_read ON public.permit_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY project_permits_all ON public.project_permits FOR ALL TO authenticated USING (public.permit_project_access(project_id)) WITH CHECK (owner_id=auth.uid() AND public.permit_project_access(project_id));
CREATE POLICY permit_requirements_all ON public.permit_requirements FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.project_permits p WHERE p.id=project_permit_id AND public.permit_project_access(p.project_id))) WITH CHECK (EXISTS (SELECT 1 FROM public.project_permits p WHERE p.id=project_permit_id AND public.permit_project_access(p.project_id)));
CREATE POLICY permit_documents_all ON public.permit_documents FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.project_permits p WHERE p.id=permit_id AND public.permit_project_access(p.project_id))) WITH CHECK (EXISTS (SELECT 1 FROM public.project_permits p WHERE p.id=permit_id AND public.permit_project_access(p.project_id)));
CREATE POLICY permit_history_read ON public.permit_history FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.project_permits p WHERE p.id=project_permit_id AND public.permit_project_access(p.project_id)));

CREATE OR REPLACE FUNCTION public.audit_project_permit_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.project_permits; reason text; action_name text;
BEGIN
 p := COALESCE(NEW,OLD); reason := COALESCE(NEW.required_reason,NEW.notes,OLD.required_reason,OLD.notes);
 action_name := 'permit_'||lower(TG_OP);
 IF TG_OP='INSERT' THEN
  INSERT INTO public.permit_history(project_permit_id,new_status,new_applicability_status,change_reason,source_document_id,source_text,changed_by)
  VALUES(NEW.id,NEW.workflow_status,NEW.applicability_status,reason,NEW.source_document_id,NEW.source_text,auth.uid());
 ELSIF TG_OP='UPDATE' THEN
  INSERT INTO public.permit_history(project_permit_id,previous_status,new_status,previous_applicability_status,new_applicability_status,change_reason,source_document_id,source_text,changed_by)
  VALUES(NEW.id,OLD.workflow_status,NEW.workflow_status,OLD.applicability_status,NEW.applicability_status,reason,NEW.source_document_id,NEW.source_text,auth.uid());
 END IF;
 INSERT INTO public.audit_logs(project_id,workspace_id,owner_id,user_id,entity_type,entity_id,action,payload)
 SELECT p.project_id,pr.workspace_id,p.owner_id,auth.uid(),'permit',p.id,action_name,jsonb_build_object('table',TG_TABLE_NAME,'operation',TG_OP) FROM public.projects pr WHERE pr.id=p.project_id;
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE OR REPLACE FUNCTION public.audit_permit_child_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE permit_uuid uuid; p public.project_permits;
BEGIN
 IF TG_TABLE_NAME='permit_requirements' THEN permit_uuid := COALESCE(NEW.project_permit_id,OLD.project_permit_id); ELSE permit_uuid := COALESCE(NEW.permit_id,OLD.permit_id); END IF;
 SELECT * INTO p FROM public.project_permits WHERE id=permit_uuid;
 INSERT INTO public.audit_logs(project_id,workspace_id,owner_id,user_id,entity_type,entity_id,action,payload)
 SELECT p.project_id,pr.workspace_id,p.owner_id,auth.uid(),'permit',p.id,'permit_'||TG_TABLE_NAME||'_'||lower(TG_OP),jsonb_build_object('table',TG_TABLE_NAME,'operation',TG_OP) FROM public.projects pr WHERE pr.id=p.project_id;
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER project_permits_audit AFTER INSERT OR UPDATE OR DELETE ON public.project_permits FOR EACH ROW EXECUTE FUNCTION public.audit_project_permit_change();
CREATE TRIGGER permit_requirements_audit AFTER INSERT OR UPDATE OR DELETE ON public.permit_requirements FOR EACH ROW EXECUTE FUNCTION public.audit_permit_child_change();
CREATE TRIGGER permit_documents_audit AFTER INSERT OR UPDATE OR DELETE ON public.permit_documents FOR EACH ROW EXECUTE FUNCTION public.audit_permit_child_change();

INSERT INTO public.jurisdictions(name,province,regional_area,jurisdiction_type,official_url,permit_portal_url,last_verified_at) VALUES
('City of Vancouver','British Columbia','Metro Vancouver','municipality','https://vancouver.ca/','https://vancouver.ca/home-property-development/apply-for-and-manage-your-permit.aspx','2026-07-10'),
('City of Burnaby','British Columbia','Metro Vancouver','municipality','https://www.burnaby.ca/','https://www.burnaby.ca/services-and-payments/development-permits-construction','2026-07-10'),
('City of Richmond','British Columbia','Metro Vancouver','municipality','https://www.richmond.ca/','https://www.richmond.ca/business-development/building-approvals.htm','2026-07-10'),
('City of Surrey','British Columbia','Metro Vancouver','municipality','https://www.surrey.ca/','https://www.surrey.ca/renovating-building-development','2026-07-10'),
('City of New Westminster','British Columbia','Metro Vancouver','municipality','https://www.newwestcity.ca/','https://www.newwestcity.ca/building-permits','2026-07-10'),
('City of Kelowna','British Columbia',NULL,'municipality','https://www.kelowna.ca/','https://www.kelowna.ca/homes-building/building-permits-inspections/apply-building-permit','2026-07-10')
ON CONFLICT(name,province) DO UPDATE SET last_verified_at=excluded.last_verified_at;

WITH seeds(city,name,ptype,descr,conditions,url,title,source,duration,days,app) AS (VALUES
('City of Vancouver','Building permit','building','City review for construction on private property.','Applicability depends on the verified scope; do not infer from address or project type.','https://vancouver.ca/home-property-development/apply-for-and-manage-your-permit.aspx','Apply for and manage your permit','The City states construction projects on private property require a building permit before work begins.',NULL,NULL,'https://vancouver.ca/home-property-development/apply-for-and-manage-your-permit.aspx'),
('City of Vancouver','Development permit','development','Land-use and built-form approval.','May be required depending on site zoning and proposal details.','https://vancouver.ca/home-property-development/development-permit.aspx','Get a development permit','A separate development permit can be required for large projects, zoning relaxations, particular uses, or change of use.',NULL,NULL,'https://vancouver.ca/home-property-development/development-permit.aspx'),
('City of Burnaby','Building permit','building','Construction, alteration, removal or demolition permit information.','Verify scope with the City; some projects require a development permit first.','https://www.burnaby.ca/services-and-payments/development-permits-construction/home-improvement-permits','Home Improvement Permits','The City lists excavation, erection, enlargement, alteration, removal, fire repair and demolition as permit work.',NULL,NULL,'https://www.burnaby.ca/services-and-payments/development-permits-construction/home-improvement-permits'),
('City of Richmond','Building permit','building','Building construction and alteration approval.','Verify against the project facts and current City checklist.','https://www.richmond.ca/business-development/building-approvals/faqs.htm','Building Approvals FAQs','The City lists new buildings, additions, alterations, renovations and repairs among work requiring permits.',NULL,NULL,'https://www.richmond.ca/business-development/building-approvals.htm'),
('City of Richmond','Plumbing permit','plumbing','Permit for plumbing work.','Potentially applicable where plumbing is installed or modified.','https://www.richmond.ca/business-development/building-approvals/faqs.htm','Building Approvals FAQs','The City identifies plumbing permits and trades work involving plumbing.',NULL,NULL,'https://www.richmond.ca/business-development/building-approvals.htm'),
('City of Surrey','Tenant and Landlord Improvement Building Permit','tenant_improvement','Building permit for alterations within leased space.','City says typically required for renovations or alterations; verify actual work.','https://www.surrey.ca/renovating-building-development/building/commercial-building-permits/tenant-and-landlord-improvement-building-permit','Tenant and Landlord Improvement Building Permit','The City lists new construction or alteration within a building, with specific minor-work exclusions.','4.9 weeks current processing time for new tenant improvement, updated July 6, 2026',34.3,'https://www.surrey.ca/renovating-building-development/building/commercial-building-permits/tenant-and-landlord-improvement-building-permit'),
('City of New Westminster','Building permit','building','Building permit for construction, alteration or demolition.','Verify the applicable application package for the project.','https://www.newwestcity.ca/forms-and-documentation','Forms and Documentation','The City states building permits are required for construction, alteration or demolition of new or existing structures.',NULL,NULL,'https://www.newwestcity.ca/building-permits'),
('City of New Westminster','Plumbing permit','plumbing','Municipal plumbing permit.','Potentially applicable only where verified plumbing work is in scope.','https://www.newwestcity.ca/forms-and-documentation','Forms and Documentation','The City publishes a Plumbing Permit Guide and Plumbing Permit Application Form.',NULL,NULL,'https://www.newwestcity.ca/forms-and-documentation'),
('City of Kelowna','Building permit','building','Permit for building work across residential, commercial, industrial and multifamily projects.','Select the official application stream matching verified scope.','https://www.kelowna.ca/homes-building/building-permits-inspections/apply-building-permit','Apply for a building permit','The City publishes application streams including commercial, industrial, large multifamily, demolition and miscellaneous work.',NULL,NULL,'https://www.kelowna.ca/homes-building/building-permits-inspections/apply-building-permit'),
('City of Kelowna','Development application','development','Development planning application family.','Specific approval type depends on verified site and proposal facts.','https://www.kelowna.ca/homes-building/planning-development/apply-development-application','Apply for a Development Application','The City lists development permits, variances, heritage, environmental, rezoning, soil and urban-design application types.',NULL,NULL,'https://www.kelowna.ca/homes-building/planning-development/apply-development-application')
)
INSERT INTO public.permit_rules(jurisdiction_id,name,permit_type,description,applicability_conditions,official_source_url,source_title,source_text,published_duration_text,published_duration_days,application_url,review_date,rule_version,verification_status)
SELECT j.id,s.name,s.ptype,s.descr,s.conditions,s.url,s.title,s.source,s.duration,s.days,s.app,'2026-07-10','2026-07-10','verified' FROM seeds s JOIN public.jurisdictions j ON j.name=s.city
ON CONFLICT(jurisdiction_id,name,rule_version) DO NOTHING;

GRANT SELECT ON public.jurisdictions,public.permit_rules TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.project_permits,public.permit_requirements,public.permit_documents TO authenticated;
GRANT SELECT ON public.permit_history TO authenticated;
