-- Permits-first professional pilot governance. This migration is additive.
-- It records access, review, handoff, feedback, and legal-copy evidence without
-- asserting that any external review or approval has occurred.

ALTER TABLE public.jurisdictions
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

UPDATE public.jurisdictions
SET active=false
WHERE name='City of New Westminster' AND province='British Columbia';

INSERT INTO public.jurisdictions(
  name,province,regional_area,jurisdiction_type,official_url,permit_portal_url,last_verified_at,active
) VALUES (
  'City of Coquitlam','British Columbia','Metro Vancouver','municipality',
  'https://www.coquitlam.ca/',
  'https://www.coquitlam.ca/478/Building-Construction',
  '2026-07-11',true
)
ON CONFLICT(name,province) DO UPDATE SET
  regional_area=excluded.regional_area,
  jurisdiction_type=excluded.jurisdiction_type,
  official_url=excluded.official_url,
  permit_portal_url=excluded.permit_portal_url,
  last_verified_at=excluded.last_verified_at,
  active=true;

WITH categories(permit_type) AS (VALUES
 ('building'),('development'),('zoning_land_use'),('plumbing'),('electrical'),('mechanical_hvac'),
 ('demolition'),('tenant_improvement'),('occupancy_change_of_use'),('fire_life_safety'),('tree'),
 ('heritage'),('environmental_site'),('excavation_shoring_servicing')
), coquitlam_sources(permit_type,name,source_title,official_source_url,source_text,conditions,status) AS (VALUES
 ('building','Building permit review','Building and Construction','https://www.coquitlam.ca/478/Building-Construction','The City publishes building permit information for construction, alteration, repair, demolition, moving, plumbing, sprinkler, heating, and gas systems.','Applicability depends on verified property and work facts.','potentially_applicable'),
 ('development','Development permit review','Development Permits','https://www.coquitlam.ca/254/Development-Permits','The City publishes Development Permit Area information and states that location and construction type affect the review.','A verified site and proposal review is required.','potentially_applicable'),
 ('plumbing','Plumbing permit review','Permit Application Review','https://www.coquitlam.ca/1385/Permit-Application-Review','The City publishes a plumbing permit checklist in its electronic application process.','Potentially applicable only to verified plumbing work.','potentially_applicable'),
 ('tenant_improvement','Tenant improvement permit review','Permit Application Review','https://www.coquitlam.ca/1385/Permit-Application-Review','The City publishes a tenant improvement checklist for general renovation applications.','Potentially applicable only to verified tenant improvement work.','potentially_applicable')
), rows AS (
 SELECT j.id AS jurisdiction_id,c.permit_type,
   COALESCE(s.name,initcap(replace(c.permit_type,'_',' '))||' review') AS name,
   COALESCE(s.source_title,'Reviewed source gap') AS source_title,
   COALESCE(s.official_source_url,j.official_url) AS official_source_url,
   COALESCE(s.source_text,'No category-specific official determination is recorded in the reviewed pilot source set.') AS source_text,
   COALESCE(s.conditions,'Unknown until a current official source and verified case facts support review.') AS conditions,
   COALESCE(s.status,'unknown') AS verification_status
 FROM public.jurisdictions j CROSS JOIN categories c
 LEFT JOIN coquitlam_sources s ON s.permit_type=c.permit_type
 WHERE j.name='City of Coquitlam' AND j.province='British Columbia'
)
INSERT INTO public.permit_rules(
 jurisdiction_id,name,permit_type,description,applicability_conditions,official_source_url,
 source_title,source_text,application_url,review_date,next_review_at,rule_version,
 verification_status,authority_scope
)
SELECT jurisdiction_id,name,permit_type,
 'Catalogue candidate only. This row does not establish a project requirement.',
 conditions,official_source_url,source_title,source_text,official_source_url,
 '2026-07-11','2027-01-11','2026-07-11-coquitlam-pilot',verification_status,'municipal'
FROM rows
ON CONFLICT(jurisdiction_id,name,rule_version) DO NOTHING;

ALTER TABLE public.permit_rules
  ADD COLUMN IF NOT EXISTS source_owner text,
  ADD COLUMN IF NOT EXISTS review_owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS freshness_threshold_days integer NOT NULL DEFAULT 180 CHECK (freshness_threshold_days BETWEEN 1 AND 3650),
  ADD COLUMN IF NOT EXISTS freshness_status text NOT NULL DEFAULT 'not_reviewed'
    CHECK (freshness_status IN ('not_reviewed','current','stale','changed','unavailable','conflicting')),
  ADD COLUMN IF NOT EXISTS official_source_status text NOT NULL DEFAULT 'not_reviewed'
    CHECK (official_source_status IN ('not_reviewed','official','not_official','unknown')),
  ADD COLUMN IF NOT EXISTS availability_status text NOT NULL DEFAULT 'unknown'
    CHECK (availability_status IN ('unknown','available','unavailable')),
  ADD COLUMN IF NOT EXISTS known_limitations text;

ALTER TABLE public.project_permits
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS source_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_freshness_status text NOT NULL DEFAULT 'not_reviewed'
    CHECK (source_freshness_status IN ('not_reviewed','current','stale','changed','unavailable','conflicting')),
  ADD COLUMN IF NOT EXISTS source_official_status text NOT NULL DEFAULT 'not_reviewed'
    CHECK (source_official_status IN ('not_reviewed','official','not_official','unknown')),
  ADD COLUMN IF NOT EXISTS professional_confirmation_status text NOT NULL DEFAULT 'not_reviewed'
    CHECK (professional_confirmation_status IN ('not_reviewed','confirmed','rejected','conflicting')),
  ADD COLUMN IF NOT EXISTS municipal_confirmation_status text NOT NULL DEFAULT 'not_reviewed'
    CHECK (municipal_confirmation_status IN ('not_reviewed','confirmed','rejected','conflicting'));

ALTER TABLE public.project_permits
  ADD CONSTRAINT project_permits_source_url_safe CHECK (source_url IS NULL OR source_url ~* '^https?://');

UPDATE public.permit_rules
SET source_owner=COALESCE(source_owner,'Issuing authority'),
    known_limitations=COALESCE(known_limitations,'Project applicability requires review against verified case facts.'),
    freshness_status=CASE WHEN review_date IS NULL THEN 'not_reviewed' ELSE freshness_status END
WHERE superseded_at IS NULL;

CREATE TABLE public.pilot_user_access (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization text,
  professional_role text,
  intended_municipality text,
  intended_case_type text,
  onboarding_date date,
  support_owner text,
  permits_access boolean NOT NULL DEFAULT false,
  underwriting_preview boolean NOT NULL DEFAULT false,
  pilot_status text NOT NULL DEFAULT 'invited'
    CHECK (pilot_status IN ('invited','active','paused','offboarded')),
  feedback_status text NOT NULL DEFAULT 'not_started'
    CHECK (feedback_status IN ('not_started','scheduled','in_progress','complete')),
  offboarding_status text NOT NULL DEFAULT 'not_started'
    CHECK (offboarding_status IN ('not_started','requested','in_progress','complete')),
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (pilot_status<>'active' OR permits_access)
);
ALTER TABLE public.pilot_user_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY pilot_user_access_self_read ON public.pilot_user_access
  FOR SELECT TO authenticated USING (user_id=auth.uid());
GRANT SELECT ON public.pilot_user_access TO authenticated;
GRANT ALL ON public.pilot_user_access TO service_role;

CREATE OR REPLACE FUNCTION public.current_product_access()
RETURNS TABLE(permits_access boolean,underwriting_preview boolean,pilot_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT COALESCE(p.permits_access,false),COALESCE(p.underwriting_preview,false),COALESCE(p.pilot_status,'not_enrolled')
 FROM (SELECT auth.uid() AS user_id) u
 LEFT JOIN public.pilot_user_access p ON p.user_id=u.user_id
$$;
REVOKE ALL ON FUNCTION public.current_product_access() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.current_product_access() TO authenticated;

CREATE OR REPLACE FUNCTION public.permit_pilot_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS (
   SELECT 1 FROM public.pilot_user_access p
   WHERE p.user_id=auth.uid() AND p.permits_access AND p.pilot_status='active'
 )
$$;
REVOKE ALL ON FUNCTION public.permit_pilot_access() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.permit_pilot_access() TO authenticated;

CREATE OR REPLACE FUNCTION public.permit_case_access(p_case_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.permit_pilot_access() AND EXISTS (
   SELECT 1 FROM public.permit_cases c WHERE c.id=p_case_id AND
   ((c.workspace_id IS NULL AND c.owner_id=auth.uid()) OR public.workspace_role(c.workspace_id) IN ('owner','admin','member','viewer'))
 )
$$;
CREATE OR REPLACE FUNCTION public.permit_case_write_access(p_case_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.permit_pilot_access() AND EXISTS (
   SELECT 1 FROM public.permit_cases c WHERE c.id=p_case_id AND
   ((c.workspace_id IS NULL AND c.owner_id=auth.uid()) OR public.workspace_role(c.workspace_id) IN ('owner','admin','member'))
 )
$$;
CREATE OR REPLACE FUNCTION public.permit_project_access(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.permit_pilot_access() AND EXISTS (
   SELECT 1 FROM public.projects p WHERE p.id=p_project_id AND
   ((p.workspace_id IS NULL AND p.owner_id=auth.uid()) OR public.workspace_role(p.workspace_id) IN ('owner','admin','member'))
 )
$$;

DROP POLICY IF EXISTS permit_cases_insert ON public.permit_cases;
DROP POLICY IF EXISTS permit_cases_insert_personal ON public.permit_cases;
DROP POLICY IF EXISTS permit_cases_insert_workspace ON public.permit_cases;
DROP POLICY IF EXISTS permit_cases_personal_select ON public.permit_cases;
DROP POLICY IF EXISTS permit_cases_personal_update ON public.permit_cases;
DROP POLICY IF EXISTS permit_cases_personal_delete ON public.permit_cases;
CREATE POLICY permit_cases_insert_personal ON public.permit_cases FOR INSERT TO authenticated
  WITH CHECK (public.permit_pilot_access() AND owner_id=auth.uid() AND workspace_id IS NULL AND project_id IS NULL);
CREATE POLICY permit_cases_insert_workspace ON public.permit_cases FOR INSERT TO authenticated
  WITH CHECK (public.permit_pilot_access() AND owner_id=auth.uid() AND workspace_id IS NOT NULL AND public.workspace_role(workspace_id) IN ('owner','admin','member'));
CREATE POLICY permit_cases_personal_select ON public.permit_cases FOR SELECT TO authenticated
  USING (public.permit_pilot_access() AND workspace_id IS NULL AND owner_id=auth.uid());
CREATE POLICY permit_cases_personal_update ON public.permit_cases FOR UPDATE TO authenticated
  USING (public.permit_pilot_access() AND workspace_id IS NULL AND owner_id=auth.uid())
  WITH CHECK (public.permit_pilot_access() AND workspace_id IS NULL AND owner_id=auth.uid());
CREATE POLICY permit_cases_personal_delete ON public.permit_cases FOR DELETE TO authenticated
  USING (public.permit_pilot_access() AND workspace_id IS NULL AND owner_id=auth.uid());

CREATE TABLE public.legal_copy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  copy_key text NOT NULL,
  version text NOT NULL,
  content text NOT NULL,
  approval_status text NOT NULL DEFAULT 'draft'
    CHECK (approval_status IN ('draft','in_review','approved','rejected','superseded')),
  approver_name text,
  approved_at timestamptz,
  effective_at timestamptz,
  supersedes_id uuid REFERENCES public.legal_copy_versions(id) ON DELETE SET NULL,
  affected_routes text[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(copy_key,version),
  CHECK (approval_status<>'approved' OR (approver_name IS NOT NULL AND approved_at IS NOT NULL))
);
ALTER TABLE public.legal_copy_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY legal_copy_effective_read ON public.legal_copy_versions FOR SELECT TO authenticated
  USING (approval_status='approved' AND effective_at IS NOT NULL AND effective_at<=now());
GRANT SELECT ON public.legal_copy_versions TO authenticated;
GRANT ALL ON public.legal_copy_versions TO service_role;

INSERT INTO public.legal_copy_versions(copy_key,version,content,approval_status,affected_routes) VALUES
 ('permit_limitations','2026-07-11-draft-1','Agir helps organize permit research and workflow. Candidate permits are not confirmed requirements. Sources can change. Confirm material requirements with the appropriate authority or professional. Agir does not provide legal advice.','draft',ARRAY['/','/permits','/permits/$caseId']),
 ('underwriting_preview','2026-07-11-draft-1','Underwriting is a Preview available only to approved users. Calculations are deterministic, but the feature is not represented as generally available.','draft',ARRAY['/','/dashboard'])
ON CONFLICT(copy_key,version) DO NOTHING;

CREATE TABLE public.permit_case_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.permit_cases(id) ON DELETE CASCADE,
  assignee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  assigned_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  responsibility text NOT NULL CHECK (length(trim(responsibility)) BETWEEN 1 AND 250),
  due_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','complete','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(case_id,assignee_id,responsibility)
);
ALTER TABLE public.permit_case_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY permit_case_assignments_read ON public.permit_case_assignments FOR SELECT TO authenticated
  USING (public.permit_case_access(case_id));
CREATE POLICY permit_case_assignments_write ON public.permit_case_assignments FOR ALL TO authenticated
  USING (public.permit_case_write_access(case_id))
  WITH CHECK (
    assigned_by=auth.uid() AND public.permit_case_write_access(case_id) AND
    EXISTS (
      SELECT 1 FROM public.permit_cases c
      WHERE c.id=case_id AND (
        (c.workspace_id IS NULL AND c.owner_id=assignee_id AND assignee_id=auth.uid()) OR
        (c.workspace_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=c.workspace_id AND m.user_id=assignee_id
        ))
      )
    )
  );

CREATE TABLE public.permit_case_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.permit_cases(id) ON DELETE CASCADE,
  from_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  to_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  initiated_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  note text NOT NULL CHECK (length(trim(note)) BETWEEN 1 AND 5000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','cancelled')),
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_user_id<>to_user_id)
);
ALTER TABLE public.permit_case_handoffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY permit_case_handoffs_read ON public.permit_case_handoffs FOR SELECT TO authenticated
  USING (public.permit_case_access(case_id) AND (to_user_id=auth.uid() OR from_user_id=auth.uid() OR public.permit_case_write_access(case_id)));
CREATE POLICY permit_case_handoffs_insert ON public.permit_case_handoffs FOR INSERT TO authenticated
  WITH CHECK (
    initiated_by=auth.uid() AND from_user_id=auth.uid() AND public.permit_case_write_access(case_id) AND
    EXISTS (
      SELECT 1 FROM public.permit_cases c
      WHERE c.id=case_id AND c.workspace_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=c.workspace_id AND m.user_id=to_user_id
      )
    )
  );

CREATE OR REPLACE FUNCTION public.respond_permit_case_handoff(p_handoff_id uuid,p_status text)
RETURNS public.permit_case_handoffs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user uuid:=auth.uid(); v_row public.permit_case_handoffs%ROWTYPE;
BEGIN
 IF p_status NOT IN ('accepted','rejected') THEN RAISE EXCEPTION 'invalid handoff response'; END IF;
 UPDATE public.permit_case_handoffs
 SET status=p_status,responded_at=now()
 WHERE id=p_handoff_id AND to_user_id=v_user AND status='pending'
 RETURNING * INTO v_row;
 IF NOT FOUND THEN RAISE EXCEPTION 'handoff not found or response not allowed'; END IF;
 IF p_status='accepted' THEN
   INSERT INTO public.permit_case_assignments(case_id,assignee_id,assigned_by,responsibility,status)
   VALUES(v_row.case_id,v_row.to_user_id,v_user,'Permit case responsibility','active')
   ON CONFLICT(case_id,assignee_id,responsibility) DO UPDATE SET
     assigned_by=excluded.assigned_by,status='active',updated_at=now();
 END IF;
 RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.respond_permit_case_handoff(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.respond_permit_case_handoff(uuid,text) TO authenticated;

CREATE TABLE public.permit_review_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid REFERENCES public.permit_cases(id) ON DELETE CASCADE,
  permit_rule_id uuid REFERENCES public.permit_rules(id) ON DELETE SET NULL,
  item_type text NOT NULL CHECK (item_type IN ('unknown_municipality','unsupported_municipality','conflicting_source','stale_source','unavailable_source','rejected_candidate','missing_document','unresolved_applicability','unresolved_paperwork','pending_handoff','overdue_action','professional_confirmation')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','dismissed')),
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  due_at timestamptz,
  summary text NOT NULL CHECK (length(trim(summary)) BETWEEN 1 AND 1000),
  resolution text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (case_id IS NOT NULL OR permit_rule_id IS NOT NULL)
);
ALTER TABLE public.permit_review_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY permit_review_items_case_read ON public.permit_review_items FOR SELECT TO authenticated
  USING (case_id IS NOT NULL AND public.permit_case_access(case_id));
CREATE POLICY permit_review_items_case_write ON public.permit_review_items FOR ALL TO authenticated
  USING (case_id IS NOT NULL AND public.permit_case_write_access(case_id))
  WITH CHECK (case_id IS NOT NULL AND created_by=auth.uid() AND public.permit_case_write_access(case_id));
GRANT SELECT ON public.permit_review_items TO authenticated;

CREATE TABLE public.permit_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid REFERENCES public.permit_cases(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('source','municipal_rule','candidate','permit','document_extraction','authority','review_date','catalogue_gap')),
  target_id uuid,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 5000),
  evidence jsonb NOT NULL DEFAULT '{}',
  reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  review_status text NOT NULL DEFAULT 'new' CHECK (review_status IN ('new','reviewing','resolved','rejected')),
  resolution text,
  resolver_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.permit_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY permit_feedback_read ON public.permit_feedback FOR SELECT TO authenticated
  USING (reporter_id=auth.uid() OR (case_id IS NOT NULL AND public.permit_case_access(case_id)));
CREATE POLICY permit_feedback_insert ON public.permit_feedback FOR INSERT TO authenticated
  WITH CHECK (reporter_id=auth.uid() AND (case_id IS NULL OR public.permit_case_access(case_id)));

CREATE TABLE public.permit_pilot_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  case_id uuid REFERENCES public.permit_cases(id) ON DELETE SET NULL,
  event_name text NOT NULL CHECK (event_name IN ('case_created','first_candidate_reviewed','candidate_accepted','candidate_rejected','handoff_completed','document_upload_failed','catalogue_gap_reported','authorization_denied','support_requested','workflow_completed','misunderstanding_observed')),
  municipality text,
  case_type text,
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds>=0),
  dimensions jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT (dimensions ?| ARRAY['address','full_address','filename','document_text','extracted_text']))
);
ALTER TABLE public.permit_pilot_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY permit_pilot_events_self_insert ON public.permit_pilot_events FOR INSERT TO authenticated
  WITH CHECK (user_id=auth.uid() AND (case_id IS NULL OR public.permit_case_access(case_id)));
GRANT INSERT ON public.permit_pilot_events TO authenticated;
GRANT USAGE,SELECT ON SEQUENCE public.permit_pilot_events_id_seq TO authenticated;

GRANT SELECT,INSERT,UPDATE,DELETE ON public.permit_case_assignments TO authenticated;
GRANT SELECT,INSERT ON public.permit_case_handoffs TO authenticated;
GRANT SELECT,INSERT ON public.permit_feedback TO authenticated;
GRANT ALL ON public.permit_case_assignments,public.permit_case_handoffs,public.permit_review_items,public.permit_feedback,public.permit_pilot_events TO service_role;

CREATE OR REPLACE FUNCTION public.audit_permit_collaboration_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_case uuid:=COALESCE(NEW.case_id,OLD.case_id); v_actor uuid:=auth.uid();
BEGIN
 IF v_actor IS NULL THEN
   v_actor:=CASE WHEN TG_TABLE_NAME='permit_case_assignments' THEN COALESCE(NEW.assigned_by,OLD.assigned_by)
                 ELSE COALESCE(NEW.initiated_by,OLD.initiated_by) END;
 END IF;
 INSERT INTO public.permit_case_history(case_id,action,previous_data,new_data,changed_by)
 VALUES(v_case,TG_TABLE_NAME||'_'||lower(TG_OP),CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,
        CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END,v_actor);
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER permit_case_assignments_audit AFTER INSERT OR UPDATE OR DELETE ON public.permit_case_assignments
  FOR EACH ROW EXECUTE FUNCTION public.audit_permit_collaboration_change();
CREATE TRIGGER permit_case_handoffs_audit AFTER INSERT OR UPDATE OR DELETE ON public.permit_case_handoffs
  FOR EACH ROW EXECUTE FUNCTION public.audit_permit_collaboration_change();

CREATE OR REPLACE VIEW public.permit_professional_review_queue WITH (security_invoker=true) AS
SELECT i.id,i.case_id,i.permit_rule_id,i.item_type,i.status,i.assigned_to,i.due_at,i.summary,i.created_at,
       CASE WHEN i.status IN ('open','in_progress') AND i.due_at<now() THEN true ELSE false END AS overdue
FROM public.permit_review_items i
WHERE i.status IN ('open','in_progress');
GRANT SELECT ON public.permit_professional_review_queue TO authenticated,service_role;

-- Ordinary users cannot forge trusted timestamps or actors in permit history.
REVOKE INSERT,UPDATE,DELETE ON public.permit_case_history,public.permit_history FROM authenticated;
