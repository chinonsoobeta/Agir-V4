-- Explicit personal-to-workspace transfer for permit collaboration. The case,
-- linked evidence, and immutable history remain on the same case id.
CREATE OR REPLACE FUNCTION public.transfer_permit_case_to_workspace(
  p_case_id uuid,
  p_workspace_id uuid,
  p_reason text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_case public.permit_cases;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'A transfer reason is required.';
  END IF;

  SELECT * INTO v_case
  FROM public.permit_cases
  WHERE id = p_case_id
  FOR UPDATE;

  IF NOT FOUND OR v_case.owner_id <> auth.uid() OR v_case.workspace_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only the owner can move a personal permit case.';
  END IF;

  IF public.workspace_role(p_workspace_id) NOT IN ('owner', 'admin', 'member') THEN
    RAISE EXCEPTION 'You cannot move this case into that workspace.';
  END IF;

  UPDATE public.permit_cases
  SET workspace_id = p_workspace_id, updated_at = now()
  WHERE id = p_case_id;

  INSERT INTO public.permit_case_history(case_id, action, previous_data, new_data, reason, changed_by)
  VALUES (
    p_case_id,
    'case_workspace_transferred',
    jsonb_build_object('workspace_id', null),
    jsonb_build_object('workspace_id', p_workspace_id),
    trim(p_reason),
    auth.uid()
  );

  RETURN p_case_id;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_permit_case_to_workspace(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_permit_case_to_workspace(uuid, uuid, text) TO authenticated;
