-- PostgreSQL 17 no longer resolves digest(text, text) through the historical
-- implicit text-to-bytea cast. Keep the canonical text representation exactly
-- as before and make UTF-8 encoding explicit before hashing.
--
-- This is forward-only: it changes neither stored chain rows nor permissions.
-- Existing rows remain verifiable because the former implicit conversion and
-- convert_to(..., 'UTF8') produce the same SHA-256 input bytes.

CREATE OR REPLACE FUNCTION public.audit_log_row_hash(p_prev_hash TEXT, p_canonical TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(
    digest(convert_to(p_prev_hash || '|' || p_canonical, 'UTF8'), 'sha256'),
    'hex'
  );
$$;
