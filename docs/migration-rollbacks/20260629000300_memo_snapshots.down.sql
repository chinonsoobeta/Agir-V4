-- Rollback for 20260629000300_memo_snapshots.
DROP TRIGGER IF EXISTS memo_snapshots_append_only ON public.memo_snapshots;
DROP FUNCTION IF EXISTS public.reject_memo_snapshot_mutation();
DROP TABLE IF EXISTS public.memo_snapshots;
