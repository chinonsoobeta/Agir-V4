-- Governance extensions: external authorities, source reviews, reviewed
-- extraction candidates, and a disabled-by-default parcel/zoning boundary.
ALTER TABLE public.permit_rules
  ADD COLUMN IF NOT EXISTS authority_scope text NOT NULL DEFAULT 'municipal',
  ADD COLUMN IF NOT EXISTS supersedes_rule_id uuid REFERENCES public.permit_rules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_review_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_content_hash text;

CREATE TABLE public.permit_rule_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_rule_id uuid NOT NULL REFERENCES public.permit_rules(id) ON DELETE CASCADE,
  reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_status text NOT NULL CHECK (review_status IN ('pending','verified','changed','unavailable','rejected')),
  source_url text NOT NULL,
  source_title text,
  source_text text,
  source_content_hash text,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  next_review_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.permit_extraction_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  jurisdiction_id uuid REFERENCES public.jurisdictions(id) ON DELETE SET NULL,
  candidate_name text NOT NULL,
  permit_type text,
  description text,
  processing_duration_text text,
  processing_duration_days numeric,
  authority_name text,
  source_location text NOT NULL,
  source_text text NOT NULL,
  confidence_score numeric CHECK (confidence_score BETWEEN 0 AND 1),
  review_status text NOT NULL DEFAULT 'needs_review' CHECK (review_status IN ('needs_review','accepted','rejected')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_reason text,
  project_permit_id uuid REFERENCES public.project_permits(id) ON DELETE SET NULL,
  extraction_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (processing_duration_days IS NULL OR processing_duration_text IS NOT NULL),
  UNIQUE(document_id, candidate_name, source_location, extraction_version)
);

CREATE TABLE public.authoritative_land_data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_id uuid NOT NULL REFERENCES public.jurisdictions(id) ON DELETE CASCADE,
  source_name text NOT NULL,
  source_url text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('parcel','address','zoning','bylaw','gis')),
  licensing_status text NOT NULL DEFAULT 'not_reviewed' CHECK (licensing_status IN ('not_reviewed','approved','restricted','prohibited')),
  integration_status text NOT NULL DEFAULT 'disabled' CHECK (integration_status IN ('disabled','evaluation','active','suspended')),
  update_frequency text,
  boundary_notes text,
  last_verified_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(jurisdiction_id, source_name)
);

CREATE INDEX permit_rule_reviews_rule_idx ON public.permit_rule_reviews(permit_rule_id, reviewed_at DESC);
CREATE INDEX permit_rules_next_review_idx ON public.permit_rules(next_review_at) WHERE superseded_at IS NULL;
CREATE INDEX permit_candidates_project_idx ON public.permit_extraction_candidates(project_id, review_status, created_at DESC);
CREATE INDEX permit_candidates_document_idx ON public.permit_extraction_candidates(document_id);

ALTER TABLE public.permit_rule_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permit_extraction_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authoritative_land_data_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY permit_rule_reviews_read ON public.permit_rule_reviews FOR SELECT TO authenticated USING (true);
CREATE POLICY permit_rule_reviews_service ON public.permit_rule_reviews FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY land_sources_read ON public.authoritative_land_data_sources FOR SELECT TO authenticated USING (true);
CREATE POLICY land_sources_service ON public.authoritative_land_data_sources FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY permit_candidates_all ON public.permit_extraction_candidates FOR ALL TO authenticated
  USING (public.permit_project_access(project_id))
  WITH CHECK (owner_id=auth.uid() AND public.permit_project_access(project_id)
    AND EXISTS (SELECT 1 FROM public.documents d WHERE d.id=document_id AND d.project_id=project_id));

GRANT SELECT ON public.permit_rule_reviews,public.authoritative_land_data_sources TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.permit_extraction_candidates TO authenticated;
GRANT ALL ON public.permit_rule_reviews,public.authoritative_land_data_sources,public.permit_extraction_candidates TO service_role;

INSERT INTO public.jurisdictions(name,province,regional_area,jurisdiction_type,official_url,permit_portal_url,last_verified_at) VALUES
 ('Technical Safety BC','British Columbia',NULL,'provincial_safety_authority','https://www.technicalsafetybc.ca/','https://www.technicalsafetybc.ca/apply-for/permits','2026-07-10'),
 ('Government of British Columbia','British Columbia',NULL,'provincial_government','https://www2.gov.bc.ca/','https://www2.gov.bc.ca/gov/content/employment-business/economic-development/permits-licences','2026-07-10'),
 ('Vancouver Coastal Health','British Columbia',NULL,'health_authority','https://www.vch.ca/','https://www.vch.ca/en/service/environmental-health-inspections','2026-07-10'),
 ('Fraser Health','British Columbia',NULL,'health_authority','https://www.fraserhealth.ca/','https://www.fraserhealth.ca/health-topics-a-to-z/food-safety','2026-07-10'),
 ('Metro Vancouver','British Columbia','Metro Vancouver','regional_district','https://metrovancouver.org/','https://metrovancouver.org/services/permits-regulations-enforcement','2026-07-10'),
 ('BC Hydro','British Columbia',NULL,'utility','https://www.bchydro.com/','https://app.bchydro.com/accounts-billing/electrical-connections.html','2026-07-10'),
 ('FortisBC','British Columbia',NULL,'utility','https://www.fortisbc.com/','https://www.fortisbc.com/services','2026-07-10'),
 ('Fisheries and Oceans Canada','British Columbia',NULL,'federal_government','https://www.dfo-mpo.gc.ca/','https://www.dfo-mpo.gc.ca/pnw-ppe/index-eng.html','2026-07-10')
ON CONFLICT(name,province) DO UPDATE SET last_verified_at=excluded.last_verified_at;

WITH external_rules(authority,name,ptype,description,url,title,text) AS (VALUES
 ('Technical Safety BC','Electrical safety permit review','electrical','Possible external safety-authority involvement; jurisdiction and work scope must be verified.','https://www.technicalsafetybc.ca/apply-for/permits','Technical Safety BC permits','Technical Safety BC publishes permit services. Municipal and Technical Safety BC jurisdiction must be confirmed for the specific installation.'),
 ('Technical Safety BC','Gas safety permit review','mechanical_hvac','Possible external safety-authority involvement; jurisdiction and work scope must be verified.','https://www.technicalsafetybc.ca/apply-for/permits','Technical Safety BC permits','Technical Safety BC publishes gas permit services. Authority depends on the installation and safety jurisdiction.'),
 ('Vancouver Coastal Health','Health authority approval review','health','Possible health-authority review for projects in the VCH service area; no requirement is inferred.','https://www.vch.ca/en/service/environmental-health-inspections','Environmental health inspections','Vancouver Coastal Health publishes environmental health inspection services.'),
 ('Fraser Health','Health authority approval review','health','Possible health-authority review for projects in the Fraser Health service area; no requirement is inferred.','https://www.fraserhealth.ca/health-topics-a-to-z/food-safety','Fraser Health food safety','Fraser Health publishes health approval and inspection information.'),
 ('Metro Vancouver','Regional permit or regulation review','regional','Possible regional-district involvement; Metro Vancouver is not treated as the municipal permitting authority.','https://metrovancouver.org/services/permits-regulations-enforcement','Permits, regulations and enforcement','Metro Vancouver publishes regional permits and regulatory services.'),
 ('BC Hydro','Electrical service connection review','utility','Possible utility service review; no connection requirement is inferred.','https://app.bchydro.com/accounts-billing/electrical-connections.html','BC Hydro electrical connections','BC Hydro publishes electrical connection services.'),
 ('FortisBC','Utility service review','utility','Possible gas or electric utility service review; no requirement is inferred.','https://www.fortisbc.com/services','FortisBC services','FortisBC publishes utility services and connection information.'),
 ('Government of British Columbia','Provincial permit review','provincial','Possible provincial approval depending on verified land, environmental, transportation, or project facts.','https://www2.gov.bc.ca/gov/content/employment-business/economic-development/permits-licences','BC permits and licences','The Province publishes a directory of permits and licences.'),
 ('Fisheries and Oceans Canada','Federal aquatic review','federal','Possible federal review only where verified work may affect fish or fish habitat.','https://www.dfo-mpo.gc.ca/pnw-ppe/index-eng.html','Projects near water','Fisheries and Oceans Canada publishes project review information for works near water.')
)
INSERT INTO public.permit_rules(jurisdiction_id,name,permit_type,description,applicability_conditions,official_source_url,source_title,source_text,application_url,review_date,next_review_at,rule_version,verification_status,authority_scope)
SELECT j.id,e.name,e.ptype,e.description,'Cannot be determined without verified project and jurisdiction facts.',e.url,e.title,e.text,e.url,'2026-07-10','2027-01-10','2026-07-10-external','potentially_applicable','external'
FROM external_rules e JOIN public.jurisdictions j ON j.name=e.authority
ON CONFLICT(jurisdiction_id,name,rule_version) DO NOTHING;

UPDATE public.permit_rules SET next_review_at=COALESCE(next_review_at,'2027-01-10'::timestamptz)
WHERE superseded_at IS NULL;

-- These are extension points only. No automatic parcel or zoning lookup is enabled.
INSERT INTO public.authoritative_land_data_sources(jurisdiction_id,source_name,source_url,source_type,licensing_status,integration_status,boundary_notes)
SELECT id,name || ' authoritative parcel/zoning source review',official_url,'gis','not_reviewed','disabled',
 'Future integration must verify licensing, parcel matching, municipal boundaries, update cadence, and bylaw versioning.'
FROM public.jurisdictions WHERE jurisdiction_type='municipality'
ON CONFLICT(jurisdiction_id,source_name) DO NOTHING;

CREATE OR REPLACE VIEW public.permit_rule_review_queue AS
SELECT r.id,r.jurisdiction_id,j.name AS jurisdiction_name,r.name,r.permit_type,r.official_source_url,
 r.verification_status,r.rule_version,r.next_review_at,
 CASE WHEN r.next_review_at IS NULL THEN 'unscheduled' WHEN r.next_review_at<=now() THEN 'overdue' ELSE 'scheduled' END AS review_state
FROM public.permit_rules r JOIN public.jurisdictions j ON j.id=r.jurisdiction_id
WHERE r.superseded_at IS NULL;
GRANT SELECT ON public.permit_rule_review_queue TO authenticated,service_role;
