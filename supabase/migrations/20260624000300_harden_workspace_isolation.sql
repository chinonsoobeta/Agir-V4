-- Harden project tenant isolation + ensure the documents bucket is private.
--
-- The original projects_insert_own / projects_update_own policies (from the very
-- first migration) only checked owner_id, with NO constraint on workspace_id.
-- Because Postgres OR-combines permissive policies, the additive
-- projects_workspace_member policy (20260624000100_workspaces.sql) cannot contain
-- them: an authenticated user could INSERT or UPDATE a project they own while
-- stamping it with ANY workspace_id -- including a workspace they do not belong
-- to -- pushing or exposing their confidential deal into another tenant's
-- workspace. Every deal-child table trusts projects.workspace_id for its own
-- member access, so this is the write-side gap the whole workspace model depends
-- on.
--
-- Fix: recreate both owner policies so a user may only attach their project to a
-- workspace they are a member of. workspace_id IS NULL stays allowed so legacy /
-- personal (owner-only) deals keep working untouched. The collaborative
-- projects_workspace_member policy is left intact, so workspace members keep full
-- access to shared deals.
--
-- Idempotent and safe to re-run. Depends on public.is_workspace_member(uuid) and
-- projects.workspace_id from 20260624000100_workspaces.sql, so it must run after
-- that migration (it does, by timestamp).

DROP POLICY IF EXISTS "projects_insert_own" ON public.projects;
CREATE POLICY "projects_insert_own" ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND (workspace_id IS NULL OR public.is_workspace_member(workspace_id))
  );

DROP POLICY IF EXISTS "projects_update_own" ON public.projects;
CREATE POLICY "projects_update_own" ON public.projects
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (
    owner_id = auth.uid()
    AND (workspace_id IS NULL OR public.is_workspace_member(workspace_id))
  );

-- Confidential deal documents must never live in a public bucket. Create it if
-- missing (this also removes the previous manual post-reset step) and enforce
-- private; ON CONFLICT keeps this idempotent and repairs a bucket that was ever
-- accidentally made public.
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO UPDATE SET public = false;
