// Background-job bookkeeping for extraction / underwriting work.
//
// These helpers wrap the extraction_jobs table so a long-running unit of work
// (large OCR, full underwriting) is represented by a row with status + progress
// that the UI can poll. The same row doubles as an idempotency record: a job is
// keyed by (owner, kind, idempotency_key) where idempotency_key is the
// content-hash of the work's inputs, so a double-click or retry re-attaches to
// the existing job rather than re-running billing-relevant work.
//
// NOTE: legacy product flows can still execute work in-request, but the same
// table now also supports external workers through leases, heartbeats,
// cancellation requests, and dead-lettering. That lets expensive extraction and
// underwriting work move out of the request path without changing the UI's job
// polling contract.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { isMissingColumn, isMissingRelation } from "./db-compat";

export type JobKind = "document_analysis" | "assumption_extraction" | "underwriting";
export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "canceled"
  | "dead_lettered";

export type ExtractionJob = {
  id: string;
  status: JobStatus;
  progress: number;
  total: number | null;
  message: string | null;
  result_json: unknown;
  error: string | null;
  attempts?: number;
  max_attempts?: number;
  lease_owner?: string | null;
  lease_expires_at?: string | null;
  heartbeat_at?: string | null;
  cancellation_requested?: boolean;
  dead_lettered_at?: string | null;
};

type Ctx = { supabase: SupabaseClient<Database>; userId: string };

const QUEUE_LEASE_COLUMNS = [
  "attempts",
  "lease_owner",
  "lease_expires_at",
  "heartbeat_at",
] as const;

const INLINE_JOB_PREFIX = "inline-job:";

function isInlineJobId(jobId: string) {
  return jobId.startsWith(INLINE_JOB_PREFIX);
}

/**
 * True when claimJob fell back to an in-memory pseudo-job because the
 * extraction_jobs table is missing (pre-migration database). Such a job can
 * never be picked up by a worker, so callers must execute in-request.
 */
export function isInlineJob(job: ExtractionJob): boolean {
  return isInlineJobId(job.id);
}

function inlineJob(args: {
  kind: JobKind;
  idempotencyKey: string;
  total?: number | null;
  message?: string | null;
}): ExtractionJob {
  return {
    id: `${INLINE_JOB_PREFIX}${args.kind}:${args.idempotencyKey}`,
    status: "running",
    progress: 0,
    total: args.total ?? null,
    message: args.message ?? null,
    result_json: null,
    error: null,
  };
}

function stripQueueLeaseColumns<T extends Record<string, unknown>>(patch: T): Partial<T> {
  const copy: Record<string, unknown> = { ...patch };
  for (const column of QUEUE_LEASE_COLUMNS) delete copy[column];
  return copy as Partial<T>;
}

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
    // true -> create the job as "queued" for an external worker to claim
    // (claim_next_extraction_job); false/absent -> the caller executes the
    // work itself in-request and the job starts "running".
    enqueue?: boolean;
  },
): Promise<{ job: ExtractionJob; existed: boolean }> {
  const { data: existing, error: existingError } = await ctx.supabase
    .from("extraction_jobs")
    .select("*")
    .eq("owner_id", ctx.userId)
    .eq("kind", args.kind)
    .eq("idempotency_key", args.idempotencyKey)
    .maybeSingle();
  if (isMissingRelation(existingError)) return { job: inlineJob(args), existed: false };
  if (existingError) throw new Error(existingError.message);
  if (existing) return { job: existing as ExtractionJob, existed: true };

  const insertPayload = {
    owner_id: ctx.userId,
    kind: args.kind,
    idempotency_key: args.idempotencyKey,
    project_id: args.projectId ?? null,
    document_id: args.documentId ?? null,
    status: args.enqueue ? "queued" : "running",
    started_at: args.enqueue ? null : new Date().toISOString(),
    progress: 0,
    total: args.total ?? null,
    message: args.message ?? null,
    attempts: args.enqueue ? 0 : 1,
  };
  let { data: row, error } = await ctx.supabase
    .from("extraction_jobs")
    .insert(insertPayload)
    .select()
    .single();
  if (error) {
    if (isMissingColumn(error)) {
      const retry = await ctx.supabase
        .from("extraction_jobs")
        .insert(stripQueueLeaseColumns(insertPayload) as typeof insertPayload)
        .select()
        .single();
      row = retry.data;
      error = retry.error;
    }
  }
  if (isMissingRelation(error)) return { job: inlineJob(args), existed: false };
  // A concurrent request may have inserted the same key first; re-read it.
  if (error) {
    const { data: raced, error: racedError } = await ctx.supabase
      .from("extraction_jobs")
      .select("*")
      .eq("owner_id", ctx.userId)
      .eq("kind", args.kind)
      .eq("idempotency_key", args.idempotencyKey)
      .maybeSingle();
    if (isMissingRelation(racedError)) return { job: inlineJob(args), existed: false };
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
  if (isInlineJobId(jobId)) return;
  const { error } = await ctx.supabase.from("extraction_jobs").update(patch).eq("id", jobId);
  if (isMissingRelation(error)) return;
  if (error) throw new Error(error.message);
}

export async function completeJob(ctx: Ctx, jobId: string, result: unknown): Promise<void> {
  if (isInlineJobId(jobId)) return;
  const patch = {
    status: "completed",
    progress: 100,
    result_json: result as Json,
    finished_at: new Date().toISOString(),
    error: null,
    lease_owner: null,
    lease_expires_at: null,
  };
  let { error } = await ctx.supabase.from("extraction_jobs").update(patch).eq("id", jobId);
  if (error) {
    if (isMissingColumn(error)) {
      const retry = await ctx.supabase
        .from("extraction_jobs")
        .update(stripQueueLeaseColumns(patch))
        .eq("id", jobId);
      error = retry.error;
    }
  }
  if (isMissingRelation(error)) return;
  if (error) throw new Error(error.message);
  try {
    const { emitOperationalMetric } = await import("./observability.server");
    emitOperationalMetric("job.completed", 1, { jobId });
  } catch {
    /* metrics must never break the job path */
  }
}

export async function failJob(ctx: Ctx, jobId: string, message: string): Promise<void> {
  if (isInlineJobId(jobId)) return;
  const patch = {
    status: "failed",
    error: message,
    finished_at: new Date().toISOString(),
    lease_owner: null,
    lease_expires_at: null,
  };
  let { error } = await ctx.supabase.from("extraction_jobs").update(patch).eq("id", jobId);
  if (error) {
    if (isMissingColumn(error)) {
      const retry = await ctx.supabase
        .from("extraction_jobs")
        .update(stripQueueLeaseColumns(patch))
        .eq("id", jobId);
      error = retry.error;
    }
  }
  if (isMissingRelation(error)) return;
  if (error) throw new Error(error.message);
  // Surface job failures to the error sink (structured stderr + optional
  // webhook) so a spike in failed extractions is observable/alertable.
  try {
    const { captureServerError } = await import("./observability.server");
    captureServerError(new Error(message), { kind: "extraction_job_failed", jobId });
  } catch {
    /* observability must never break the job path */
  }
}

export async function requestJobCancellation(ctx: Ctx, jobId: string): Promise<boolean> {
  if (isInlineJobId(jobId)) return true;
  const { data, error } = await ctx.supabase.rpc("request_extraction_job_cancellation", {
    p_job_id: jobId,
  });
  if (error) {
    // Compatibility for databases that have not yet received the queue-lease
    // migration: keep the old direct cancel behavior.
    const { error: fallbackError } = await ctx.supabase
      .from("extraction_jobs")
      .update({
        status: "canceled",
        finished_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .neq("status", "completed");
    if (isMissingRelation(fallbackError)) return true;
    if (fallbackError) throw new Error(fallbackError.message);
    return true;
  }
  return Boolean(data);
}

export async function claimNextQueuedJob(
  supabase: SupabaseClient<Database>,
  workerId: string,
  leaseSeconds = 300,
): Promise<ExtractionJob | null> {
  const { data, error } = await supabase.rpc("claim_next_extraction_job", {
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });
  if (isMissingRelation(error)) return null;
  if (error) throw new Error(error.message);
  return (data as ExtractionJob | null) ?? null;
}

export async function heartbeatJob(
  supabase: SupabaseClient<Database>,
  jobId: string,
  workerId: string,
  leaseSeconds = 300,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("heartbeat_extraction_job", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });
  if (isMissingRelation(error)) return false;
  if (error) throw new Error(error.message);
  return Boolean(data);
}
