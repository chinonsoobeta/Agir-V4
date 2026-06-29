-- Role-gate extraction_jobs writes (Stage 1 hardening).
--
-- The original extraction_jobs policies gated INSERT/UPDATE on ownership only
-- (owner_id = auth.uid()). Every other workspace-scoped deal-child table gates
-- writes on workspace ROLE (owner/admin/member, never viewer). This aligns
-- extraction_jobs with that contract so a read-only 'viewer' cannot create or
-- advance extraction/underwriting jobs on a workspace project. Personal
-- (no-workspace) projects remain owner-gated; a NULL project_id (unassigned
-- upload) stays owner-only.

DROP POLICY IF EXISTS "extraction_jobs_insert_allowed" ON public.extraction_jobs;
DROP POLICY IF EXISTS "extraction_jobs_update_allowed" ON public.extraction_jobs;

CREATE POLICY "extraction_jobs_insert_allowed" ON public.extraction_jobs
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND (
      project_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = extraction_jobs.project_id
          AND (
            (p.workspace_id IS NULL AND p.owner_id = auth.uid())
            OR public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
          )
      )
    )
  );

CREATE POLICY "extraction_jobs_update_allowed" ON public.extraction_jobs
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (
    owner_id = auth.uid()
    AND (
      project_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = extraction_jobs.project_id
          AND (
            (p.workspace_id IS NULL AND p.owner_id = auth.uid())
            OR public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
          )
      )
    )
  );
