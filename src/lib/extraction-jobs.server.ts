// Background-job bookkeeping for extraction / underwriting work.
//
// These helpers wrap the extraction_jobs table so a long-running unit of work
// (large OCR, full underwriting) is represented by a row with status + progress
// that the UI can poll. The same row doubles as an idempotency record: a job is
// keyed by (owner, kind, idempotency_key) where idempotency_key is the
// content-hash of the work's inputs, so a double-click or retry re-attaches to
// the existing job rather than re-running billing-relevant work.
//
// NOTE: execution is still in-request (serverless). The job row is what makes
// status observable and makes a timeout fail-safe (the row stays 'running' and
// can be reconciled) rather than silently corrupting partial state. Moving
// execution onto a dedicated worker/queue is a drop-in next step: the contract
// (claim a 'queued' row, set 'running', write progress, finalize) is already here.

export type JobKind = "document_analysis" | "assumption_extraction" | "underwriting";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export type ExtractionJob = {
  id: string;
  status: JobStatus;
  progress: number;
  total: number | null;
  message: string | null;
  result_json: unknown;
  error: string | null;
};

type Ctx = { supabase: any; userId: string };

/**
 * Find-or-create the idempotent job for this unit of work. Returns the job and
 * whether it already existed (so callers can short-circuit completed work).
 */
export async function claimJob(
  ctx: Ctx,
  args: {
    kind: JobKind;
    idempotencyKey: string;
    projectId?: string | null;
    documentId?: string | null;
    total?: number | null;
    message?: string | null;
  },
): Promise<{ job: ExtractionJob; existed: boolean }> {
  const { data: existing } = await ctx.supabase
    .from("extraction_jobs")
    .select("*")
    .eq("owner_id", ctx.userId)
    .eq("kind", args.kind)
    .eq("idempotency_key", args.idempotencyKey)
    .maybeSingle();
  if (existing) return { job: existing as ExtractionJob, existed: true };

  const { data: row, error } = await ctx.supabase
    .from("extraction_jobs")
    .insert({
      owner_id: ctx.userId,
      kind: args.kind,
      idempotency_key: args.idempotencyKey,
      project_id: args.projectId ?? null,
      document_id: args.documentId ?? null,
      status: "running",
      started_at: new Date().toISOString(),
      progress: 0,
      total: args.total ?? null,
      message: args.message ?? null,
    })
    .select()
    .single();
  // A concurrent request may have inserted the same key first; re-read it.
  if (error) {
    const { data: raced } = await ctx.supabase
      .from("extraction_jobs")
      .select("*")
      .eq("owner_id", ctx.userId)
      .eq("kind", args.kind)
      .eq("idempotency_key", args.idempotencyKey)
      .maybeSingle();
    if (raced) return { job: raced as ExtractionJob, existed: true };
    throw new Error(error.message);
  }
  return { job: row as ExtractionJob, existed: false };
}

export async function updateJobProgress(
  ctx: Ctx,
  jobId: string,
  patch: { progress?: number; total?: number | null; message?: string | null },
): Promise<void> {
  await ctx.supabase.from("extraction_jobs").update(patch).eq("id", jobId);
}

export async function completeJob(ctx: Ctx, jobId: string, result: unknown): Promise<void> {
  await ctx.supabase
    .from("extraction_jobs")
    .update({
      status: "completed",
      progress: 100,
      result_json: result as object,
      finished_at: new Date().toISOString(),
      error: null,
    })
    .eq("id", jobId);
}

export async function failJob(ctx: Ctx, jobId: string, message: string): Promise<void> {
  await ctx.supabase
    .from("extraction_jobs")
    .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
    .eq("id", jobId);
  // Surface job failures to the error sink (structured stderr + optional
  // webhook) so a spike in failed extractions is observable/alertable.
  try {
    const { captureServerError } = await import("./observability.server");
    captureServerError(new Error(message), { kind: "extraction_job_failed", jobId });
  } catch {
    /* observability must never break the job path */
  }
}
