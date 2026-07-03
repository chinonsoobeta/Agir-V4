import { describe, expect, test } from "vitest";
import {
  summarizeOperationalJobs,
  summarizeOperationalWindows,
  type OperationalJobRow,
} from "@/lib/operational-quality";

const now = new Date("2026-07-02T12:00:00.000Z");
const isoAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();

describe("operational quality summaries", () => {
  test("summarizes duration percentiles, stuck jobs, terminal rates, and reasons", () => {
    const rows: OperationalJobRow[] = [
      {
        id: "fast",
        status: "completed",
        created_at: isoAgo(1),
        started_at: isoAgo(1),
        finished_at: new Date(Date.parse(isoAgo(1)) + 1_000).toISOString(),
      },
      {
        id: "slow",
        status: "completed",
        created_at: isoAgo(2),
        started_at: isoAgo(2),
        finished_at: new Date(Date.parse(isoAgo(2)) + 90_000).toISOString(),
      },
      {
        id: "failed",
        status: "failed",
        created_at: isoAgo(3),
        error: "OCR timeout while parsing scanned appraisal",
      },
      {
        id: "stuck",
        status: "running",
        created_at: isoAgo(4),
        heartbeat_at: isoAgo(1),
        lease_expires_at: isoAgo(0.5),
      },
    ];

    const summary = summarizeOperationalJobs(rows, now);
    expect(summary.total).toBe(4);
    expect(summary.successRate).toBeCloseTo(2 / 3);
    expect(summary.averageDurationMs).toBe(45_500);
    expect(summary.p95DurationMs).toBe(90_000);
    expect(summary.stuck).toBe(1);
    expect(summary.failuresByReason["OCR timeout while parsing scanned appraisal"]).toBe(1);
  });

  test("builds 24h, 7d, and 30d windows from one bounded row set", () => {
    const rows: OperationalJobRow[] = [
      { id: "today", status: "completed", created_at: isoAgo(2) },
      { id: "week", status: "failed", created_at: isoAgo(48), error: "worker crashed" },
      { id: "month", status: "completed", created_at: isoAgo(24 * 14) },
    ];

    const windows = summarizeOperationalWindows(rows, now);
    expect(windows["24h"].total).toBe(1);
    expect(windows["7d"].total).toBe(2);
    expect(windows["30d"].total).toBe(3);
    expect(windows["7d"].failuresByReason["worker crashed"]).toBe(1);
  });
});
