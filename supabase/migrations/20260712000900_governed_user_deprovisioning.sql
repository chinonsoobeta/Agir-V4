-- Governed user deprovisioning.
--
-- Core Property and Permit attribution becomes nullable in 008. Several older
-- Underwriting tables still own durable records through ON DELETE CASCADE,
-- however. Until each record has been reassigned, exported, retained, or
-- deliberately deleted under an approved policy, deleting auth.users must fail
-- instead of silently erasing part of the institutional record.

-- The delete guard must not full-scan every durable table while holding an
-- auth.users row lock. Add missing leading indexes for governed user foreign
-- keys. Existing single- or multi-column indexes with the FK as a leading
-- column are reused.
DO $$
DECLARE v_fk record;
BEGIN
  FOR v_fk IN
    SELECT
      fk.conrelid,
      n.nspname AS schema_name,
      c.relname AS table_name,
      a.attname AS column_name
    FROM pg_constraint fk
    JOIN pg_class c ON c.oid = fk.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a
      ON a.attrelid = fk.conrelid AND a.attnum = fk.conkey[1]
    WHERE fk.contype = 'f'
      AND fk.confrelid = 'auth.users'::regclass
      AND cardinality(fk.conkey) = 1
      AND n.nspname = 'public'
      AND c.relname <> ALL (ARRAY[
        'profiles', 'user_roles', 'user_preferences', 'workspace_members',
        'workspace_invitations', 'pilot_user_access',
        'notification_preferences', 'notification_events'
      ])
      AND NOT EXISTS (
        SELECT 1
        FROM pg_index existing_index
        WHERE existing_index.indrelid = fk.conrelid
          AND existing_index.indisvalid
          AND existing_index.indpred IS NULL
          AND existing_index.indexprs IS NULL
          AND (existing_index.indkey::smallint[])[1] = fk.conkey[1]
      )
  LOOP
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.%I (%I)',
      'agir_deprovision_' || substr(md5(
        v_fk.schema_name || '.' || v_fk.table_name || '.' || v_fk.column_name
      ), 1, 16) || '_idx',
      v_fk.schema_name,
      v_fk.table_name,
      v_fk.column_name
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.user_deprovision_blockers(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_catalog
AS $$
DECLARE
  v_fk record;
  v_count bigint;
  v_blockers jsonb := '{}'::jsonb;
  v_disposable_tables constant text[] := ARRAY[
    'profiles',
    'user_roles',
    'user_preferences',
    'workspace_members',
    'workspace_invitations',
    'pilot_user_access',
    'notification_preferences',
    'notification_events'
  ];
BEGIN
  IF p_user_id IS NULL THEN RETURN v_blockers; END IF;
  FOR v_fk IN
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      a.attname AS column_name
    FROM pg_constraint fk
    JOIN pg_class c ON c.oid=fk.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=fk.conrelid AND a.attnum=fk.conkey[1]
    WHERE fk.contype='f'
      AND fk.confrelid='auth.users'::regclass
      AND fk.confdeltype='c'
      AND cardinality(fk.conkey)=1
      AND n.nspname='public'
      AND NOT (c.relname=ANY(v_disposable_tables))
    ORDER BY c.relname,a.attname
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I.%I WHERE %I=$1',
      v_fk.schema_name,v_fk.table_name,v_fk.column_name
    ) INTO v_count USING p_user_id;
    IF v_count>0 THEN
      v_blockers:=v_blockers || jsonb_build_object(
        v_fk.table_name || '.' || v_fk.column_name,
        v_count
      );
    END IF;
  END LOOP;

  -- Membership rows are normally disposable access records, but deleting the
  -- last owner would strand the workspace and every durable record beneath it.
  SELECT count(*)
  INTO v_count
  FROM public.workspace_members mine
  WHERE mine.user_id = p_user_id
    AND mine.role = 'owner'
    AND NOT EXISTS (
      SELECT 1
      FROM public.workspace_members successor
      WHERE successor.workspace_id = mine.workspace_id
        AND successor.user_id <> p_user_id
        AND successor.role = 'owner'
    );
  IF v_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_object(
      'workspace_members.sole_owner',
      v_count
    );
  END IF;

  -- A SET NULL owner foreign key preserves bytes but not access. Discover every
  -- owner/workspace table and block personal rows until they are transferred or
  -- deliberately handled. This covers current and future tenant-root tables
  -- without treating actor/assignee attribution as record ownership.
  FOR v_fk IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname = 'public'
      AND EXISTS (
        SELECT 1 FROM pg_attribute owner_column
        WHERE owner_column.attrelid = c.oid
          AND owner_column.attname = 'owner_id'
          AND owner_column.attnum > 0
          AND NOT owner_column.attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute workspace_column
        WHERE workspace_column.attrelid = c.oid
          AND workspace_column.attname = 'workspace_id'
          AND workspace_column.attnum > 0
          AND NOT workspace_column.attisdropped
      )
      AND EXISTS (
        SELECT 1
        FROM pg_constraint owner_fk
        JOIN pg_attribute owner_fk_column
          ON owner_fk_column.attrelid = owner_fk.conrelid
         AND owner_fk_column.attnum = owner_fk.conkey[1]
        WHERE owner_fk.contype = 'f'
          AND owner_fk.conrelid = c.oid
          AND owner_fk.confrelid = 'auth.users'::regclass
          AND owner_fk.confdeltype = 'n'
          AND cardinality(owner_fk.conkey) = 1
          AND owner_fk_column.attname = 'owner_id'
      )
      AND EXISTS (
        SELECT 1
        FROM pg_constraint workspace_fk
        JOIN pg_attribute workspace_fk_column
          ON workspace_fk_column.attrelid = workspace_fk.conrelid
         AND workspace_fk_column.attnum = workspace_fk.conkey[1]
        WHERE workspace_fk.contype = 'f'
          AND workspace_fk.conrelid = c.oid
          AND workspace_fk.confrelid = 'public.workspaces'::regclass
          AND cardinality(workspace_fk.conkey) = 1
          AND workspace_fk_column.attname = 'workspace_id'
      )
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I.%I WHERE owner_id=$1 AND workspace_id IS NULL',
      v_fk.schema_name,
      v_fk.table_name
    ) INTO v_count USING p_user_id;
    IF v_count > 0 THEN
      v_blockers := v_blockers || jsonb_build_object(
        v_fk.table_name || '.personal_owner',
        v_count
      );
    END IF;
  END LOOP;

  -- Documents can exist before they are attached to a deal, Permit case, or
  -- canonical Property. Those standalone uploads are also personal roots.
  SELECT count(*)
  INTO v_count
  FROM public.documents
  WHERE owner_id = p_user_id
    AND project_id IS NULL
    AND permit_case_id IS NULL
    AND property_id IS NULL;
  IF v_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_object(
      'documents.personal_owner',
      v_count
    );
  END IF;

  RETURN v_blockers;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_governed_user_deprovisioning()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_catalog
AS $$
DECLARE v_blockers jsonb;
BEGIN
  v_blockers:=public.user_deprovision_blockers(OLD.id);
  IF v_blockers<>'{}'::jsonb THEN
    RAISE EXCEPTION 'Governed offboarding is required before deleting this user'
      USING ERRCODE='23503',
        DETAIL='Durable business records still reference the user: ' || v_blockers::text,
        HINT='Reassign, export, retain, or deliberately remove each blocker under the approved offboarding policy.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS auth_users_governed_deprovisioning ON auth.users;
CREATE TRIGGER auth_users_governed_deprovisioning
  BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_governed_user_deprovisioning();

REVOKE ALL ON FUNCTION public.user_deprovision_blockers(uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_governed_user_deprovisioning()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.user_deprovision_blockers(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_governed_user_deprovisioning() TO service_role;
