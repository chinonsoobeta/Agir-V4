-- Reverse of 20260705000100_underwriting_run_transaction_rpc.sql.
-- The migration only adds the transactional persistence RPC; prior
-- underwriting_runs grants and policies are left unchanged by the forward
-- migration, so rollback must not broaden them.

DROP FUNCTION IF EXISTS public.persist_underwriting_run_transaction(
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  JSONB,
  JSONB,
  JSONB,
  JSONB,
  JSONB,
  JSONB,
  JSONB,
  JSONB,
  JSONB,
  JSONB,
  UUID,
  JSONB
);

NOTIFY pgrst, 'reload schema';
