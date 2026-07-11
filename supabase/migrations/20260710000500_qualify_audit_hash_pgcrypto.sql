-- SECURITY DEFINER lifecycle RPCs pin search_path to public. On Supabase,
-- pgcrypto functions live in the extensions schema, so qualify digest rather
-- than relying on the caller search path.
--
-- This supersedes the bytea conversion-only compatibility repair while
-- retaining the identical canonical UTF-8 SHA-256 algorithm.

CREATE OR REPLACE FUNCTION public.audit_log_row_hash(p_prev_hash TEXT, p_canonical TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(
    extensions.digest(convert_to(p_prev_hash || '|' || p_canonical, 'UTF8'), 'sha256'),
    'hex'
  );
$$;
