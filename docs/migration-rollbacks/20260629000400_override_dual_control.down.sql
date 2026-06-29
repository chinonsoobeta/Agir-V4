-- Rollback for 20260629000400_override_dual_control.
ALTER TABLE public.assumptions DROP CONSTRAINT IF EXISTS assumptions_dual_control_distinct_check;
ALTER TABLE public.assumptions
  DROP COLUMN IF EXISTS override_reason,
  DROP COLUMN IF EXISTS requires_dual_control,
  DROP COLUMN IF EXISTS dual_control_pending,
  DROP COLUMN IF EXISTS second_approval_by,
  DROP COLUMN IF EXISTS second_approval_at,
  DROP COLUMN IF EXISTS second_approver_name;
