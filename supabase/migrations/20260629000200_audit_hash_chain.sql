-- Tamper-evident hash chain over the append-only audit_logs.
--
-- Each row is linked to its predecessor (per project_id chain) via
--   row_hash = sha256(prev_hash || '|' || canonical(row))
-- The chain is computed in a BEFORE INSERT trigger so neither application code
-- nor service_role can forge or backdate an entry: the seq/prev_hash/row_hash
-- columns are always recomputed in the database, ignoring anything the caller
-- supplies. Combined with the existing append-only trigger (UPDATE/DELETE
-- rejected) this gives an institutional-grade, verifiable decision audit.
--
-- Verification is also performed in SQL (public.verify_audit_chain) so the
-- canonicalization used to verify is identical, by construction, to the one
-- used to write -- there is no TS/SQL serialization-mismatch risk.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS seq BIGINT,
  ADD COLUMN IF NOT EXISTS prev_hash TEXT,
  ADD COLUMN IF NOT EXISTS row_hash TEXT;

-- Deterministic, timezone-independent canonicalization of a logical audit row.
-- payload uses jsonb::text (Postgres-normalized key order) and the timestamp
-- uses epoch microseconds so the digest never depends on session timezone.
CREATE OR REPLACE FUNCTION public.audit_log_canonical(
  p_seq BIGINT,
  p_project_id UUID,
  p_owner_id UUID,
  p_user_id UUID,
  p_entity_type TEXT,
  p_entity_id UUID,
  p_action TEXT,
  p_payload JSONB,
  p_created_at TIMESTAMPTZ
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT concat_ws(
    '|',
    p_seq::text,
    coalesce(p_project_id::text, ''),
    coalesce(p_owner_id::text, ''),
    coalesce(p_user_id::text, ''),
    coalesce(p_entity_type, ''),
    coalesce(p_entity_id::text, ''),
    coalesce(p_action, ''),
    coalesce(p_payload::text, 'null'),
    (extract(epoch from p_created_at) * 1000000)::bigint::text
  );
$$;

CREATE OR REPLACE FUNCTION public.audit_log_row_hash(p_prev_hash TEXT, p_canonical TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(digest(p_prev_hash || '|' || p_canonical, 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.audit_logs_chain_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_lock_key BIGINT;
  v_prev TEXT;
  v_seq BIGINT;
  v_canonical TEXT;
BEGIN
  -- Serialize concurrent inserts on the same per-project chain so seq and the
  -- prev->row linkage stay strictly ordered. NULL project rows share one chain.
  v_lock_key := hashtextextended(coalesce(NEW.project_id::text, '__global__'), 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT a.seq, a.row_hash
    INTO v_seq, v_prev
    FROM public.audit_logs a
   WHERE a.project_id IS NOT DISTINCT FROM NEW.project_id
   ORDER BY a.seq DESC NULLS LAST
   LIMIT 1;

  NEW.seq := coalesce(v_seq, 0) + 1;
  NEW.prev_hash := coalesce(v_prev, repeat('0', 64));
  v_canonical := public.audit_log_canonical(
    NEW.seq, NEW.project_id, NEW.owner_id, NEW.user_id,
    NEW.entity_type, NEW.entity_id, NEW.action, NEW.payload, NEW.created_at
  );
  NEW.row_hash := public.audit_log_row_hash(NEW.prev_hash, v_canonical);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_chain ON public.audit_logs;
CREATE TRIGGER audit_logs_chain
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_logs_chain_insert();

-- Backfill existing rows into the chain (one-time), per project, by created_at.
-- The append-only guard is toggled OUTSIDE the DO block: ALTER TABLE is not
-- permitted while a row cursor over the same table is open in the session.
ALTER TABLE public.audit_logs DISABLE TRIGGER audit_logs_append_only;

DO $$
DECLARE
  r RECORD;
  v_prev TEXT;
  v_seq BIGINT;
  v_last_project UUID;
  v_first BOOLEAN := true;
  v_canonical TEXT;
BEGIN
  FOR r IN
    SELECT * FROM public.audit_logs
    ORDER BY project_id NULLS FIRST, created_at ASC, id ASC
  LOOP
    IF v_first OR r.project_id IS DISTINCT FROM v_last_project THEN
      v_prev := repeat('0', 64);
      v_seq := 0;
      v_last_project := r.project_id;
      v_first := false;
    END IF;
    v_seq := v_seq + 1;
    v_canonical := public.audit_log_canonical(
      v_seq, r.project_id, r.owner_id, r.user_id,
      r.entity_type, r.entity_id, r.action, r.payload, r.created_at
    );
    UPDATE public.audit_logs
       SET seq = v_seq,
           prev_hash = v_prev,
           row_hash = public.audit_log_row_hash(v_prev, v_canonical)
     WHERE id = r.id;
    v_prev := public.audit_log_row_hash(v_prev, v_canonical);
  END LOOP;
END;
$$;

ALTER TABLE public.audit_logs ENABLE TRIGGER audit_logs_append_only;

-- Verify the chain for a project (or the NULL-project global chain).
-- Runs as SECURITY INVOKER so audit_logs RLS still restricts visibility:
-- a caller can only verify chains for projects they are allowed to read.
CREATE OR REPLACE FUNCTION public.verify_audit_chain(p_project UUID)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  r RECORD;
  v_prev TEXT := repeat('0', 64);
  v_expected_seq BIGINT := 0;
  v_count BIGINT := 0;
  v_canonical TEXT;
  v_expected_hash TEXT;
BEGIN
  FOR r IN
    SELECT * FROM public.audit_logs
     WHERE project_id IS NOT DISTINCT FROM p_project
     ORDER BY seq ASC
  LOOP
    v_count := v_count + 1;
    v_expected_seq := v_expected_seq + 1;
    IF r.seq IS DISTINCT FROM v_expected_seq THEN
      RETURN jsonb_build_object(
        'valid', false, 'reason', 'seq_gap',
        'broken_seq', r.seq, 'broken_id', r.id, 'total', v_count);
    END IF;
    IF r.prev_hash IS DISTINCT FROM v_prev THEN
      RETURN jsonb_build_object(
        'valid', false, 'reason', 'prev_hash_mismatch',
        'broken_seq', r.seq, 'broken_id', r.id, 'total', v_count);
    END IF;
    v_canonical := public.audit_log_canonical(
      r.seq, r.project_id, r.owner_id, r.user_id,
      r.entity_type, r.entity_id, r.action, r.payload, r.created_at
    );
    v_expected_hash := public.audit_log_row_hash(v_prev, v_canonical);
    IF r.row_hash IS DISTINCT FROM v_expected_hash THEN
      RETURN jsonb_build_object(
        'valid', false, 'reason', 'row_hash_mismatch',
        'broken_seq', r.seq, 'broken_id', r.id, 'total', v_count);
    END IF;
    v_prev := r.row_hash;
  END LOOP;
  RETURN jsonb_build_object(
    'valid', true, 'reason', null,
    'broken_seq', null, 'broken_id', null, 'total', v_count,
    'head_hash', CASE WHEN v_count > 0 THEN v_prev ELSE null END);
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_audit_chain(UUID) TO authenticated;
