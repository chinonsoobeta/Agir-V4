-- Follow-up to 20260626000100_workspace_rls_write_hardening.sql.
--
-- That migration split the project-scoped deal-child tables into member-SELECT +
-- non-viewer-write, but its child_tables loop did NOT cover four collaborative
-- tables created in earlier migrations: ic_votes, ic_conditions,
-- external_record_links, and relationship_contacts. Their original FOR ALL
-- policies gate writes on is_workspace_member(...), which is TRUE for viewers --
-- so a read-only VIEWER could cast IC votes and satisfy/waive approval
-- conditions (the exact governance actions a viewer must never perform). This
-- migration applies the same read-for-members / write-for-collaborators split to
-- those tables (viewers excluded from writes), and tightens the last-owner
-- trigger so an admin can no longer demote/remove an OWNER or grant ownership.

-- A project is writable by a non-viewer collaborator when it is the caller's
-- personal project, or a workspace project where the caller's role is not viewer.
-- (Helper expressed inline per table because policies cannot share a subquery.)

-- ---- ic_votes: members read all votes (needed for the tally); a NON-VIEWER may
--      write only their OWN vote row. ----
DROP POLICY IF EXISTS "ic_votes_access" ON public.ic_votes;
DROP POLICY IF EXISTS "ic_votes_member_select" ON public.ic_votes;
DROP POLICY IF EXISTS "ic_votes_self_insert" ON public.ic_votes;
DROP POLICY IF EXISTS "ic_votes_self_update" ON public.ic_votes;
DROP POLICY IF EXISTS "ic_votes_self_delete" ON public.ic_votes;

CREATE POLICY "ic_votes_member_select" ON public.ic_votes
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id
        AND p.workspace_id IS NOT NULL
        AND public.is_workspace_member(p.workspace_id)
    )
  );
CREATE POLICY "ic_votes_self_insert" ON public.ic_votes
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id
        AND (
          p.owner_id = auth.uid()
          OR (p.workspace_id IS NOT NULL AND public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member'))
        )
    )
  );
CREATE POLICY "ic_votes_self_update" ON public.ic_votes
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (
    owner_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id
        AND (
          p.owner_id = auth.uid()
          OR (p.workspace_id IS NOT NULL AND public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member'))
        )
    )
  );
CREATE POLICY "ic_votes_self_delete" ON public.ic_votes
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- ---- ic_conditions: collaborative. Members read; any NON-VIEWER collaborator on
--      the deal may create / satisfy / waive a condition. ----
DROP POLICY IF EXISTS "ic_conditions_access" ON public.ic_conditions;
DROP POLICY IF EXISTS "ic_conditions_member_select" ON public.ic_conditions;
DROP POLICY IF EXISTS "ic_conditions_collab_insert" ON public.ic_conditions;
DROP POLICY IF EXISTS "ic_conditions_collab_update" ON public.ic_conditions;
DROP POLICY IF EXISTS "ic_conditions_collab_delete" ON public.ic_conditions;

CREATE POLICY "ic_conditions_member_select" ON public.ic_conditions
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id
        AND p.workspace_id IS NOT NULL
        AND public.is_workspace_member(p.workspace_id)
    )
  );
CREATE POLICY "ic_conditions_collab_insert" ON public.ic_conditions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id
        AND (
          p.owner_id = auth.uid()
          OR (p.workspace_id IS NOT NULL AND public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member'))
        )
    )
  );
CREATE POLICY "ic_conditions_collab_update" ON public.ic_conditions
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id
        AND (
          p.owner_id = auth.uid()
          OR (p.workspace_id IS NOT NULL AND public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member'))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id
        AND (
          p.owner_id = auth.uid()
          OR (p.workspace_id IS NOT NULL AND public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member'))
        )
    )
  );
CREATE POLICY "ic_conditions_collab_delete" ON public.ic_conditions
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id
        AND (
          p.owner_id = auth.uid()
          OR (p.workspace_id IS NOT NULL AND public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member'))
        )
    )
  );

-- ---- external_record_links: scoped through the integration connection's
--      workspace. Members read; a NON-VIEWER may write only their OWN links. ----
DROP POLICY IF EXISTS "external_record_links_access" ON public.external_record_links;
DROP POLICY IF EXISTS "external_record_links_member_select" ON public.external_record_links;
DROP POLICY IF EXISTS "external_record_links_self_write_insert" ON public.external_record_links;
DROP POLICY IF EXISTS "external_record_links_self_write_update" ON public.external_record_links;
DROP POLICY IF EXISTS "external_record_links_self_write_delete" ON public.external_record_links;

CREATE POLICY "external_record_links_member_select" ON public.external_record_links
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.integration_connections c
      WHERE c.id = connection_id
        AND c.workspace_id IS NOT NULL
        AND public.is_workspace_member(c.workspace_id)
    )
  );
CREATE POLICY "external_record_links_self_write_insert" ON public.external_record_links
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.integration_connections c
      WHERE c.id = connection_id
        AND (
          c.owner_id = auth.uid()
          OR (c.workspace_id IS NOT NULL AND public.workspace_role(c.workspace_id) IN ('owner', 'admin', 'member'))
        )
    )
  );
CREATE POLICY "external_record_links_self_write_update" ON public.external_record_links
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (
    owner_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.integration_connections c
      WHERE c.id = connection_id
        AND (
          c.owner_id = auth.uid()
          OR (c.workspace_id IS NOT NULL AND public.workspace_role(c.workspace_id) IN ('owner', 'admin', 'member'))
        )
    )
  );
CREATE POLICY "external_record_links_self_write_delete" ON public.external_record_links
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- ---- relationship_contacts: workspace-scoped directly. Members read; a
--      NON-VIEWER may write only their OWN contacts. ----
DROP POLICY IF EXISTS "relationship_contacts_access" ON public.relationship_contacts;
DROP POLICY IF EXISTS "relationship_contacts_member_select" ON public.relationship_contacts;
DROP POLICY IF EXISTS "relationship_contacts_self_write_insert" ON public.relationship_contacts;
DROP POLICY IF EXISTS "relationship_contacts_self_write_update" ON public.relationship_contacts;
DROP POLICY IF EXISTS "relationship_contacts_self_write_delete" ON public.relationship_contacts;

CREATE POLICY "relationship_contacts_member_select" ON public.relationship_contacts
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id))
  );
CREATE POLICY "relationship_contacts_self_write_insert" ON public.relationship_contacts
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND (
      workspace_id IS NULL
      OR public.workspace_role(workspace_id) IN ('owner', 'admin', 'member')
    )
  );
CREATE POLICY "relationship_contacts_self_write_update" ON public.relationship_contacts
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (
    owner_id = auth.uid()
    AND (
      workspace_id IS NULL
      OR public.workspace_role(workspace_id) IN ('owner', 'admin', 'member')
    )
  );
CREATE POLICY "relationship_contacts_self_write_delete" ON public.relationship_contacts
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- ---- Owner protection (tighten the last-owner trigger) ----
-- The prior trigger only blocked removing/demoting the LAST owner. It still let
-- an admin demote or remove a non-last OWNER, or promote anyone to owner -- a
-- privilege-takeover path. Re-define the function to ALSO require that only an
-- OWNER may demote/remove an existing owner or grant ownership. Service-role /
-- no-JWT contexts (auth.uid() IS NULL) are trusted and skip the actor check so
-- seeding and workspace creation are unaffected.
CREATE OR REPLACE FUNCTION public.prevent_last_workspace_owner_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_count INTEGER;
  caller_role TEXT;
BEGIN
  -- Actor check: an admin (or anyone who is not an owner) may not act on an owner
  -- row or grant ownership. Skipped for trusted service-role / no-JWT contexts.
  IF auth.uid() IS NOT NULL THEN
    IF (TG_OP = 'DELETE' AND OLD.role = 'owner')
       OR (TG_OP = 'UPDATE' AND OLD.role = 'owner' AND NEW.role <> 'owner')
       OR (TG_OP = 'UPDATE' AND NEW.role = 'owner' AND OLD.role <> 'owner') THEN
      caller_role := public.workspace_role(OLD.workspace_id);
      IF caller_role IS DISTINCT FROM 'owner' THEN
        RAISE EXCEPTION 'Only a workspace owner can manage another owner or grant ownership.';
      END IF;
    END IF;
  END IF;

  -- Last-owner check (unchanged): never leave a workspace with zero owners.
  IF TG_OP = 'UPDATE' AND OLD.role <> 'owner' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.role = 'owner' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND OLD.role <> 'owner' THEN
    RETURN OLD;
  END IF;

  SELECT count(*) INTO owner_count
  FROM public.workspace_members
  WHERE workspace_id = OLD.workspace_id
    AND role = 'owner'
    AND id <> OLD.id;

  IF owner_count = 0 THEN
    RAISE EXCEPTION 'A workspace must always have at least one owner.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- Re-assert the trigger so this migration is self-contained even if 20260626000100
-- has not been applied (CREATE OR REPLACE above only updates the function body).
DROP TRIGGER IF EXISTS prevent_last_workspace_owner_removal ON public.workspace_members;
CREATE TRIGGER prevent_last_workspace_owner_removal
  BEFORE UPDATE OF role OR DELETE ON public.workspace_members
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_last_workspace_owner_removal();
