import { describe, expect, test } from "vitest";
import { effectiveAssumptions, isEffectiveAssumption } from "@/lib/assumption-authority";
import { deriveCore, reportAllowedValues } from "@/lib/reports/report-common";
import type { ReportData } from "@/lib/reports/report-data.server";
import { buildDeterministicMemo } from "@/lib/memo-template";

function reportData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    project: null,
    documents: [],
    assumptions: [],
    assumptionVersions: [],
    engineInputs: [],
    budget: [],
    revenue: [],
    outputs: [],
    cashFlows: [],
    flags: [],
    risks: [],
    memos: [],
    decisions: [],
    auditLogs: [],
    scenarios: [],
    unitContractIssues: [],
    ...overrides,
  };
}

describe("assumption authority boundary", () => {
  test("excludes review rows and material overrides awaiting second approval", () => {
    const rows = [
      { id: "approved", status: "approved", dual_control_pending: false },
      { id: "modified", status: "modified", dual_control_pending: null },
      { id: "pending", status: "modified", dual_control_pending: true },
      { id: "extracted", status: "extracted", dual_control_pending: false },
      { id: "rejected", status: "rejected", dual_control_pending: false },
    ];

    expect(rows.map((row) => isEffectiveAssumption(row))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(effectiveAssumptions(rows).map((row) => row.id)).toEqual(["approved", "modified"]);
  });

  test("governed report derivations prefer engine inputs and ignore pending overrides", () => {
    const data = reportData({
      assumptions: [
        {
          field_key: "debt_amount",
          value_numeric: 999_000_000,
          unit: "$",
          status: "modified",
          dual_control_pending: true,
        },
      ] as ReportData["assumptions"],
      engineInputs: [
        { key: "loan_amount", value_numeric: 125_000_000, status: "approved" },
      ] as ReportData["engineInputs"],
    });

    const core = deriveCore(data);
    expect(core.loan).toBe(125_000_000);

    const allowed = reportAllowedValues(data, core);
    const values = allowed.map((entry) => (typeof entry === "number" ? entry : entry.value));
    expect(values).toContain(125_000_000);
    expect(values).not.toContain(999_000_000);
  });

  test("the deterministic memo does not render a pending override as approved", () => {
    const memo = buildDeterministicMemo({
      project: { name: "Authority Test", type: "development", status: "underwriting" },
      assumptions: [
        {
          field_key: "land_cost",
          field_label: "Land Cost",
          value_numeric: 999_000_000,
          unit: "$",
          status: "modified",
          dual_control_pending: true,
        },
        {
          field_key: "hard_costs",
          field_label: "Hard Costs",
          value_numeric: 125_000_000,
          unit: "$",
          status: "approved",
          dual_control_pending: false,
        },
      ],
      engineInputs: [],
      outputs: [],
      cashFlows: [],
      flags: [],
      risks: [],
      errorFlags: [],
      verdict: { code: "RETURN_TO_UNDERWRITING", gates: [] },
    } as unknown as Parameters<typeof buildDeterministicMemo>[0]);

    expect(memo.approved_assumptions).toContain("125,000,000");
    expect(JSON.stringify(memo)).not.toContain("999,000,000");
  });
});
