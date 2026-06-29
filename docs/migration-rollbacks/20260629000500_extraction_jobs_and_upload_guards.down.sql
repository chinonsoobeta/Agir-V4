-- Rollback for 20260629000500_extraction_jobs_and_upload_guards.
DROP TRIGGER IF EXISTS extraction_jobs_touch ON public.extraction_jobs;
DROP FUNCTION IF EXISTS public.touch_extraction_jobs_updated_at();
DROP TABLE IF EXISTS public.extraction_jobs;
DROP INDEX IF EXISTS public.uq_documents_project_content_hash;
ALTER TABLE public.documents
  DROP COLUMN IF EXISTS content_hash,
  DROP COLUMN IF EXISTS page_count,
  DROP COLUMN IF EXISTS ocr_confidence,
  DROP COLUMN IF EXISTS extraction_status,
  DROP COLUMN IF EXISTS scan_status,
  DROP COLUMN IF EXISTS scan_detail;
