#!/usr/bin/env node

export async function handleLocalJob(job) {
  const payload = job?.result_json && typeof job.result_json === "object" ? job.result_json : {};
  if (payload.local_result && typeof payload.local_result === "object") {
    return {
      status: payload.local_result.status === "failed" ? "failed" : "completed",
      result: payload.local_result,
      error: payload.local_result.error ?? null,
      message: payload.local_result.message ?? "Handled by local extraction worker.",
    };
  }
  return {
    status: "failed",
    error: "No local_result payload was provided for local worker execution.",
    message:
      "Set EXTRACTION_WORKER_HANDLER_URL for HTTP execution or enqueue jobs with result_json.local_result for local execution.",
  };
}
