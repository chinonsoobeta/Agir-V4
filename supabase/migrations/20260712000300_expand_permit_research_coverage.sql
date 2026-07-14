-- Expand Permit research to all 21 Metro Vancouver municipalities plus Kelowna.
-- Coverage labels are explicit: placeholder category rows are research gaps,
-- never automatic requirements or claims of municipal review.

ALTER TABLE public.jurisdictions
  ADD COLUMN IF NOT EXISTS coverage_status text NOT NULL DEFAULT 'not_started'
    CHECK (coverage_status IN ('not_started','partial','reviewed')),
  ADD COLUMN IF NOT EXISTS coverage_summary text,
  ADD COLUMN IF NOT EXISTS coverage_updated_at timestamptz;

ALTER TABLE public.permit_cases
  ADD COLUMN IF NOT EXISTS address_line_2 text,
  ADD COLUMN IF NOT EXISTS building_name text,
  ADD COLUMN IF NOT EXISTS address_provider text,
  ADD COLUMN IF NOT EXISTS address_place_id text,
  ADD COLUMN IF NOT EXISTS latitude numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric,
  ADD CONSTRAINT permit_cases_latitude_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT permit_cases_longitude_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS address_line_2 text,
  ADD COLUMN IF NOT EXISTS building_name text,
  ADD COLUMN IF NOT EXISTS address_provider text,
  ADD COLUMN IF NOT EXISTS address_place_id text,
  ADD COLUMN IF NOT EXISTS latitude numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric;
ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_latitude_range,
  DROP CONSTRAINT IF EXISTS projects_longitude_range;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_latitude_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT projects_longitude_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);

WITH municipalities(name, official_url) AS (VALUES
  ('Village of Anmore','https://anmore.com/'),
  ('Village of Belcarra','https://belcarra.ca/'),
  ('Bowen Island Municipality','https://bowenislandmunicipality.ca/'),
  ('City of Burnaby','https://www.burnaby.ca/'),
  ('City of Coquitlam','https://www.coquitlam.ca/'),
  ('City of Delta','https://www.delta.ca/'),
  ('City of Langley','https://city.langley.bc.ca/'),
  ('Township of Langley','https://www.tol.ca/'),
  ('Village of Lions Bay','https://www.lionsbay.ca/'),
  ('City of Maple Ridge','https://www.mapleridge.ca/'),
  ('City of New Westminster','https://www.newwestcity.ca/'),
  ('City of North Vancouver','https://www.cnv.org/'),
  ('District of North Vancouver','https://www.dnv.org/'),
  ('City of Pitt Meadows','https://www.pittmeadows.ca/'),
  ('City of Port Coquitlam','https://www.portcoquitlam.ca/'),
  ('City of Port Moody','https://www.portmoody.ca/'),
  ('City of Richmond','https://www.richmond.ca/'),
  ('City of Surrey','https://www.surrey.ca/'),
  ('City of Vancouver','https://vancouver.ca/'),
  ('District of West Vancouver','https://westvancouver.ca/'),
  ('City of White Rock','https://www.whiterockcity.ca/'),
  ('City of Kelowna','https://www.kelowna.ca/')
)
INSERT INTO public.jurisdictions(
  name,province,regional_area,jurisdiction_type,official_url,permit_portal_url,
  active,coverage_status,coverage_summary,coverage_updated_at
)
SELECT name,'British Columbia',
  CASE WHEN name='City of Kelowna' THEN NULL ELSE 'Metro Vancouver' END,
  'municipality',official_url,official_url,true,
  CASE WHEN name IN (
    'City of Burnaby','City of Coquitlam','City of Kelowna','City of New Westminster',
    'City of Richmond','City of Surrey','City of Vancouver'
  ) THEN 'partial' ELSE 'not_started' END,
  CASE WHEN name IN (
    'City of Burnaby','City of Coquitlam','City of Kelowna','City of New Westminster',
    'City of Richmond','City of Surrey','City of Vancouver'
  ) THEN 'Some official category sources are recorded; case applicability still requires review.'
    ELSE 'Municipality available for research. Category-specific official source review is pending.' END,
  now()
FROM municipalities
ON CONFLICT(name,province) DO UPDATE SET
  regional_area=excluded.regional_area,
  official_url=excluded.official_url,
  active=true,
  coverage_status=CASE
    WHEN public.jurisdictions.coverage_status='reviewed' THEN 'reviewed'
    ELSE excluded.coverage_status
  END,
  coverage_summary=CASE
    WHEN public.jurisdictions.coverage_status='reviewed'
      THEN public.jurisdictions.coverage_summary
    ELSE excluded.coverage_summary
  END,
  coverage_updated_at=CASE
    WHEN public.jurisdictions.coverage_status='reviewed'
      THEN public.jurisdictions.coverage_updated_at
    ELSE excluded.coverage_updated_at
  END;

WITH categories(permit_type,label) AS (VALUES
  ('building','Building permit'),('development','Development permit'),
  ('zoning_land_use','Zoning or land-use approval'),('plumbing','Plumbing permit'),
  ('electrical','Electrical permit'),('mechanical_hvac','Mechanical or HVAC permit'),
  ('demolition','Demolition permit'),('tenant_improvement','Tenant improvement permit'),
  ('occupancy_change_of_use','Occupancy or change-of-use approval'),
  ('fire_life_safety','Fire or life-safety approval'),('tree','Tree permit'),
  ('heritage','Heritage approval'),('environmental_site','Environmental or site-related approval'),
  ('excavation_shoring_servicing','Excavation, shoring, or servicing approval')
), new_coverage AS (
  SELECT j.id,j.name,j.official_url,j.permit_portal_url
  FROM public.jurisdictions j
  WHERE j.jurisdiction_type='municipality' AND j.active
    AND j.name = ANY (ARRAY[
      'Village of Anmore','Village of Belcarra','Bowen Island Municipality',
      'City of Burnaby','City of Coquitlam','City of Delta','City of Langley',
      'Township of Langley','Village of Lions Bay','City of Maple Ridge',
      'City of New Westminster','City of North Vancouver',
      'District of North Vancouver','City of Pitt Meadows','City of Port Coquitlam',
      'City of Port Moody','City of Richmond','City of Surrey','City of Vancouver',
      'District of West Vancouver','City of White Rock','City of Kelowna'
    ]::text[])
    AND j.name NOT IN (
      'City of Burnaby','City of Coquitlam','City of Kelowna','City of New Westminster',
      'City of Richmond','City of Surrey','City of Vancouver'
    )
)
INSERT INTO public.permit_rules(
  jurisdiction_id,name,permit_type,description,applicability_conditions,
  official_source_url,source_title,source_text,application_url,rule_version,
  verification_status,authority_scope,source_owner,freshness_status,
  official_source_status,availability_status,known_limitations
)
SELECT j.id,c.label,c.permit_type,
  'Research coverage for this category is not complete.',
  'Review the project scope and a current official municipal source before deciding whether this applies.',
  j.official_url,j.name || ' official website',
  'No category-specific official source has been reviewed for this municipality yet.',
  j.permit_portal_url,'2026-07-12-coverage-v1','unknown','municipal',
  'Issuing authority','not_reviewed','unknown','unknown',
  'Coverage placeholder only. This row is not a permit requirement.'
FROM new_coverage j CROSS JOIN categories c
ON CONFLICT(jurisdiction_id,name,rule_version) DO NOTHING;

-- Existing candidate rows are evidence and are never deleted by this coverage
-- migration. The UI groups legacy duplicates for readability, and all future
-- generation deduplicates before writing.

-- Permit-document evidence is available for standalone cases as well as deals.
ALTER TABLE public.permit_extraction_candidates
  ADD COLUMN IF NOT EXISTS permit_case_id uuid REFERENCES public.permit_cases(id) ON DELETE CASCADE;
ALTER TABLE public.permit_extraction_candidates ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE public.permit_extraction_candidates
  ADD CONSTRAINT permit_extraction_candidate_parent CHECK (
    project_id IS NOT NULL OR permit_case_id IS NOT NULL
  );
CREATE INDEX IF NOT EXISTS permit_candidates_case_idx
  ON public.permit_extraction_candidates(permit_case_id,review_status,created_at DESC)
  WHERE permit_case_id IS NOT NULL;

DROP POLICY IF EXISTS permit_candidates_all ON public.permit_extraction_candidates;
CREATE POLICY permit_candidates_all ON public.permit_extraction_candidates FOR ALL TO authenticated
  USING (
    (permit_case_id IS NOT NULL AND public.permit_case_access(permit_case_id)) OR
    (project_id IS NOT NULL AND public.permit_project_access(project_id))
  )
  WITH CHECK (
    owner_id=auth.uid() AND (
      (permit_case_id IS NOT NULL AND public.permit_case_write_access(permit_case_id) AND EXISTS (
        SELECT 1 FROM public.documents d
        WHERE d.id=document_id AND d.permit_case_id=permit_extraction_candidates.permit_case_id
      )) OR
      (project_id IS NOT NULL AND public.permit_project_access(project_id) AND EXISTS (
        SELECT 1 FROM public.documents d
        WHERE d.id=document_id AND d.project_id=permit_extraction_candidates.project_id
      ))
    )
  );
