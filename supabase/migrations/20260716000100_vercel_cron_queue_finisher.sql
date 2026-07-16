-- Allows a short-lived scheduler (for example Vercel Cron) to finish only the
-- job it currently owns. Retry/dead-letter semantics remain database-enforced.
CREATE OR REPLACE FUNCTION public.finish_extraction_job(
  p_job_id uuid,
  p_worker_id text,
  p_outcome text,
  p_result jsonb DEFAULT NULL,
  p_error text DEFAULT NULL,
  p_message text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts integer;
  v_max_attempts integer;
  v_status text;
BEGIN
  IF p_outcome NOT IN ('completed', 'failed', 'canceled') THEN
    RAISE EXCEPTION 'invalid extraction job outcome';
  END IF;

  SELECT attempts, max_attempts INTO v_attempts, v_max_attempts
  FROM public.extraction_jobs
  WHERE id = p_job_id
    AND status = 'running'
    AND lease_owner = p_worker_id
    AND lease_expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'worker does not own a live extraction job lease';
  END IF;

  v_status := CASE
    WHEN p_outcome = 'failed' AND v_attempts >= v_max_attempts THEN 'dead_lettered'
    WHEN p_outcome = 'failed' THEN 'queued'
    ELSE p_outcome
  END;

  UPDATE public.extraction_jobs
  SET status = v_status,
      progress = CASE WHEN v_status = 'completed' THEN 100 ELSE progress END,
      result_json = p_result,
      error = CASE WHEN p_outcome = 'failed' THEN left(coalesce(p_error, 'Worker failed'), 2000) ELSE NULL END,
      message = CASE
        WHEN v_status = 'queued' THEN 'Retry queued after worker failure'
        WHEN v_status = 'dead_lettered' THEN 'Dead-lettered after max attempts'
        ELSE left(coalesce(p_message, CASE WHEN v_status = 'completed' THEN 'Completed by queue worker' ELSE 'Canceled' END), 1000)
      END,
      finished_at = CASE WHEN v_status IN ('completed', 'canceled', 'dead_lettered') THEN now() ELSE NULL END,
      dead_lettered_at = CASE WHEN v_status = 'dead_lettered' THEN coalesce(dead_lettered_at, now()) ELSE dead_lettered_at END,
      lease_owner = NULL,
      lease_expires_at = NULL,
      heartbeat_at = now()
  WHERE id = p_job_id;

  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_extraction_job(uuid, text, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_extraction_job(uuid, text, text, jsonb, text, text) TO service_role;
