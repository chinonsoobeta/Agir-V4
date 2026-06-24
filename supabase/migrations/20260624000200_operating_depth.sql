-- Operating depth: collaboration, relationship intelligence, integration
-- observability, onboarding measurement, and workspace governance.
--
-- This migration is additive. Existing owner-scoped behavior remains valid,
-- while shared records also honor workspace membership.

ALTER TABLE public.deal_milestones
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS deal_milestones_assigned_idx
  ON public.deal_milestones(assigned_to, due_date);

CREATE TABLE IF NOT EXISTS public.relationship_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  company TEXT,
  title TEXT,
  email TEXT,
  phone TEXT,
  relationship_type TEXT NOT NULL DEFAULT 'broker'
    CHECK (relationship_type IN (
      'broker', 'lender', 'investor', 'operator', 'attorney',
      'consultant', 'seller', 'tenant', 'other'
    )),
  strength TEXT NOT NULL DEFAULT 'developing'
    CHECK (strength IN ('new', 'developing', 'strong', 'strategic')),
  last_contacted_at TIMESTAMPTZ,
  next_follow_up_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS relationship_contacts_workspace_idx
  ON public.relationship_contacts(workspace_id, company);
CREATE INDEX IF NOT EXISTS relationship_contacts_follow_up_idx
  ON public.relationship_contacts(next_follow_up_at);

CREATE TABLE IF NOT EXISTS public.deal_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.relationship_contacts(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT,
  influence TEXT NOT NULL DEFAULT 'medium'
    CHECK (influence IN ('low', 'medium', 'high', 'decision_maker')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, contact_id)
);
CREATE INDEX IF NOT EXISTS deal_relationships_project_idx
  ON public.deal_relationships(project_id);

CREATE TABLE IF NOT EXISTS public.deal_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  responsibility TEXT NOT NULL DEFAULT 'deal_team',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, user_id, responsibility)
);
CREATE INDEX IF NOT EXISTS deal_assignments_project_idx
  ON public.deal_assignments(project_id);

CREATE TABLE IF NOT EXISTS public.deal_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  mentions UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deal_comments_project_idx
  ON public.deal_comments(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  action_url TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_recipient_idx
  ON public.notifications(recipient_id, read_at, created_at DESC);

ALTER TABLE public.integration_connections
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS integration_connections_workspace_idx
  ON public.integration_connections(workspace_id);

CREATE TABLE IF NOT EXISTS public.integration_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.integration_connections(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  direction TEXT NOT NULL DEFAULT 'inbound'
    CHECK (direction IN ('inbound', 'outbound', 'bidirectional')),
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  records_read INTEGER NOT NULL DEFAULT 0,
  records_written INTEGER NOT NULL DEFAULT 0,
  records_failed INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS integration_sync_runs_connection_idx
  ON public.integration_sync_runs(connection_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  event_types TEXT[] NOT NULL DEFAULT '{}',
  signing_secret_hint TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  last_delivery_at TIMESTAMPTZ,
  last_delivery_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.onboarding_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  event_name TEXT NOT NULL,
  step_key TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onboarding_events_user_idx
  ON public.onboarding_events(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.workspace_settings (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  approval_threshold NUMERIC(18,2),
  require_two_person_approval BOOLEAN NOT NULL DEFAULT false,
  allowed_email_domains TEXT[] NOT NULL DEFAULT '{}',
  data_retention_days INTEGER NOT NULL DEFAULT 2555 CHECK (data_retention_days >= 30),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.relationship_contacts,
  public.deal_relationships,
  public.deal_assignments,
  public.deal_comments,
  public.notifications,
  public.integration_sync_runs,
  public.webhook_endpoints,
  public.onboarding_events,
  public.workspace_settings
TO authenticated;
GRANT ALL ON
  public.relationship_contacts,
  public.deal_relationships,
  public.deal_assignments,
  public.deal_comments,
  public.notifications,
  public.integration_sync_runs,
  public.webhook_endpoints,
  public.onboarding_events,
  public.workspace_settings
TO service_role;

ALTER TABLE public.relationship_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "relationship_contacts_access" ON public.relationship_contacts
  FOR ALL TO authenticated
  USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id))
  )
  WITH CHECK (
    owner_id = auth.uid()
    AND (workspace_id IS NULL OR public.is_workspace_member(workspace_id))
  );

CREATE POLICY "deal_relationships_access" ON public.deal_relationships
  FOR ALL TO authenticated
  USING (
    owner_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id
        AND p.workspace_id IS NOT NULL
        AND public.is_workspace_member(p.workspace_id)
    )
  )
  WITH CHECK (
    owner_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id
        AND (p.owner_id = auth.uid()
          OR (p.workspace_id IS NOT NULL AND public.is_workspace_member(p.workspace_id)))
    )
  );

CREATE POLICY "deal_assignments_access" ON public.deal_assignments
  FOR ALL TO authenticated
  USING (
    user_id = auth.uid() OR assigned_by = auth.uid() OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id
        AND p.workspace_id IS NOT NULL
        AND public.is_workspace_member(p.workspace_id)
    )
  )
  WITH CHECK (
    assigned_by = auth.uid() AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id
        AND (p.owner_id = auth.uid()
          OR (p.workspace_id IS NOT NULL AND public.is_workspace_member(p.workspace_id)))
    )
  );

CREATE POLICY "deal_comments_access" ON public.deal_comments
  FOR ALL TO authenticated
  USING (
    user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id
        AND p.workspace_id IS NOT NULL
        AND public.is_workspace_member(p.workspace_id)
    )
  )
  WITH CHECK (
    user_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id
        AND (p.owner_id = auth.uid()
          OR (p.workspace_id IS NOT NULL AND public.is_workspace_member(p.workspace_id)))
    )
  );

CREATE POLICY "notifications_recipient_access" ON public.notifications
  FOR ALL TO authenticated
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

CREATE POLICY "integration_sync_runs_access" ON public.integration_sync_runs
  FOR ALL TO authenticated
  USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id))
  )
  WITH CHECK (
    owner_id = auth.uid()
    AND (workspace_id IS NULL OR public.is_workspace_member(workspace_id))
  );

CREATE POLICY "webhook_endpoints_access" ON public.webhook_endpoints
  FOR ALL TO authenticated
  USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id))
  )
  WITH CHECK (
    owner_id = auth.uid()
    AND (workspace_id IS NULL OR public.workspace_role(workspace_id) IN ('owner', 'admin'))
  );

CREATE POLICY "onboarding_events_self" ON public.onboarding_events
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "workspace_settings_member_select" ON public.workspace_settings
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));
CREATE POLICY "workspace_settings_admin_manage" ON public.workspace_settings
  FOR ALL TO authenticated
  USING (public.workspace_role(workspace_id) IN ('owner', 'admin'))
  WITH CHECK (public.workspace_role(workspace_id) IN ('owner', 'admin'));

CREATE TRIGGER relationship_contacts_updated_at
  BEFORE UPDATE ON public.relationship_contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER deal_comments_updated_at
  BEFORE UPDATE ON public.deal_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER webhook_endpoints_updated_at
  BEFORE UPDATE ON public.webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER workspace_settings_updated_at
  BEFORE UPDATE ON public.workspace_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.deal_comments;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.integration_sync_runs;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL;
END $$;
