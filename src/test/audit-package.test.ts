import { describe, expect, test } from "vitest";
import {
  assertDealRunAuditPackageValid,
  buildDealRunAuditPackage,
  type DealRunAuditPackageInput,
} from "@/lib/customer-audit-package";
import { snapshotRowsFromRun } from "@/lib/deal-audit-package.server";

function seededDealEvidence(
  overrides: Partial<DealRunAuditPackageInput> = {},
): DealRunAuditPackageInput {
  const base: DealRunAuditPackageInput = {
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
  };
  return {
    ...base,
    ...overrides,
    run: { ...base.run, ...overrides.run },
  };
}

describe("deal run audit package", () => {
  test("contains run id, input hash, outputs, memo, decision, and audit events", () => {
    const pkg = buildDealRunAuditPackage(seededDealEvidence());

    expect(pkg.manifest).toMatchObject({
      schema: "agir.deal-run-audit-package.v1",
      project_id: "project-1",
      run_id: "run-1",
      run_number: 2,
      input_fingerprint: "abc123",
      output_fingerprint: "def456",
    });
    expect(pkg.manifest.counts.outputs).toBe(1);
    expect(pkg.manifest.counts.cash_flows).toBe(1);
    expect(pkg.payload.default_accepted_inputs).toHaveLength(1);
    expect(pkg.payload.static_defaults_used).toHaveLength(1);
    expect(pkg.payload.memo?.id).toBe("memo-1");
    expect(pkg.payload.ic_decision?.id).toBe("decision-1");
    expect(pkg.payload.audit_events[0].action).toBe("run_full_underwriting");
    expect(pkg.validation).toMatchObject({
      status: "passed",
      checked_at: "2026-07-03T12:00:00.000Z",
      run_id: "run-1",
      input_fingerprint: "abc123",
      output_fingerprint: "def456",
    });
    expect(pkg.validation.checks.every((check) => check.status === "passed")).toBe(true);
    expect(() => assertDealRunAuditPackageValid(pkg)).not.toThrow();
  });

  test("validation fails for mismatched run ids", () => {
    const pkg = buildDealRunAuditPackage(
      seededDealEvidence({
        outputs: [{ metric_key: "tdc", value_numeric: 250000000, run_id: "run-other" }],
      }),
    );

    expect(pkg.validation.status).toBe("failed");
    expect(pkg.validation.checks).toContainEqual(
      expect.objectContaining({
        name: "financial_outputs_match_manifest_run",
        status: "failed",
        counts: { rows: 1, mismatched: 1 },
      }),
    );
    expect(() => assertDealRunAuditPackageValid(pkg)).toThrow(
      /Audit package validation failed: financial_outputs_match_manifest_run/,
    );
  });

  test("validation fails for empty required outputs on a completed run", () => {
    const pkg = buildDealRunAuditPackage(
      seededDealEvidence({
        outputs: [],
        cashFlows: [],
      }),
    );

    expect(pkg.validation.status).toBe("failed");
    expect(pkg.validation.checks).toContainEqual(
      expect.objectContaining({
        name: "completed_run_required_outputs_present",
        status: "failed",
        counts: { outputs: 0, cash_flows: 0, missing_required_arrays: 2 },
      }),
    );
    expect(() => assertDealRunAuditPackageValid(pkg)).toThrow(
      /Completed run is missing required output or cash-flow rows/,
    );
  });

  test("historical run evidence prefers immutable input snapshot over current input tables", () => {
    const currentEditedInputs = [{ scope: "scalar", key: "loan_amount", value_numeric: 999 }];
    const snapshotInputs = snapshotRowsFromRun({
      input_snapshot: {
        loanAmount: 100,
        interestRatePct: 6,
        amortYears: 30,
        exitCapRatePct: 5,
        budget: { land: 10, hard: 20 },
        revenueProgram: [
          {
            unitType: "Residential",
            unitCount: 10,
            rent: 2000,
            rentBasis: "per_unit",
            occupancyPct: 95,
          },
        ],
      },
      accepted_defaults_used: [{ key: "selling_costs_pct" }],
    });
    const packageInputs = snapshotInputs.length ? snapshotInputs : currentEditedInputs;

    expect(packageInputs).not.toBe(currentEditedInputs);
    expect(packageInputs).toContainEqual(
      expect.objectContaining({
        key: "loan_amount",
        value_numeric: 100,
        source: "underwriting_runs.input_snapshot",
      }),
    );
    expect(packageInputs).not.toContainEqual(expect.objectContaining({ value_numeric: 999 }));
  });
});
