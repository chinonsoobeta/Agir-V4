-- Atomic persistence for deterministic underwriting runs.
--
-- The engine still computes in TypeScript. This RPC only commits the already
-- deterministic rows as one database transaction: run metadata, immutable run
-- history, latest compatibility tables, audit event, and job completion state.
--
-- MIGRATION_SAFETY_REVIEW: the DELETE statements below are project-scoped
-- refreshes of latest compatibility tables inside the same transaction that
-- inserts immutable run-scoped history rows and repopulates those latest tables.

CREATE OR REPLACE FUNCTION public.persist_underwriting_run_transaction(
  p_project_id UUID,
  p_owner_id UUID,
  p_created_by UUID,
  p_run_mode TEXT,
  p_status TEXT,
  p_input_fingerprint TEXT,
  p_output_fingerprint TEXT DEFAULT NULL,
  p_verdict_code TEXT DEFAULT NULL,
  p_blocked_reasons JSONB DEFAULT '[]'::jsonb,
  p_accepted_defaults_used JSONB DEFAULT '[]'::jsonb,
  p_conflict_resolutions_used JSONB DEFAULT '[]'::jsonb,
  p_input_snapshot JSONB DEFAULT '{}'::jsonb,
  p_output_snapshot JSONB DEFAULT '[]'::jsonb,
  p_financial_outputs JSONB DEFAULT '[]'::jsonb,
  p_cash_flows JSONB DEFAULT '[]'::jsonb,
  p_reconciliation_flags JSONB DEFAULT '[]'::jsonb,
  p_risk_register JSONB DEFAULT '[]'::jsonb,
  p_audit_payload JSONB DEFAULT '{}'::jsonb,
  p_job_id UUID DEFAULT NULL,
  p_job_result JSONB DEFAULT NULL
)
RETURNS public.underwriting_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run public.underwriting_runs%ROWTYPE;
  v_run_number INTEGER;
  v_job_result JSONB;
BEGIN
  IF auth.uid() IS NULL OR p_owner_id <> auth.uid() OR p_created_by <> auth.uid() THEN
    RAISE EXCEPTION 'underwriting run transaction requires the authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = p_project_id
      AND (
        (p.workspace_id IS NULL AND p.owner_id = auth.uid())
        OR public.workspace_role(p.workspace_id) IN ('owner', 'admin', 'member')
      )
  ) THEN
    RAISE EXCEPTION 'permission denied for underwriting run transaction'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_project_id::text, 0));

  SELECT COALESCE(MAX(run_number), 0) + 1
  INTO v_run_number
  FROM public.underwriting_runs
  WHERE project_id = p_project_id;

  INSERT INTO public.underwriting_runs (
    project_id,
    owner_id,
    run_number,
    run_mode,
    status,
    input_fingerprint,
    output_fingerprint,
    verdict_code,
    blocked_reasons,
    accepted_defaults_used,
    conflict_resolutions_used,
    input_snapshot,
    output_snapshot,
    created_by
  )
  VALUES (
    p_project_id,
    p_owner_id,
    v_run_number,
    p_run_mode,
    p_status,
    p_input_fingerprint,
    p_output_fingerprint,
    p_verdict_code,
    COALESCE(p_blocked_reasons, '[]'::jsonb),
    COALESCE(p_accepted_defaults_used, '[]'::jsonb),
    COALESCE(p_conflict_resolutions_used, '[]'::jsonb),
    COALESCE(p_input_snapshot, '{}'::jsonb),
    COALESCE(p_output_snapshot, '[]'::jsonb),
    p_created_by
  )
  RETURNING * INTO v_run;

  IF p_status = 'completed' THEN
    DELETE FROM public.financial_outputs WHERE project_id = p_project_id;
    DELETE FROM public.cash_flows WHERE project_id = p_project_id;
    DELETE FROM public.reconciliation_flags WHERE project_id = p_project_id;
    DELETE FROM public.risk_register WHERE project_id = p_project_id;

    INSERT INTO public.run_financial_outputs (
      run_id,
      project_id,
      owner_id,
      scenario_key,
      metric_key,
      metric_label,
      value_numeric,
      unit,
      formula_text,
      inputs
    )
    SELECT
      v_run.id,
      p_project_id,
      p_owner_id,
      COALESCE(r.scenario_key, 'base'),
      r.metric_key,
      r.metric_label,
      r.value_numeric,
      r.unit,
      r.formula_text,
      r.inputs
    FROM jsonb_to_recordset(COALESCE(p_financial_outputs, '[]'::jsonb)) AS r(
      scenario_key TEXT,
      metric_key TEXT,
      metric_label TEXT,
      value_numeric NUMERIC,
      unit TEXT,
      formula_text TEXT,
      inputs JSONB
    );

    INSERT INTO public.financial_outputs (
      project_id,
      owner_id,
      run_id,
      scenario_key,
      metric_key,
      metric_label,
      value_numeric,
      unit,
      formula_text,
      inputs
    )
    SELECT
      p_project_id,
      p_owner_id,
      v_run.id,
      COALESCE(r.scenario_key, 'base'),
      r.metric_key,
      r.metric_label,
      r.value_numeric,
      r.unit,
      r.formula_text,
      r.inputs
    FROM jsonb_to_recordset(COALESCE(p_financial_outputs, '[]'::jsonb)) AS r(
      scenario_key TEXT,
      metric_key TEXT,
      metric_label TEXT,
      value_numeric NUMERIC,
      unit TEXT,
      formula_text TEXT,
      inputs JSONB
    );

    INSERT INTO public.run_cash_flows (
      run_id,
      project_id,
      owner_id,
      scenario_key,
      period_year,
      line_key,
      amount
    )
    SELECT
      v_run.id,
      p_project_id,
      p_owner_id,
      COALESCE(r.scenario_key, 'base'),
      r.period_year,
      r.line_key::public.cash_flow_line_key,
      r.amount
    FROM jsonb_to_recordset(COALESCE(p_cash_flows, '[]'::jsonb)) AS r(
      scenario_key TEXT,
      period_year INTEGER,
      line_key TEXT,
      amount NUMERIC
    );

    INSERT INTO public.cash_flows (
      project_id,
      owner_id,
      run_id,
      scenario_key,
      period_year,
      line_key,
      amount
    )
    SELECT
      p_project_id,
      p_owner_id,
      v_run.id,
      COALESCE(r.scenario_key, 'base'),
      r.period_year,
      r.line_key::public.cash_flow_line_key,
      r.amount
    FROM jsonb_to_recordset(COALESCE(p_cash_flows, '[]'::jsonb)) AS r(
      scenario_key TEXT,
      period_year INTEGER,
      line_key TEXT,
      amount NUMERIC
    );

    INSERT INTO public.run_reconciliation_flags (
      run_id,
      project_id,
      owner_id,
      check_key,
      severity,
      message,
      expected,
      actual,
      resolved
    )
    SELECT
      v_run.id,
      p_project_id,
      p_owner_id,
      r.check_key,
      COALESCE(r.severity, 'info')::public.reconciliation_severity,
      r.message,
      r.expected,
      r.actual,
      COALESCE(r.resolved, false)
    FROM jsonb_to_recordset(COALESCE(p_reconciliation_flags, '[]'::jsonb)) AS r(
      check_key TEXT,
      severity TEXT,
      message TEXT,
      expected NUMERIC,
      actual NUMERIC,
      resolved BOOLEAN
    );

    INSERT INTO public.reconciliation_flags (
      project_id,
      owner_id,
      run_id,
      check_key,
      severity,
      message,
      expected,
      actual,
      resolved
    )
    SELECT
      p_project_id,
      p_owner_id,
      v_run.id,
      r.check_key,
      COALESCE(r.severity, 'info')::public.reconciliation_severity,
      r.message,
      r.expected,
      r.actual,
      COALESCE(r.resolved, false)
    FROM jsonb_to_recordset(COALESCE(p_reconciliation_flags, '[]'::jsonb)) AS r(
      check_key TEXT,
      severity TEXT,
      message TEXT,
      expected NUMERIC,
      actual NUMERIC,
      resolved BOOLEAN
    );

    INSERT INTO public.run_risk_register (
      run_id,
      project_id,
      owner_id,
      risk_type,
      severity,
      title,
      description,
      related_assumption_id
    )
    SELECT
      v_run.id,
      p_project_id,
      p_owner_id,
      r.risk_type,
      COALESCE(r.severity, 'yellow')::public.risk_severity,
      r.title,
      r.description,
      r.related_assumption_id
    FROM jsonb_to_recordset(COALESCE(p_risk_register, '[]'::jsonb)) AS r(
      risk_type TEXT,
      severity TEXT,
      title TEXT,
      description TEXT,
      related_assumption_id UUID
    );

    INSERT INTO public.risk_register (
      project_id,
      owner_id,
      run_id,
      risk_type,
      severity,
      title,
      description,
      related_assumption_id
    )
    SELECT
      p_project_id,
      p_owner_id,
      v_run.id,
      r.risk_type,
      COALESCE(r.severity, 'yellow')::public.risk_severity,
      r.title,
      r.description,
      r.related_assumption_id
    FROM jsonb_to_recordset(COALESCE(p_risk_register, '[]'::jsonb)) AS r(
      risk_type TEXT,
      severity TEXT,
      title TEXT,
      description TEXT,
      related_assumption_id UUID
    );
  END IF;

  INSERT INTO public.audit_logs (
    project_id,
    owner_id,
    user_id,
    entity_type,
    entity_id,
    action,
    payload
  )
  VALUES (
    p_project_id,
    p_owner_id,
    p_created_by,
    'project',
    p_project_id,
    CASE WHEN p_status = 'blocked' THEN 'underwriting_blocked' ELSE 'run_full_underwriting' END,
    COALESCE(p_audit_payload, '{}'::jsonb) || jsonb_build_object(
      'run_id', v_run.id,
      'run_number', v_run.run_number,
      'input_fingerprint', v_run.input_fingerprint,
      'output_fingerprint', v_run.output_fingerprint
    )
  );

  IF p_job_id IS NOT NULL THEN
    v_job_result := COALESCE(p_job_result, '{}'::jsonb) || jsonb_build_object(
      'run_version',
      jsonb_build_object('id', v_run.id, 'run_number', v_run.run_number, 'status', v_run.status)
    );

    UPDATE public.extraction_jobs
    SET status = 'completed',
        progress = 100,
        result_json = v_job_result,
        finished_at = now(),
        error = NULL,
        lease_owner = NULL,
        lease_expires_at = NULL
    WHERE id = p_job_id
      AND owner_id = p_owner_id;
  END IF;

  RETURN v_run;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_underwriting_run_transaction(
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  JSONB,
  JSONB,
  JSONB,
  JSONB,
  JSONB,
  JSONB,
  JSONB,
  JSONB,
  JSONB,
  JSONB,
  UUID,
  JSONB
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.persist_underwriting_run_transaction(
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  JSONB,
  JSONB,
  JSONB,
  JSONB,
  JSONB,
  JSONB,
  JSONB,
  JSONB,
  JSONB,
  JSONB,
  UUID,
  JSONB
) TO authenticated;

NOTIFY pgrst, 'reload schema';
