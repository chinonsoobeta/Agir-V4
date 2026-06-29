-- Canonical unit policy for persisted underwriting numbers.
-- The TypeScript mirror lives in src/lib/unit-contracts.ts; keep the vocabulary
-- in sync so assumptions, engine outputs, and report provenance all speak the
-- same unit language.

ALTER TABLE public.assumptions
  DROP CONSTRAINT IF EXISTS assumptions_unit_canonical_check;

ALTER TABLE public.assumptions
  ADD CONSTRAINT assumptions_unit_canonical_check
  CHECK (
    unit IS NULL OR unit IN (
      '$', '%', 'x', 'bps', 'mo', 'yr', 'units', 'count', 'SF', '$/SF', 'text', 'number'
    )
  );

ALTER TABLE public.financial_outputs
  DROP CONSTRAINT IF EXISTS financial_outputs_unit_canonical_check;

ALTER TABLE public.financial_outputs
  ADD CONSTRAINT financial_outputs_unit_canonical_check
  CHECK (
    unit IS NULL OR unit IN (
      '$', '%', 'x', 'bps', 'mo', 'yr', 'units', 'count', 'SF', '$/SF', 'text', 'number'
    )
  );

