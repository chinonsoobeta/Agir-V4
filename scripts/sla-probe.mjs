// Lightweight SLA / uptime probe. Hits the app's public /api/health endpoint,
// records status + latency to a rolling JSONL evidence log, and computes
// availability + p50/p95 latency over the retained window against an SLO.
//
//   PROBE_TARGET=https://app.example.com npm run sla:probe
//
// This produces the evidence FORMAT and a code seam for synthetic monitoring;
// a true uptime SLA still requires an external monitor running this on a
// schedule from outside the deployment (see docs/compliance/enabler-status.md).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const target = (process.env.PROBE_TARGET ?? "http://localhost:8081").replace(/\/$/, "");
const sloMs = Number(process.env.SLA_LATENCY_SLO_MS ?? 1000);
const sloAvailability = Number(process.env.SLA_AVAILABILITY_TARGET ?? 0.999);
const retain = Number(process.env.SLA_RETAIN_SAMPLES ?? 1000);

const dir = resolve(process.cwd(), "docs/ops/sla");
const logPath = resolve(dir, "uptime-samples.jsonl");

async function probe() {
  const url = `${target}/api/health`;
  const t0 = Date.now();
  let up = false;
  let httpStatus = 0;
  let detail = null;
  try {
    const res = await fetch(url, { headers: { "cache-control": "no-store" } });
    httpStatus = res.status;
    const body = await res.json().catch(() => ({}));
    up = res.status === 200 && body?.status === "ok";
    detail = body?.status ?? null;
  } catch (e) {
    detail = e?.message ?? String(e);
  }
  return {
    ts: new Date().toISOString(),
    target: url,
    up,
    httpStatus,
    latencyMs: Date.now() - t0,
    detail,
  };
}

async function loadSamples() {
  try {
    const text = await readFile(logPath, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  await mkdir(dir, { recursive: true });
  const sample = await probe();

  const prior = await loadSamples();
  const samples = [...prior, sample].slice(-retain);
  await writeFile(logPath, samples.map((s) => JSON.stringify(s)).join("\n") + "\n");

  const upCount = samples.filter((s) => s.up).length;
  const availability = samples.length ? upCount / samples.length : 0;
  const latencies = samples
    .filter((s) => s.up)
    .map((s) => s.latencyMs)
    .sort((a, b) => a - b);
  const summary = {
    generatedAt: new Date().toISOString(),
    target,
    window: samples.length,
    availability: Math.round(availability * 100000) / 100000,
    availabilityTarget: sloAvailability,
    meetsAvailability: availability >= sloAvailability,
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
    latencySloMs: sloMs,
    latest: sample,
  };
  await writeFile(resolve(dir, "sla-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

  console.log(
    `[sla-probe] ${sample.up ? "UP" : "DOWN"} ${sample.latencyMs}ms | ` +
      `availability ${(availability * 100).toFixed(3)}% over ${samples.length} | p95 ${summary.latencyP95}ms`,
  );
  // Non-zero exit if THIS probe failed, so a scheduler can alert immediately.
  if (!sample.up) process.exitCode = 1;
}

main();
