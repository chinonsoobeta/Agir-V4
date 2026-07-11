-- Keep personal and workspace insert predicates independent so a personal case
-- never depends on workspace-role evaluation.
DROP POLICY IF EXISTS permit_cases_insert ON public.permit_cases;
CREATE POLICY permit_cases_insert_personal ON public.permit_cases FOR INSERT TO authenticated
  WITH CHECK (owner_id=auth.uid() AND workspace_id IS NULL AND project_id IS NULL);
CREATE POLICY permit_cases_insert_workspace ON public.permit_cases FOR INSERT TO authenticated
  WITH CHECK (owner_id=auth.uid() AND workspace_id IS NOT NULL AND public.workspace_role(workspace_id) IN ('owner','admin','member'));
