import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";

const { Client } = pg;

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const once = args.has("--once") || dryRun;
const databaseUrl =
  process.env.WORKER_DATABASE_URL ??
  process.env.SUPABASE_SERVICE_DATABASE_URL ??
  process.env.DATABASE_URL;
const handlerUrl = process.env.EXTRACTION_WORKER_HANDLER_URL;
const handlerMode = process.env.EXTRACTION_WORKER_HANDLER_MODE ?? (handlerUrl ? "http" : "local");
const workerToken = process.env.EXTRACTION_WORKER_TOKEN;
const pollMs = Number(process.env.EXTRACTION_WORKER_POLL_MS ?? 5000);
const workerId =
  process.env.EXTRACTION_WORKER_ID ??
  `worker-${Math.random().toString(16).slice(2)}-${Date.now().toString(36)}`;
const leaseSeconds = Number(process.env.EXTRACTION_WORKER_LEASE_SECONDS ?? 300);

if (!databaseUrl && !dryRun) {
  throw new Error("Set WORKER_DATABASE_URL, SUPABASE_SERVICE_DATABASE_URL, or DATABASE_URL.");
}

async function withClient(fn) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function claimQueuedJob(client) {
  const result = await client.query("select * from public.claim_next_extraction_job($1, $2)", [
    workerId,
    leaseSeconds,
  ]);
  return result.rows[0] ?? null;
}

async function heartbeatJob(client, job) {
  await client.query("select public.heartbeat_extraction_job($1, $2, $3)", [
    job.id,
    workerId,
    leaseSeconds,
  ]);
}

async function shouldCancel(client, job) {
  const result = await client.query(
    "select cancellation_requested from public.extraction_jobs where id = $1",
    [job.id],
  );
  return Boolean(result.rows[0]?.cancellation_requested);
}

async function finishJob(client, job, payload) {
  const result = await client.query(
    `
      UPDATE public.extraction_jobs
      SET status = $2,
          progress = CASE WHEN $2 = 'completed' THEN 100 ELSE progress END,
          result_json = $3,
          error = $4,
          finished_at = now(),
          message = $5
      WHERE id = $1 AND status = 'running' AND lease_owner = $6
    `,
    [
      job.id,
      payload.status,
      payload.result ?? null,
      payload.error ?? null,
      payload.message ?? null,
      workerId,
    ],
  );
  if (result.rowCount !== 1)
    throw new Error(`Lost lease for job ${job.id}; refusing to overwrite it.`);
}

async function handleJob(job) {
  if (handlerMode === "local") {
    const { handleLocalJob } = await import("./extraction-worker-local-handler.mjs");
    return handleLocalJob(job);
  }
  if (!handlerUrl) {
    return {
      status: "failed",
      error: "EXTRACTION_WORKER_HANDLER_URL is not configured.",
      message: "Worker claimed job but no handler is configured.",
    };
  }
  if (!workerToken) {
    return {
      status: "failed",
      error: "EXTRACTION_WORKER_TOKEN is not configured.",
      message: "Worker refused to call the protected extraction handler.",
    };
  }
  const response = await fetch(handlerUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-worker-token": workerToken },
    body: JSON.stringify({ job }),
  });
  if (!response.ok) {
    return {
      status: "failed",
      error: `Handler returned HTTP ${response.status}`,
      message: "External extraction handler failed.",
    };
  }
  const result = await response.json();
  return {
    status: result.status === "completed" ? "completed" : "failed",
    result,
    error: result.error ?? null,
    message: result.message ?? "Handled by extraction worker.",
  };
}

async function tick() {
  return withClient(async (client) => {
    const job = await claimQueuedJob(client);
    if (!job) {
      console.log("[extraction-worker] no queued jobs");
      return false;
    }
    console.log(`[extraction-worker] claimed ${job.id} (${job.kind})`);
    await heartbeatJob(client, job);
    if (await shouldCancel(client, job)) {
      await finishJob(client, job, {
        status: "canceled",
        error: null,
        message: "Job canceled before handler execution.",
      });
      console.log(`[extraction-worker] ${job.id} -> canceled`);
      return true;
    }
    // Keep the lease alive while bounded OCR/AV/AI work runs. An abandoned
    // worker stops heartbeating and is safely recovered by the claim RPC.
    const heartbeat = setInterval(
      () => {
        void heartbeatJob(client, job).catch((error) =>
          console.error(`[extraction-worker] heartbeat failed for ${job.id}: ${error.message}`),
        );
      },
      Math.max(10_000, Math.floor((leaseSeconds * 1000) / 3)),
    );
    let result;
    try {
      result = await handleJob(job);
    } finally {
      clearInterval(heartbeat);
    }
    if (await shouldCancel(client, job)) {
      await finishJob(client, job, {
        status: "canceled",
        error: null,
        message: "Job canceled during handler execution.",
      });
      console.log(`[extraction-worker] ${job.id} -> canceled`);
      return true;
    }
    await finishJob(client, job, result);
    console.log(`[extraction-worker] ${job.id} -> ${result.status}`);
    return true;
  });
}

if (dryRun) {
  console.log("[extraction-worker] dry run: SQL worker contract loaded.");
  console.log("[extraction-worker] queue contract: claim_next_extraction_job + heartbeat.");
  console.log("[extraction-worker] handler modes: local or http.");
  console.log(
    "[extraction-worker] set WORKER_DATABASE_URL and optionally EXTRACTION_WORKER_HANDLER_URL.",
  );
  process.exit(0);
}

do {
  await tick();
  if (!once) await sleep(pollMs);
} while (!once);
