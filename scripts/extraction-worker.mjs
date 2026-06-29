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
const pollMs = Number(process.env.EXTRACTION_WORKER_POLL_MS ?? 5000);

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
  const result = await client.query(`
    UPDATE public.extraction_jobs
    SET status = 'running', started_at = now(), message = 'Claimed by extraction worker'
    WHERE id = (
      SELECT id
      FROM public.extraction_jobs
      WHERE status = 'queued'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *
  `);
  return result.rows[0] ?? null;
}

async function finishJob(client, job, payload) {
  await client.query(
    `
      UPDATE public.extraction_jobs
      SET status = $2,
          progress = CASE WHEN $2 = 'completed' THEN 100 ELSE progress END,
          result_json = $3,
          error = $4,
          finished_at = now(),
          message = $5
      WHERE id = $1
    `,
    [
      job.id,
      payload.status,
      payload.result ?? null,
      payload.error ?? null,
      payload.message ?? null,
    ],
  );
}

async function handleJob(job) {
  if (!handlerUrl) {
    return {
      status: "failed",
      error: "EXTRACTION_WORKER_HANDLER_URL is not configured.",
      message: "Worker claimed job but no handler is configured.",
    };
  }
  const response = await fetch(handlerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
    const result = await handleJob(job);
    await finishJob(client, job, result);
    console.log(`[extraction-worker] ${job.id} -> ${result.status}`);
    return true;
  });
}

if (dryRun) {
  console.log("[extraction-worker] dry run: SQL worker contract loaded.");
  console.log(
    "[extraction-worker] set WORKER_DATABASE_URL and EXTRACTION_WORKER_HANDLER_URL to execute.",
  );
  process.exit(0);
}

do {
  await tick();
  if (!once) await sleep(pollMs);
} while (!once);
