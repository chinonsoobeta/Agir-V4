-- Phase 1 corrective migration for the pilot remediation program.
-- MIGRATION_SAFETY_REVIEW: policy and grant replacement intentionally removes
-- customer access to internal operational evidence. Search-session data is
-- retained for bounded service-role cleanup; no customer data is deleted here.

-- Internal reviewer identities, notes, source errors, excerpts, and evidence
-- URLs are service-side operational data, not tenant-readable catalogue data.
DROP POLICY IF EXISTS municipal_source_snapshots_read ON public.municipal_source_snapshots;
DROP POLICY IF EXISTS permit_review_assignments_read ON public.permit_review_assignments;
DROP POLICY IF EXISTS pilot_external_signoffs_read ON public.pilot_external_signoffs;
REVOKE ALL ON public.municipal_source_snapshots FROM authenticated;
REVOKE ALL ON public.permit_review_assignments FROM authenticated;
REVOKE ALL ON public.pilot_external_signoffs FROM authenticated;

-- The aggregate gates are release tooling inputs. Keeping them service-only
-- also prevents a definer-view path around the restricted base tables.
REVOKE ALL ON public.municipal_catalogue_release_gate FROM authenticated;
REVOKE ALL ON public.pilot_external_release_gate FROM authenticated;
GRANT SELECT ON public.municipal_catalogue_release_gate TO service_role;
GRANT SELECT ON public.pilot_external_release_gate TO service_role;

-- Set membership is checked directly. Stale approval rows for withdrawn
-- categories cannot compensate for an unapproved active category, and an
-- empty source set deterministically fails closed.
CREATE OR REPLACE VIEW public.municipal_catalogue_release_gate AS
SELECT
  j.id AS jurisdiction_id,
  j.name AS jurisdiction_name,
  j.coverage_status,
  (SELECT count(DISTINCT r.permit_type)
   FROM public.permit_rules r
   WHERE r.jurisdiction_id=j.id AND r.superseded_at IS NULL) AS active_category_count,
  (SELECT count(DISTINCT a.permit_type)
   FROM public.permit_review_assignments a
   WHERE a.jurisdiction_id=j.id AND a.status='approved'
     AND EXISTS (
       SELECT 1 FROM public.permit_rules r
       WHERE r.jurisdiction_id=j.id AND r.permit_type=a.permit_type
         AND r.superseded_at IS NULL
     )) AS approved_category_count,
  (SELECT count(DISTINCT r.permit_type)
   FROM public.permit_rules r
   WHERE r.jurisdiction_id=j.id AND r.superseded_at IS NULL
     AND r.source_content_hash IS NOT NULL
     AND r.verification_status='verified'
     AND r.next_review_at>now()) AS current_evidence_category_count,
  (EXISTS (
     SELECT 1 FROM public.municipal_research_sources s
     WHERE s.jurisdiction_id=j.id
   ) AND NOT EXISTS (
     SELECT 1 FROM public.municipal_research_sources s
     WHERE s.jurisdiction_id=j.id
       AND NOT (s.integrity_status='current' AND s.next_check_at>now())
   )) AS sources_current,
  (coalesce(j.coverage_status='reviewed',false)
   AND EXISTS (
     SELECT 1 FROM public.permit_rules r
     WHERE r.jurisdiction_id=j.id AND r.superseded_at IS NULL
   )
   AND NOT EXISTS (
     SELECT 1 FROM public.permit_rules r
     WHERE r.jurisdiction_id=j.id AND r.superseded_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.permit_review_assignments a
         WHERE a.jurisdiction_id=j.id AND a.permit_type=r.permit_type
           AND a.status='approved'
       )
   )
   AND NOT EXISTS (
     SELECT 1 FROM public.permit_rules r
     WHERE r.jurisdiction_id=j.id AND r.superseded_at IS NULL
       AND (r.source_content_hash IS NULL
         OR r.verification_status IS DISTINCT FROM 'verified'
         OR r.next_review_at IS NULL OR r.next_review_at<=now())
   )
   AND EXISTS (
     SELECT 1 FROM public.municipal_research_sources s
     WHERE s.jurisdiction_id=j.id
   )
   AND NOT EXISTS (
     SELECT 1 FROM public.municipal_research_sources s
     WHERE s.jurisdiction_id=j.id
       AND NOT (s.integrity_status='current' AND s.next_check_at>now())
   )) AS release_ready
FROM public.jurisdictions j
WHERE j.jurisdiction_type='municipality';
REVOKE ALL ON public.municipal_catalogue_release_gate FROM authenticated;
GRANT SELECT ON public.municipal_catalogue_release_gate TO service_role;

-- Immutable snapshot sessions are retired. The application again uses the
-- existing read-only keyset RPC, which evaluates RLS on every page request.
REVOKE ALL ON public.property_search_sessions FROM authenticated;
REVOKE ALL ON public.property_search_session_items FROM authenticated;
REVOKE ALL ON FUNCTION public.create_property_search_session(
  uuid,text,text,text,numeric,numeric,boolean
) FROM authenticated;
REVOKE ALL ON FUNCTION public.get_property_search_session_page(uuid,integer,integer)
  FROM authenticated;
