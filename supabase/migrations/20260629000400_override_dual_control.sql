-- Per-field override provenance + dual-control on material overrides.
--
-- An analyst override (which wins over extraction) already records approved_by
-- / approved_at. This adds an explicit override reason and a two-person rule for
-- MATERIAL fields (debt, cap rate, equity, ...): such an override is staged as
-- dual_control_pending and is NOT propagated to the engine until a *different*
-- user second-approves it. The material key list is enforced in application
-- code (src/lib/dual-control.ts); these columns persist the provenance.

ALTER TABLE public.assumptions
  ADD COLUMN IF NOT EXISTS override_reason TEXT,
  ADD COLUMN IF NOT EXISTS requires_dual_control BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dual_control_pending BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS second_approval_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS second_approval_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS second_approver_name TEXT;

-- Guard rail at the database boundary: a second approver can never be the same
-- person as the first approver. (Application code enforces this too; this is the
-- fail-closed backstop.)
ALTER TABLE public.assumptions
  DROP CONSTRAINT IF EXISTS assumptions_dual_control_distinct_check;
ALTER TABLE public.assumptions
  ADD CONSTRAINT assumptions_dual_control_distinct_check
  CHECK (
    second_approval_by IS NULL
    OR approved_by IS NULL
    OR second_approval_by <> approved_by
  );
