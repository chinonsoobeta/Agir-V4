export type OperationalWindow = "24h" | "7d" | "30d";

export type OperationalJobRow = {
  id: string;
  status: string | null;
  kind?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
  heartbeat_at?: string | null;
  lease_expires_at?: string | null;
  cancellation_requested?: boolean | null;
  dead_lettered_at?: string | null;
};

export type OperationalJobSummary = ReturnType<typeof summarizeOperationalJobs>;

export function windowToSince(window: OperationalWindow, now = new Date()) {
  const ms =
    window === "24h"
      ? 24 * 60 * 60 * 1000
      : window === "7d"
        ? 7 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() - ms).toISOString();
}

export function summarizeOperationalJobs(rows: OperationalJobRow[], now = new Date()) {
  const byStatus: Record<string, number> = {};
  const failuresByReason: Record<string, number> = {};
  const durations: number[] = [];
  let completed = 0;
  let failed = 0;
  let canceled = 0;
  let deadLettered = 0;
  let running = 0;
  let stuck = 0;

  for (const row of rows) {
    const status = row.status ?? "unknown";
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (status === "completed") completed += 1;
    if (status === "failed") failed += 1;
    if (status === "canceled" || row.cancellation_requested) canceled += 1;
    if (status === "dead_lettered" || row.dead_lettered_at) deadLettered += 1;
    if (status === "running" || status === "queued") running += 1;

    if (status === "failed" || status === "dead_lettered") {
      const reason = normalizeReason(row.error);
      failuresByReason[reason] = (failuresByReason[reason] ?? 0) + 1;
    }

    const start = row.started_at ? Date.parse(row.started_at) : NaN;
    const finish = row.finished_at ? Date.parse(row.finished_at) : NaN;
    if (Number.isFinite(start) && Number.isFinite(finish) && finish >= start) {
      durations.push(finish - start);
    }

    const heartbeat = row.heartbeat_at ?? row.started_at ?? row.created_at;
    const ageMs = heartbeat ? now.getTime() - Date.parse(heartbeat) : 0;
    const leaseExpired = row.lease_expires_at
      ? Date.parse(row.lease_expires_at) < now.getTime()
      : false;
    if ((status === "running" || status === "queued") && (leaseExpired || ageMs > 15 * 60 * 1000)) {
      stuck += 1;
    }
  }

  const terminal = completed + failed + canceled + deadLettered;
  return {
    total: rows.length,
    byStatus,
    successRate: terminal ? completed / terminal : null,
    averageDurationMs: durations.length
      ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
      : null,
    p95DurationMs: percentile(durations, 0.95),
    failuresByReason,
    running,
    stuck,
    canceled,
    deadLettered,
  };
}

export function summarizeOperationalWindows(rows: OperationalJobRow[], now = new Date()) {
  const windows: OperationalWindow[] = ["24h", "7d", "30d"];
  return Object.fromEntries(
    windows.map((window) => {
      const since = Date.parse(windowToSince(window, now));
      const scoped = rows.filter((row) => {
        const created = row.created_at ? Date.parse(row.created_at) : NaN;
        return Number.isFinite(created) && created >= since;
      });
      return [window, summarizeOperationalJobs(scoped, now)];
    }),
  ) as Record<OperationalWindow, OperationalJobSummary>;
}

export function normalizeReason(reason?: string | null) {
  const trimmed = (reason ?? "").trim();
  if (!trimmed) return "Unspecified";
  return trimmed.replace(/\s+/g, " ").slice(0, 120);
}

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return Math.round(sorted[idx]);
}
