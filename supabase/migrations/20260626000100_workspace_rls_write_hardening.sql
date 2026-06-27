-- Split workspace RLS into read-for-members and write-for-collaborators.
--
-- The original additive workspace policy used FOR ALL for shared projects and
-- deal-child rows. That made read-only viewers true writers anywhere the row's
-- parent project belonged to their workspace. This migration keeps member
-- visibility broad, gates child-row writes at non-viewer roles, and reserves
-- project UPDATE/DELETE for workspace owner/admin.

-- ---- Projects ----
DROP POLICY IF EXISTS "projects_workspace_member" ON public.projects;
DROP POLICY IF EXISTS "projects_workspace_member_select" ON public.projects;
DROP POLICY IF EXISTS "projects_workspace_admin_update" ON public.projects;
DROP POLICY IF EXISTS "projects_workspace_admin_delete" ON public.projects;

DROP POLICY IF EXISTS "projects_insert_own" ON public.projects;
CREATE POLICY "projects_insert_own" ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND (
      workspace_id IS NULL
      OR public.workspace_role(workspace_id) IN ('owner', 'admin', 'member')
    )
  );

DROP POLICY IF EXISTS "projects_update_own" ON public.projects;
CREATE POLICY "projects_update_own" ON public.projects
  FOR UPDATE TO authenticated
  USING (
    owner_id = auth.uid()
    AND (
      workspace_id IS NULL
      OR public.workspace_role(workspace_id) IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    owner_id = auth.uid()
    AND (
      workspace_id IS NULL
      OR public.workspace_role(workspace_id) IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "projects_delete_own" ON public.projects;
CREATE POLICY "projects_delete_own" ON public.projects
  FOR DELETE TO authenticated
  USING (
    owner_id = auth.uid()
    AND (
      workspace_id IS NULL
      OR public.workspace_role(workspace_id) IN ('owner', 'admin')
    )
  );

CREATE POLICY "projects_workspace_member_select" ON public.projects
  FOR SELECT TO authenticated
  USING (
    workspace_id IS NOT NULL
    AND public.is_workspace_member(workspace_id)
  );

CREATE POLICY "projects_workspace_admin_update" ON public.projects
  FOR UPDATE TO authenticated
  USING (
    workspace_id IS NOT NULL
    AND public.workspace_role(workspace_id) IN ('owner', 'admin')
  )
  WITH CHECK (
    workspace_id IS NOT NULL
    AND public.workspace_role(workspace_id) IN ('owner', 'admin')
  );

CREATE POLICY "projects_workspace_admin_delete" ON public.projects
  FOR DELETE TO authenticated
  USING (
    workspace_id IS NOT NULL
    AND public.workspace_role(workspace_id) IN ('owner', 'admin')
  );

-- ---- Deal-child rows with project_id ----
DO $$
DECLARE
  tbl TEXT;
  child_tables TEXT[] := ARRAY[
    'activities',
    'assumption_history',
    'assumptions',
    'audit_logs',
    'cash_flows',
    'deal_assignments',
    'deal_comments',
    'deal_milestones',
    'deal_relationships',
    'decision_logs',
    'development_budget',
    'documents',
    'financial_outputs',
    'generated_reports',
    'investment_memos',
    'reconciliation_flags',
    'revenue_program',
    'risk_register',
    'scenarios',
    'underwriting_inputs'
  ];
BEGIN
  FOREACH tbl IN ARRAY child_tables LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = tbl
        AND column_name = 'project_id'
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS "%1$s_workspace_member" ON public.%1$I', tbl);
      EXECUTE format('DROP POLICY IF EXISTS "%1$s_workspace_member_select" ON public.%1$I', tbl);
      EXECUTE format('DROP POLICY IF EXISTS "%1$s_workspace_member_insert" ON public.%1$I', tbl);
      EXECUTE format('DROP POLICY IF EXISTS "%1$s_workspace_member_update" ON public.%1$I', tbl);
      EXECUTE format('DROP POLICY IF EXISTS "%1$s_workspace_member_delete" ON public.%1$I', tbl);
      EXECUTE format('DROP POLICY IF EXISTS "%1$s_workspace_write_guard_insert" ON public.%1$I', tbl);
      EXECUTE format('DROP POLICY IF EXISTS "%1$s_workspace_write_guard_update" ON public.%1$I', tbl);
      EXECUTE format('DROP POLICY IF EXISTS "%1$s_workspace_write_guard_delete" ON public.%1$I', tbl);

      EXECUTE format($policy$
        CREATE POLICY "%1$s_workspace_member_select" ON public.%1$I
          FOR SELECT TO authenticated
          USING (EXISTS (
            SELECT 1
            FROM public.projects p
            WHERE p.id = %1$I.project_id
              AND p.workspace_id IS NOT NULL
              AND public.is_workspace_member(p.workspace_id)
          ))
      $policy$, tbl);

      EXECUTE format($policy$
        CREATE POLICY "%1$s_workspace_member_insert" ON public.%1$I
          FOR INSERT TO authenticated
          WITH CHECK (EXISTS (
            SELECT 1
            FROM public.projects p
            WHERE p.id = %1$I.project_id
              AND p.workspace_id IS NOT NULL
              AND public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
          ))
      $policy$, tbl);

      EXECUTE format($policy$
        CREATE POLICY "%1$s_workspace_member_update" ON public.%1$I
          FOR UPDATE TO authenticated
          USING (EXISTS (
            SELECT 1
            FROM public.projects p
            WHERE p.id = %1$I.project_id
              AND p.workspace_id IS NOT NULL
              AND public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
          ))
          WITH CHECK (EXISTS (
            SELECT 1
            FROM public.projects p
            WHERE p.id = %1$I.project_id
              AND p.workspace_id IS NOT NULL
              AND public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
          ))
      $policy$, tbl);

      EXECUTE format($policy$
        CREATE POLICY "%1$s_workspace_member_delete" ON public.%1$I
          FOR DELETE TO authenticated
          USING (EXISTS (
            SELECT 1
            FROM public.projects p
            WHERE p.id = %1$I.project_id
              AND p.workspace_id IS NOT NULL
              AND public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
          ))
      $policy$, tbl);

      EXECUTE format($policy$
        CREATE POLICY "%1$s_workspace_write_guard_insert" ON public.%1$I
          AS RESTRICTIVE
          FOR INSERT TO authenticated
          WITH CHECK (
            %1$I.project_id IS NULL
            OR EXISTS (
              SELECT 1
              FROM public.projects p
              WHERE p.id = %1$I.project_id
                AND (
                  p.workspace_id IS NULL
                  OR public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
                )
            )
          )
      $policy$, tbl);

      EXECUTE format($policy$
        CREATE POLICY "%1$s_workspace_write_guard_update" ON public.%1$I
          AS RESTRICTIVE
          FOR UPDATE TO authenticated
          USING (
            %1$I.project_id IS NULL
            OR EXISTS (
              SELECT 1
              FROM public.projects p
              WHERE p.id = %1$I.project_id
                AND (
                  p.workspace_id IS NULL
                  OR public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
                )
            )
          )
          WITH CHECK (
            %1$I.project_id IS NULL
            OR EXISTS (
              SELECT 1
              FROM public.projects p
              WHERE p.id = %1$I.project_id
                AND (
                  p.workspace_id IS NULL
                  OR public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
                )
            )
          )
      $policy$, tbl);

      EXECUTE format($policy$
        CREATE POLICY "%1$s_workspace_write_guard_delete" ON public.%1$I
          AS RESTRICTIVE
          FOR DELETE TO authenticated
          USING (
            %1$I.project_id IS NULL
            OR EXISTS (
              SELECT 1
              FROM public.projects p
              WHERE p.id = %1$I.project_id
                AND (
                  p.workspace_id IS NULL
                  OR public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
                )
            )
          )
      $policy$, tbl);
    END IF;
  END LOOP;
END $$;

-- These three operating-depth policies were created as FOR ALL policies after
-- the first workspace migration. Drop them so the split policies above become
-- the only workspace path for project-scoped collaboration rows.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'deal_relationships') THEN
    DROP POLICY IF EXISTS "deal_relationships_access" ON public.deal_relationships;
    DROP POLICY IF EXISTS "deal_relationships_owner_all" ON public.deal_relationships;
    CREATE POLICY "deal_relationships_owner_all" ON public.deal_relationships
      FOR ALL TO authenticated
      USING (owner_id = auth.uid())
      WITH CHECK (owner_id = auth.uid());
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'deal_assignments') THEN
    DROP POLICY IF EXISTS "deal_assignments_access" ON public.deal_assignments;
    DROP POLICY IF EXISTS "deal_assignments_self_select" ON public.deal_assignments;
    DROP POLICY IF EXISTS "deal_assignments_assigner_all" ON public.deal_assignments;
    CREATE POLICY "deal_assignments_self_select" ON public.deal_assignments
      FOR SELECT TO authenticated
      USING (user_id = auth.uid() OR assigned_by = auth.uid());
    CREATE POLICY "deal_assignments_assigner_all" ON public.deal_assignments
      FOR ALL TO authenticated
      USING (assigned_by = auth.uid())
      WITH CHECK (assigned_by = auth.uid());
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'deal_comments') THEN
    DROP POLICY IF EXISTS "deal_comments_access" ON public.deal_comments;
    DROP POLICY IF EXISTS "deal_comments_author_all" ON public.deal_comments;
    CREATE POLICY "deal_comments_author_all" ON public.deal_comments
      FOR ALL TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- ---- Deal-child rows scoped through assumption_id ----
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'assumption_versions'
      AND column_name = 'assumption_id'
  ) THEN
    DROP POLICY IF EXISTS "assumption_versions_workspace_member" ON public.assumption_versions;
    DROP POLICY IF EXISTS "assumption_versions_workspace_member_select" ON public.assumption_versions;
    DROP POLICY IF EXISTS "assumption_versions_workspace_member_insert" ON public.assumption_versions;
    DROP POLICY IF EXISTS "assumption_versions_workspace_member_update" ON public.assumption_versions;
    DROP POLICY IF EXISTS "assumption_versions_workspace_member_delete" ON public.assumption_versions;
    DROP POLICY IF EXISTS "assumption_versions_workspace_write_guard_insert" ON public.assumption_versions;
    DROP POLICY IF EXISTS "assumption_versions_workspace_write_guard_update" ON public.assumption_versions;
    DROP POLICY IF EXISTS "assumption_versions_workspace_write_guard_delete" ON public.assumption_versions;

    CREATE POLICY "assumption_versions_workspace_member_select" ON public.assumption_versions
      FOR SELECT TO authenticated
      USING (EXISTS (
        SELECT 1
        FROM public.assumptions a
        JOIN public.projects p ON p.id = a.project_id
        WHERE a.id = assumption_versions.assumption_id
          AND p.workspace_id IS NOT NULL
          AND public.is_workspace_member(p.workspace_id)
      ));
    CREATE POLICY "assumption_versions_workspace_member_insert" ON public.assumption_versions
      FOR INSERT TO authenticated
      WITH CHECK (EXISTS (
        SELECT 1
        FROM public.assumptions a
        JOIN public.projects p ON p.id = a.project_id
        WHERE a.id = assumption_versions.assumption_id
          AND p.workspace_id IS NOT NULL
          AND public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
      ));
    CREATE POLICY "assumption_versions_workspace_member_update" ON public.assumption_versions
      FOR UPDATE TO authenticated
      USING (EXISTS (
        SELECT 1
        FROM public.assumptions a
        JOIN public.projects p ON p.id = a.project_id
        WHERE a.id = assumption_versions.assumption_id
          AND p.workspace_id IS NOT NULL
          AND public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
      ))
      WITH CHECK (EXISTS (
        SELECT 1
        FROM public.assumptions a
        JOIN public.projects p ON p.id = a.project_id
        WHERE a.id = assumption_versions.assumption_id
          AND p.workspace_id IS NOT NULL
          AND public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
      ));
    CREATE POLICY "assumption_versions_workspace_member_delete" ON public.assumption_versions
      FOR DELETE TO authenticated
      USING (EXISTS (
        SELECT 1
        FROM public.assumptions a
        JOIN public.projects p ON p.id = a.project_id
        WHERE a.id = assumption_versions.assumption_id
          AND p.workspace_id IS NOT NULL
          AND public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
      ));
    CREATE POLICY "assumption_versions_workspace_write_guard_insert" ON public.assumption_versions
      AS RESTRICTIVE
      FOR INSERT TO authenticated
      WITH CHECK (EXISTS (
        SELECT 1
        FROM public.assumptions a
        JOIN public.projects p ON p.id = a.project_id
        WHERE a.id = assumption_versions.assumption_id
          AND (
            p.workspace_id IS NULL
            OR public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
          )
      ));
    CREATE POLICY "assumption_versions_workspace_write_guard_update" ON public.assumption_versions
      AS RESTRICTIVE
      FOR UPDATE TO authenticated
      USING (EXISTS (
        SELECT 1
        FROM public.assumptions a
        JOIN public.projects p ON p.id = a.project_id
        WHERE a.id = assumption_versions.assumption_id
          AND (
            p.workspace_id IS NULL
            OR public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
          )
      ))
      WITH CHECK (EXISTS (
        SELECT 1
        FROM public.assumptions a
        JOIN public.projects p ON p.id = a.project_id
        WHERE a.id = assumption_versions.assumption_id
          AND (
            p.workspace_id IS NULL
            OR public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
          )
      ));
    CREATE POLICY "assumption_versions_workspace_write_guard_delete" ON public.assumption_versions
      AS RESTRICTIVE
      FOR DELETE TO authenticated
      USING (EXISTS (
        SELECT 1
        FROM public.assumptions a
        JOIN public.projects p ON p.id = a.project_id
        WHERE a.id = assumption_versions.assumption_id
          AND (
            p.workspace_id IS NULL
            OR public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
          )
      ));
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'assumption_comments'
      AND column_name = 'assumption_id'
  ) THEN
    DROP POLICY IF EXISTS "assumption_comments_workspace_member" ON public.assumption_comments;
    DROP POLICY IF EXISTS "assumption_comments_workspace_member_select" ON public.assumption_comments;
    DROP POLICY IF EXISTS "assumption_comments_workspace_member_insert" ON public.assumption_comments;
    DROP POLICY IF EXISTS "assumption_comments_workspace_member_update" ON public.assumption_comments;
    DROP POLICY IF EXISTS "assumption_comments_workspace_member_delete" ON public.assumption_comments;
    DROP POLICY IF EXISTS "assumption_comments_workspace_write_guard_insert" ON public.assumption_comments;
    DROP POLICY IF EXISTS "assumption_comments_workspace_write_guard_update" ON public.assumption_comments;
    DROP POLICY IF EXISTS "assumption_comments_workspace_write_guard_delete" ON public.assumption_comments;

    CREATE POLICY "assumption_comments_workspace_member_select" ON public.assumption_comments
      FOR SELECT TO authenticated
      USING (EXISTS (
        SELECT 1
        FROM public.assumptions a
        JOIN public.projects p ON p.id = a.project_id
        WHERE a.id = assumption_comments.assumption_id
          AND p.workspace_id IS NOT NULL
          AND public.is_workspace_member(p.workspace_id)
      ));
    CREATE POLICY "assumption_comments_workspace_member_insert" ON public.assumption_comments
      FOR INSERT TO authenticated
      WITH CHECK (EXISTS (
        SELECT 1
        FROM public.assumptions a
        JOIN public.projects p ON p.id = a.project_id
        WHERE a.id = assumption_comments.assumption_id
          AND p.workspace_id IS NOT NULL
          AND public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
      ));
    CREATE POLICY "assumption_comments_workspace_member_update" ON public.assumption_comments
      FOR UPDATE TO authenticated
      USING (EXISTS (
        SELECT 1
        FROM public.assumptions a
        JOIN public.projects p ON p.id = a.project_id
        WHERE a.id = assumption_comments.assumption_id
          AND p.workspace_id IS NOT NULL
          AND public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
      ))
      WITH CHECK (EXISTS (
        SELECT 1
        FROM public.assumptions a
        JOIN public.projects p ON p.id = a.project_id
        WHERE a.id = assumption_comments.assumption_id
          AND p.workspace_id IS NOT NULL
          AND public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
      ));
    CREATE POLICY "assumption_comments_workspace_member_delete" ON public.assumption_comments
      FOR DELETE TO authenticated
      USING (EXISTS (
        SELECT 1
        FROM public.assumptions a
        JOIN public.projects p ON p.id = a.project_id
        WHERE a.id = assumption_comments.assumption_id
          AND p.workspace_id IS NOT NULL
          AND public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
      ));
    CREATE POLICY "assumption_comments_workspace_write_guard_insert" ON public.assumption_comments
      AS RESTRICTIVE
      FOR INSERT TO authenticated
      WITH CHECK (EXISTS (
        SELECT 1
        FROM public.assumptions a
        JOIN public.projects p ON p.id = a.project_id
        WHERE a.id = assumption_comments.assumption_id
          AND (
            p.workspace_id IS NULL
            OR public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
          )
      ));
    CREATE POLICY "assumption_comments_workspace_write_guard_update" ON public.assumption_comments
      AS RESTRICTIVE
      FOR UPDATE TO authenticated
      USING (EXISTS (
        SELECT 1
        FROM public.assumptions a
        JOIN public.projects p ON p.id = a.project_id
        WHERE a.id = assumption_comments.assumption_id
          AND (
            p.workspace_id IS NULL
            OR public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
          )
      ))
      WITH CHECK (EXISTS (
        SELECT 1
        FROM public.assumptions a
        JOIN public.projects p ON p.id = a.project_id
        WHERE a.id = assumption_comments.assumption_id
          AND (
            p.workspace_id IS NULL
            OR public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
          )
      ));
    CREATE POLICY "assumption_comments_workspace_write_guard_delete" ON public.assumption_comments
      AS RESTRICTIVE
      FOR DELETE TO authenticated
      USING (EXISTS (
        SELECT 1
        FROM public.assumptions a
        JOIN public.projects p ON p.id = a.project_id
        WHERE a.id = assumption_comments.assumption_id
          AND (
            p.workspace_id IS NULL
            OR public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
          )
      ));
  END IF;
END $$;

-- ---- Last-owner protection ----
CREATE OR REPLACE FUNCTION public.prevent_last_workspace_owner_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_count INTEGER;
BEGIN
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

DROP TRIGGER IF EXISTS prevent_last_workspace_owner_removal ON public.workspace_members;
CREATE TRIGGER prevent_last_workspace_owner_removal
  BEFORE UPDATE OF role OR DELETE ON public.workspace_members
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_last_workspace_owner_removal();
