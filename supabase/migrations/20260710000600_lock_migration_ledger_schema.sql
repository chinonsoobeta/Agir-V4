-- The application migration runner records applied files in this ledger. Make
-- it part of the declared schema rather than creating it opportunistically at
-- release time, so generated types and fresh-stack checks see the same shape.
-- Browser roles have no reason to inspect or mutate deployment metadata.

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.schema_migrations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.schema_migrations TO service_role;
