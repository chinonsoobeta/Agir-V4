-- Direct owner policies make personal-case CRUD and INSERT ... RETURNING
-- independent from workspace-aware SECURITY DEFINER evaluation.
CREATE POLICY permit_cases_personal_select ON public.permit_cases FOR SELECT TO authenticated
  USING (workspace_id IS NULL AND owner_id=auth.uid());
CREATE POLICY permit_cases_personal_update ON public.permit_cases FOR UPDATE TO authenticated
  USING (workspace_id IS NULL AND owner_id=auth.uid())
  WITH CHECK (workspace_id IS NULL AND owner_id=auth.uid());
CREATE POLICY permit_cases_personal_delete ON public.permit_cases FOR DELETE TO authenticated
  USING (workspace_id IS NULL AND owner_id=auth.uid());
