-- Operating platform: live deal flow, execution, markets, and integrations.
-- The deterministic underwriting tables remain the financial source of truth.

ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'hospitality';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'self_storage';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'data_center';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'life_science';

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS probability NUMERIC(5,2) NOT NULL DEFAULT 25 CHECK (probability >= 0 AND probability <= 100),
  ADD COLUMN IF NOT EXISTS target_close_date DATE,
  ADD COLUMN IF NOT EXISTS lead_owner TEXT;

CREATE TABLE IF NOT EXISTS public.deal_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'execution',
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','blocked','complete')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  notes TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deal_milestones TO authenticated;
GRANT ALL ON public.deal_milestones TO service_role;
ALTER TABLE public.deal_milestones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deal_milestones_owner_all" ON public.deal_milestones
  FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE INDEX IF NOT EXISTS deal_milestones_project_idx ON public.deal_milestones(project_id);
CREATE TRIGGER deal_milestones_updated_at BEFORE UPDATE ON public.deal_milestones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.market_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  market TEXT NOT NULL,
  metric TEXT NOT NULL,
  value_numeric NUMERIC(18,4) NOT NULL,
  unit TEXT NOT NULL DEFAULT 'number',
  period TEXT,
  trend TEXT NOT NULL DEFAULT 'flat' CHECK (trend IN ('up','down','flat')),
  source TEXT,
  observed_at DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_signals TO authenticated;
GRANT ALL ON public.market_signals TO service_role;
ALTER TABLE public.market_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "market_signals_owner_all" ON public.market_signals
  FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE INDEX IF NOT EXISTS market_signals_owner_date_idx ON public.market_signals(owner_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS public.integration_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  category TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','attention','disconnected')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_id, provider)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_connections TO authenticated;
GRANT ALL ON public.integration_connections TO service_role;
ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "integration_connections_owner_all" ON public.integration_connections
  FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE TRIGGER integration_connections_updated_at BEFORE UPDATE ON public.integration_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.projects;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.deal_milestones;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.market_signals;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.integration_connections;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
