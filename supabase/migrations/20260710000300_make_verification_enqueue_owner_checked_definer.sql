-- The browser has SELECT-only access to pending_document_uploads by design.
-- enqueue_document_verification performs a tightly scoped state transition
-- after checking auth.uid() = owner_id, so it must execute with definer table
-- privileges; direct browser UPDATE remains unavailable.
ALTER FUNCTION public.enqueue_document_verification(UUID) SECURITY DEFINER;
