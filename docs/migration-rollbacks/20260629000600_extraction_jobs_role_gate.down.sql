-- Rollback for 20260629000600_extraction_jobs_role_gate: revert to owner-only gate.
DROP POLICY IF EXISTS "extraction_jobs_insert_allowed" ON public.extraction_jobs;
DROP POLICY IF EXISTS "extraction_jobs_update_allowed" ON public.extraction_jobs;
CREATE POLICY "extraction_jobs_insert_allowed" ON public.extraction_jobs
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "extraction_jobs_update_allowed" ON public.extraction_jobs
  FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
