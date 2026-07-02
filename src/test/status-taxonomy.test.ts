import { describe, expect, test } from "vitest";
import {
  assumptionApprovedForUnderwriting,
  assumptionProvenance,
  confidenceLabel,
  statusClassName,
  statusConfig,
} from "@/lib/status-taxonomy";
import { aiClassificationReasoning } from "@/lib/ai-authority";
import { summarizeOperationalJobs } from "@/lib/operational-quality";

describe("status taxonomy", () => {
  test("returns canonical labels and severity classes", () => {
    const blocked = statusConfig("underwriting", "blocked");
    expect(blocked.label).toBe("Blocked");
    expect(blocked.severity).toBe("danger");
    expect(statusClassName(blocked.severity)).toContain("destructive");
  });

  test("formats confidence and assumption provenance", () => {
    expect(confidenceLabel(87.4, "high")).toBe("87% · High");
    const ai = assumptionProvenance({
      status: "extracted",
      ai_reasoning: aiClassificationReasoning({ candidateLabel: "Term Sheet.pdf" }),
      source_text: "Loan amount $120,000,000",
    });
    expect(ai.sourceType).toBe("ai_assisted");
    expect(ai.approvalLabel).toBe("Review only");
  });

  test("dual-control pending rows are not approved for underwriting", () => {
    expect(
      assumptionApprovedForUnderwriting({ status: "approved", dual_control_pending: true }),
    ).toBe(false);
    expect(assumptionApprovedForUnderwriting({ status: "approved" })).toBe(true);
  });
});

describe("operational quality summary", () => {
  test("summarizes success rate, failures, duration, and stuck jobs", () => {
    const now = new Date("2026-07-02T12:00:00Z");
    const summary = summarizeOperationalJobs(
      [
        {
          id: "1",
          status: "completed",
          started_at: "2026-07-02T11:00:00Z",
          finished_at: "2026-07-02T11:01:00Z",
        },
        { id: "2", status: "failed", error: "OCR timeout" },
        {
          id: "3",
          status: "running",
          heartbeat_at: "2026-07-02T11:40:00Z",
        },
      ],
      now,
    );
    expect(summary.successRate).toBe(0.5);
    expect(summary.averageDurationMs).toBe(60_000);
    expect(summary.failuresByReason["OCR timeout"]).toBe(1);
    expect(summary.stuck).toBe(1);
  });
});
