-- Product access is open to every authenticated user. Workspace roles, record
-- ownership, and all case-level authorization checks remain authoritative.

CREATE OR REPLACE FUNCTION public.current_product_access()
RETURNS TABLE(permits_access boolean,underwriting_preview boolean,pilot_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT true, true, 'general_access'::text
  WHERE auth.uid() IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.current_product_access() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.current_product_access() TO authenticated;

CREATE OR REPLACE FUNCTION public.permit_pilot_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.permit_pilot_access() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.permit_pilot_access() TO authenticated;
