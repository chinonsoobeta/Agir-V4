-- Scheduled source governance runs with the service role. BYPASSRLS does not
-- replace table privileges, so grant the narrow catalogue/review permissions.
GRANT SELECT,INSERT,UPDATE ON public.jurisdictions,public.permit_rules TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.permit_rule_reviews TO service_role;
GRANT SELECT ON public.permit_rule_review_queue TO service_role;
