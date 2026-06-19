-- Add "Return to Underwriting" as a first-class Investment Committee outcome.
-- PG12+ permits ALTER TYPE ... ADD VALUE inside a transaction provided the new
-- value is not referenced in the same transaction (it is not, here).
ALTER TYPE public.ic_decision ADD VALUE IF NOT EXISTS 'return_to_underwriting';
