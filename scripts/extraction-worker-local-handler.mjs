#!/usr/bin/env node

// Default "local" handler for scripts/extraction-worker.mjs: forwards the
// claimed job to the app's token-guarded execution endpoint. This keeps every
// execution path (dev laptop, sidecar container, VM) going through the same
// pipeline code in src/lib/extraction-executor.server.ts - the worker process
// itself never needs to import the TypeScript app.
//
// Env:
//   EXTRACTION_WORKER_APP_ORIGIN  app origin (default http://127.0.0.1:8081)
//   EXTRACTION_WORKER_TOKEN       must match the app's EXTRACTION_WORKER_TOKEN

export async function handleLocalJob(job) {
  const origin = process.env.EXTRACTION_WORKER_APP_ORIGIN ?? "http://127.0.0.1:8081";
  const token = process.env.EXTRACTION_WORKER_TOKEN;
  if (!token) {
    return {
      status: "failed",
      error: "EXTRACTION_WORKER_TOKEN is not set for the local handler.",
      message: "Configure the shared worker token before running jobs.",
    };
  }
  let response;
  try {
    response = await fetch(`${origin}/api/extraction/worker`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-token": token },
      body: JSON.stringify({ job_id: job.id, worker_id: job.lease_owner }),
    });
  } catch (cause) {
    return {
      status: "failed",
      error: cause instanceof Error ? cause.message : String(cause),
      message: `POST ${origin}/api/extraction/worker was unavailable.`,
    };
  }
  if (!response.ok) {
    return {
      status: "failed",
      error: `App execution endpoint returned HTTP ${response.status}`,
      message: `POST ${origin}/api/extraction/worker failed.`,
    };
  }
  const result = await response.json();
  return {
    status: result.status === "completed" ? "completed" : "failed",
    result,
    error: result.error ?? null,
    message: result.message ?? "Handled via app execution endpoint.",
  };
}
