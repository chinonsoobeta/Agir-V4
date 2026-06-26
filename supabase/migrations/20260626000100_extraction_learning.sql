-- WS2 / 2D. The compounding moat: deterministic learning from analyst corrections.
--
-- Two workspace-scoped stores. NEITHER holds a value: they hold STRUCTURE
-- (label -> canonical key) learned from analyst corrections, which the
-- deterministic alias mapper consults so the same correction never has to be made
-- twice. Numbers are still read from document tokens, always.
--
--   * extraction_aliases: a corrected label -> field_key, so the mapper resolves
--     that label deterministically on the next document.
--   * counterparty_templates: a fully reviewed document's label -> key map, keyed
--     by a stable fingerprint of its label STRUCTURE, so the next document from the
--     same lender/broker template auto-maps.
--
-- Strictly additive. RLS mirrors the established dual pattern (owner OR workspace
-- member) with WITH CHECK. workspace_id is NULLABLE: a personal correction is
-- scoped to its owner. Idempotent; safe to run repeatedly.

-- ---- extraction_aliases ----
CREATE TABLE IF NOT EXISTS public.extraction_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  alias_text TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS extraction_aliases_scope_idx ON public.extraction_aliases(workspace_id, owner_id);
-- One learned alias per (scope, key, label). COALESCE folds the personal scope
-- (workspace_id NULL) onto owner_id; a workspace scope uses workspace_id.
CREATE UNIQUE INDEX IF NOT EXISTS extraction_aliases_unique_idx
  ON public.extraction_aliases ((COALESCE(workspace_id, owner_id)), field_key, alias_text);

-- ---- counterparty_templates ----
CREATE TABLE IF NOT EXISTS public.counterparty_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  label TEXT NOT NULL,
  field_key TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS counterparty_templates_scope_idx ON public.counterparty_templates(workspace_id, owner_id);
CREATE INDEX IF NOT EXISTS counterparty_templates_fingerprint_idx ON public.counterparty_templates(fingerprint);
CREATE UNIQUE INDEX IF NOT EXISTS counterparty_templates_unique_idx
  ON public.counterparty_templates ((COALESCE(workspace_id, owner_id)), fingerprint, label);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.extraction_aliases, public.counterparty_templates TO authenticated;
GRANT ALL ON public.extraction_aliases, public.counterparty_templates TO service_role;

ALTER TABLE public.extraction_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counterparty_templates ENABLE ROW LEVEL SECURITY;

-- ---- RLS: owner OR workspace member, with WITH CHECK on both ----
DO $$ BEGIN
  CREATE POLICY "extraction_aliases_owner" ON public.extraction_aliases
    FOR ALL TO authenticated
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "extraction_aliases_workspace_member" ON public.extraction_aliases
    FOR ALL TO authenticated
    USING (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id))
    WITH CHECK (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "counterparty_templates_owner" ON public.counterparty_templates
    FOR ALL TO authenticated
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "counterparty_templates_workspace_member" ON public.counterparty_templates
    FOR ALL TO authenticated
    USING (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id))
    WITH CHECK (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER extraction_aliases_updated_at BEFORE UPDATE ON public.extraction_aliases
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
