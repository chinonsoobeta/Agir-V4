-- Lock normalized run history writes to trusted server paths.
-- Historical rows must match the completed underwriting run they claim.

CREATE OR REPLACE FUNCTION public.validate_run_history_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  run_row public.underwriting_runs%ROWTYPE;
BEGIN
  SELECT *
  INTO run_row
  FROM public.underwriting_runs
  WHERE id = NEW.run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'run history row references an unknown underwriting run'
      USING ERRCODE = '23503';
  END IF;

  IF run_row.status <> 'completed' THEN
    RAISE EXCEPTION 'run history rows may only reference completed underwriting runs'
      USING ERRCODE = '23514';
  END IF;

  IF run_row.project_id <> NEW.project_id THEN
    RAISE EXCEPTION 'run history project_id must match underwriting_runs.project_id'
      USING ERRCODE = '23514';
  END IF;

  IF run_row.owner_id <> NEW.owner_id THEN
    RAISE EXCEPTION 'run history owner_id must match underwriting_runs.owner_id'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.run_financial_outputs h
    LEFT JOIN public.underwriting_runs r ON r.id = h.run_id
    WHERE r.id IS NULL
       OR r.status <> 'completed'
       OR r.project_id <> h.project_id
       OR r.owner_id <> h.owner_id
  ) THEN
    RAISE EXCEPTION 'existing run_financial_outputs rows fail run integrity validation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.run_cash_flows h
    LEFT JOIN public.underwriting_runs r ON r.id = h.run_id
    WHERE r.id IS NULL
       OR r.status <> 'completed'
       OR r.project_id <> h.project_id
       OR r.owner_id <> h.owner_id
  ) THEN
    RAISE EXCEPTION 'existing run_cash_flows rows fail run integrity validation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.run_reconciliation_flags h
    LEFT JOIN public.underwriting_runs r ON r.id = h.run_id
    WHERE r.id IS NULL
       OR r.status <> 'completed'
       OR r.project_id <> h.project_id
       OR r.owner_id <> h.owner_id
  ) THEN
    RAISE EXCEPTION 'existing run_reconciliation_flags rows fail run integrity validation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.run_risk_register h
    LEFT JOIN public.underwriting_runs r ON r.id = h.run_id
    WHERE r.id IS NULL
       OR r.status <> 'completed'
       OR r.project_id <> h.project_id
       OR r.owner_id <> h.owner_id
  ) THEN
    RAISE EXCEPTION 'existing run_risk_register rows fail run integrity validation';
  END IF;
END $$;

DROP TRIGGER IF EXISTS run_financial_outputs_validate_insert ON public.run_financial_outputs;
CREATE TRIGGER run_financial_outputs_validate_insert
  BEFORE INSERT ON public.run_financial_outputs
  FOR EACH ROW EXECUTE FUNCTION public.validate_run_history_insert();

DROP TRIGGER IF EXISTS run_cash_flows_validate_insert ON public.run_cash_flows;
CREATE TRIGGER run_cash_flows_validate_insert
  BEFORE INSERT ON public.run_cash_flows
  FOR EACH ROW EXECUTE FUNCTION public.validate_run_history_insert();

DROP TRIGGER IF EXISTS run_reconciliation_flags_validate_insert ON public.run_reconciliation_flags;
CREATE TRIGGER run_reconciliation_flags_validate_insert
  BEFORE INSERT ON public.run_reconciliation_flags
  FOR EACH ROW EXECUTE FUNCTION public.validate_run_history_insert();

DROP TRIGGER IF EXISTS run_risk_register_validate_insert ON public.run_risk_register;
CREATE TRIGGER run_risk_register_validate_insert
  BEFORE INSERT ON public.run_risk_register
  FOR EACH ROW EXECUTE FUNCTION public.validate_run_history_insert();

REVOKE INSERT ON public.run_financial_outputs FROM authenticated;
REVOKE INSERT ON public.run_cash_flows FROM authenticated;
REVOKE INSERT ON public.run_reconciliation_flags FROM authenticated;
REVOKE INSERT ON public.run_risk_register FROM authenticated;

GRANT SELECT ON public.run_financial_outputs TO authenticated;
GRANT SELECT ON public.run_cash_flows TO authenticated;
GRANT SELECT ON public.run_reconciliation_flags TO authenticated;
GRANT SELECT ON public.run_risk_register TO authenticated;
GRANT ALL ON public.run_financial_outputs TO service_role;
GRANT ALL ON public.run_cash_flows TO service_role;
GRANT ALL ON public.run_reconciliation_flags TO service_role;
GRANT ALL ON public.run_risk_register TO service_role;

DROP POLICY IF EXISTS "run_financial_outputs_insert_allowed" ON public.run_financial_outputs;
DROP POLICY IF EXISTS "run_cash_flows_insert_allowed" ON public.run_cash_flows;
DROP POLICY IF EXISTS "run_reconciliation_flags_insert_allowed" ON public.run_reconciliation_flags;
DROP POLICY IF EXISTS "run_risk_register_insert_allowed" ON public.run_risk_register;

NOTIFY pgrst, 'reload schema';
