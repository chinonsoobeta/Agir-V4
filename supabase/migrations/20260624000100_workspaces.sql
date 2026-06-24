-- Workspaces & teams.
--
-- Turns Agir from a single-analyst tool into a multi-user platform. Deals and
-- everything under them can be SHARED with workspace members, with per-member
-- roles. The design is strictly ADDITIVE and backward-compatible:
--   * Every existing "owner_id = auth.uid()" RLS policy is KEPT.
--   * We ADD a second permissive policy granting access to members of the row's
--     (or its parent project's) workspace. Postgres OR-combines permissive
--     policies, so a row is visible if you own it OR share its workspace.
--   * workspace_id is NULLABLE — legacy owner-only rows keep working untouched.
-- Membership and workspace creation go through SECURITY DEFINER helpers so RLS
-- never recurses and the creator can always seed themselves as owner.
--
-- Idempotent. Safe to run repeatedly. The application is written migration-safe
-- (src/lib/db-compat.ts) so it degrades to personal/owner scope until this runs.

-- ---- Role enum ----
DO $$ BEGIN
  CREATE TYPE public.workspace_role AS ENUM ('owner', 'admin', 'member', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---- Tables ----
CREATE TABLE IF NOT EXISTS public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.workspace_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON public.workspace_members(user_id);
CREATE INDEX IF NOT EXISTS workspace_members_ws_idx ON public.workspace_members(workspace_id);

CREATE TABLE IF NOT EXISTS public.workspace_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role public.workspace_role NOT NULL DEFAULT 'member',
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(18), 'hex'),
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '14 days'
);
CREATE INDEX IF NOT EXISTS workspace_invitations_ws_idx ON public.workspace_invitations(workspace_id);
CREATE INDEX IF NOT EXISTS workspace_invitations_email_idx ON public.workspace_invitations(lower(email));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspaces, public.workspace_members, public.workspace_invitations TO authenticated;
GRANT ALL ON public.workspaces, public.workspace_members, public.workspace_invitations TO service_role;

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;

-- ---- Helper functions (SECURITY DEFINER bypasses RLS → no policy recursion) ----
CREATE OR REPLACE FUNCTION public.is_workspace_member(ws UUID)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members m
    WHERE m.workspace_id = ws AND m.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.workspace_role(ws UUID)
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT m.role::text FROM public.workspace_members m
  WHERE m.workspace_id = ws AND m.user_id = auth.uid();
$$;

-- Create a workspace and seed the caller as owner, atomically, bypassing RLS.
CREATE OR REPLACE FUNCTION public.create_workspace(p_name TEXT)
RETURNS public.workspaces LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w public.workspaces;
BEGIN
  INSERT INTO public.workspaces (name, created_by) VALUES (NULLIF(trim(p_name), ''), auth.uid())
  RETURNING * INTO w;
  IF w.name IS NULL THEN RAISE EXCEPTION 'Workspace name is required'; END IF;
  INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (w.id, auth.uid(), 'owner');
  RETURN w;
END; $$;

-- Accept an invitation by token: validates + adds membership, bypassing RLS.
CREATE OR REPLACE FUNCTION public.accept_workspace_invitation(p_token TEXT)
RETURNS public.workspace_members LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.workspace_invitations; m public.workspace_members;
BEGIN
  SELECT * INTO inv FROM public.workspace_invitations
  WHERE token = p_token AND status = 'pending' AND expires_at > now();
  IF inv IS NULL THEN RAISE EXCEPTION 'Invitation is invalid or expired'; END IF;
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (inv.workspace_id, auth.uid(), inv.role)
  ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
  RETURNING * INTO m;
  UPDATE public.workspace_invitations SET status = 'accepted' WHERE id = inv.id;
  RETURN m;
END; $$;

GRANT EXECUTE ON FUNCTION public.is_workspace_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_role(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_workspace(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_workspace_invitation(TEXT) TO authenticated;

-- ---- RLS on workspace tables ----
DO $$ BEGIN
  CREATE POLICY "workspaces_member_select" ON public.workspaces
    FOR SELECT TO authenticated USING (public.is_workspace_member(id) OR created_by = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "workspaces_admin_update" ON public.workspaces
    FOR UPDATE TO authenticated USING (public.workspace_role(id) IN ('owner', 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "workspaces_owner_delete" ON public.workspaces
    FOR DELETE TO authenticated USING (public.workspace_role(id) = 'owner');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "wm_member_select" ON public.workspace_members
    FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "wm_admin_manage" ON public.workspace_members
    FOR ALL TO authenticated
    USING (public.workspace_role(workspace_id) IN ('owner', 'admin'))
    WITH CHECK (public.workspace_role(workspace_id) IN ('owner', 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- A member may always remove themselves (leave a workspace).
DO $$ BEGIN
  CREATE POLICY "wm_self_leave" ON public.workspace_members
    FOR DELETE TO authenticated USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "wi_admin_all" ON public.workspace_invitations
    FOR ALL TO authenticated
    USING (public.workspace_role(workspace_id) IN ('owner', 'admin'))
    WITH CHECK (public.workspace_role(workspace_id) IN ('owner', 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER workspaces_updated_at BEFORE UPDATE ON public.workspaces
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- workspace_id on projects + additive member access ----
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS projects_workspace_idx ON public.projects(workspace_id);
DO $$ BEGIN
  CREATE POLICY "projects_workspace_member" ON public.projects
    FOR ALL TO authenticated
    USING (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id))
    WITH CHECK (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- Additive member access on every deal-child table ----
-- Each gets a policy: accessible if the parent project's workspace includes me.
DO $$
DECLARE
  tbl TEXT;
  child_tables TEXT[] := ARRAY[
    'assumptions', 'financial_outputs', 'cash_flows', 'documents', 'decision_logs',
    'investment_memos', 'generated_reports', 'reconciliation_flags', 'risk_register',
    'deal_milestones', 'audit_logs'
  ];
BEGIN
  FOREACH tbl IN ARRAY child_tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
      EXECUTE format($f$
        DO $p$ BEGIN
          CREATE POLICY "%1$s_workspace_member" ON public.%1$I
            FOR ALL TO authenticated
            USING (EXISTS (
              SELECT 1 FROM public.projects p
              WHERE p.id = %1$I.project_id AND p.workspace_id IS NOT NULL
                AND public.is_workspace_member(p.workspace_id)))
            WITH CHECK (EXISTS (
              SELECT 1 FROM public.projects p
              WHERE p.id = %1$I.project_id AND p.workspace_id IS NOT NULL
                AND public.is_workspace_member(p.workspace_id)));
        EXCEPTION WHEN duplicate_object THEN NULL; END $p$;
      $f$, tbl);
    END IF;
  END LOOP;
END $$;

-- assumption_versions / assumption_comments are scoped via assumption_id, not
-- project_id — grant members access through the parent assumption's project.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='assumption_versions') THEN
    BEGIN
      CREATE POLICY "assumption_versions_workspace_member" ON public.assumption_versions
        FOR ALL TO authenticated
        USING (EXISTS (
          SELECT 1 FROM public.assumptions a JOIN public.projects p ON p.id = a.project_id
          WHERE a.id = assumption_versions.assumption_id AND p.workspace_id IS NOT NULL
            AND public.is_workspace_member(p.workspace_id)))
        WITH CHECK (EXISTS (
          SELECT 1 FROM public.assumptions a JOIN public.projects p ON p.id = a.project_id
          WHERE a.id = assumption_versions.assumption_id AND p.workspace_id IS NOT NULL
            AND public.is_workspace_member(p.workspace_id)));
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

-- Realtime for live team collaboration on workspace membership.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_members;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL;
END $$;
