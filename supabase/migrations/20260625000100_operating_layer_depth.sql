-- Operating-layer depth (Workstream 3): execution dependencies + critical path
-- (3A), IC voting and tracked approval conditions (3B), and idempotent external
-- record linkage for the integrations connector (3C).
--
-- Additive and tenant-safe. Every new table follows the hardened owner +
-- workspace-member RLS pattern (see 20260624000200_operating_depth.sql and
-- 20260624000300_harden_workspace_isolation.sql): USING allows the owner or a
-- member of the row's workspace/project; WITH CHECK forbids writing a row into a
-- workspace/project the author cannot access, so there is no cross-tenant path.

-- ===== 3A. Milestone dependencies (predecessors) for the critical path. =====
ALTER TABLE public.deal_milestones
  ADD COLUMN IF NOT EXISTS depends_on UUID[] NOT NULL DEFAULT '{}';

-- ===== 3B. IC votes (one decisive vote per member per project). =====
CREATE TABLE IF NOT EXISTS public.ic_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vote TEXT NOT NULL CHECK (vote IN ('approve', 'approve_with_conditions', 'reject', 'abstain')),
  rationale TEXT CHECK (rationale IS NULL OR char_length(rationale) <= 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, owner_id)
);
CREATE INDEX IF NOT EXISTS ic_votes_project_idx ON public.ic_votes(project_id);

-- ===== 3B. Tracked approval conditions (open -> satisfied / waived). =====
CREATE TABLE IF NOT EXISTS public.ic_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 1000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'satisfied', 'waived')),
  satisfied_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  satisfied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ic_conditions_project_idx ON public.ic_conditions(project_id, status);

-- ===== 3C. Idempotent linkage between an external system's records and our
-- projects, so a connector import never duplicates a deal and an export can be
-- traced back to its source. =====
CREATE TABLE IF NOT EXISTS public.external_record_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.integration_connections(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  external_id TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound')),
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, external_id)
);
CREATE INDEX IF NOT EXISTS external_record_links_connection_idx ON public.external_record_links(connection_id);
CREATE INDEX IF NOT EXISTS external_record_links_project_idx ON public.external_record_links(project_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.ic_votes, public.ic_conditions, public.external_record_links
TO authenticated;
GRANT ALL ON
  public.ic_votes, public.ic_conditions, public.external_record_links
TO service_role;

ALTER TABLE public.ic_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ic_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_record_links ENABLE ROW LEVEL SECURITY;

-- A vote belongs to the member who cast it; members of the deal's workspace can
-- read every vote (needed for the tally), but a user can only write their own.
CREATE POLICY "ic_votes_access" ON public.ic_votes
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

-- Conditions are collaborative: any member of the deal can satisfy / waive a
-- condition, but only on a deal they can access (no cross-tenant write).
CREATE POLICY "ic_conditions_access" ON public.ic_conditions
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
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id
        AND (p.owner_id = auth.uid()
          OR (p.workspace_id IS NOT NULL AND public.is_workspace_member(p.workspace_id)))
    )
  );

CREATE POLICY "external_record_links_access" ON public.external_record_links
  FOR ALL TO authenticated
  USING (
    owner_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.integration_connections c
      WHERE c.id = connection_id
        AND c.workspace_id IS NOT NULL
        AND public.is_workspace_member(c.workspace_id)
    )
  )
  WITH CHECK (
    owner_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.integration_connections c
      WHERE c.id = connection_id
        AND (c.owner_id = auth.uid()
          OR (c.workspace_id IS NOT NULL AND public.is_workspace_member(c.workspace_id)))
    )
  );

CREATE TRIGGER ic_votes_updated_at
  BEFORE UPDATE ON public.ic_votes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER ic_conditions_updated_at
  BEFORE UPDATE ON public.ic_conditions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.ic_votes;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.ic_conditions;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL;
END $$;
