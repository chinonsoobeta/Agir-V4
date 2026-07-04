import { describe, expect, test } from "vitest";
import { buildDealRunAuditPackage } from "@/lib/customer-audit-package";

describe("deal run audit package", () => {
  test("contains run id, input hash, outputs, memo, decision, and audit events", () => {
    const pkg = buildDealRunAuditPackage({
      generatedAt: "2026-07-03T12:00:00.000Z",
      project: { id: "project-1", name: "Harbour Centre" },
      run: {
        id: "run-1",
        run_number: 2,
        run_mode: "deterministic",
        status: "completed",
        input_fingerprint: "abc123",
        output_fingerprint: "def456",
        accepted_defaults_used: [{ key: "selling_costs_pct" }],
        conflict_resolutions_used: [{ key: "exit_cap_rate_pct" }],
      },
      approvedInputs: [{ key: "loan_amount", value_numeric: 100 }],
      defaultAcceptedInputs: [{ key: "selling_costs_pct", status: "default_accepted" }],
      acceptedDefaults: [{ key: "selling_costs_pct" }],
      staticDefaultsUsed: [{ key: "selling_costs_pct" }],
      conflictResolutions: [{ key: "exit_cap_rate_pct" }],
      outputs: [{ metric_key: "tdc", value_numeric: 250000000, run_id: "run-1" }],
      cashFlows: [{ line_key: "noi", amount: 1000, run_id: "run-1" }],
      reconciliationFlags: [{ check_key: "sources_uses", run_id: "run-1" }],
      risks: [{ title: "DSCR below covenant", run_id: "run-1" }],
      memo: { id: "memo-1", status: "generated", run_id: "run-1" },
      decision: { id: "decision-1", decision: "reject", run_id: "run-1" },
      auditEvents: [{ id: "audit-1", action: "run_full_underwriting" }],
    });

    expect(pkg.manifest).toMatchObject({
      schema: "agir.deal-run-audit-package.v1",
      project_id: "project-1",
      run_id: "run-1",
      run_number: 2,
      input_fingerprint: "abc123",
    });
    expect(pkg.manifest.counts.outputs).toBe(1);
    expect(pkg.manifest.counts.cash_flows).toBe(1);
    expect(pkg.payload.default_accepted_inputs).toHaveLength(1);
    expect(pkg.payload.static_defaults_used).toHaveLength(1);
    expect(pkg.payload.memo?.id).toBe("memo-1");
    expect(pkg.payload.ic_decision?.id).toBe("decision-1");
    expect(pkg.payload.audit_events[0].action).toBe("run_full_underwriting");
  });
});
