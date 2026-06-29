-- Rollback for 20260629000200_audit_hash_chain.
-- Drops the hash-chain trigger/functions and columns. The append-only trigger
-- and historical rows are untouched (only the chain metadata is removed).
DROP TRIGGER IF EXISTS audit_logs_chain ON public.audit_logs;
DROP FUNCTION IF EXISTS public.audit_logs_chain_insert();
DROP FUNCTION IF EXISTS public.verify_audit_chain(UUID);
DROP FUNCTION IF EXISTS public.audit_log_row_hash(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.audit_log_canonical(BIGINT, UUID, UUID, UUID, TEXT, UUID, TEXT, JSONB, TIMESTAMPTZ);
ALTER TABLE public.audit_logs
  DROP COLUMN IF EXISTS seq,
  DROP COLUMN IF EXISTS prev_hash,
  DROP COLUMN IF EXISTS row_hash;
