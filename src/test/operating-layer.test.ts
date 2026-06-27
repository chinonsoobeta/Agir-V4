// Workstream 3 pure-logic suite: execution critical path (3A), IC vote tallying
// + condition state transitions (3B), and a two-tenant simulation of the
// owner + workspace-member RLS predicate every new table uses.

import { describe, expect, test } from "vitest";
import { computeCriticalPath, type ExecMilestone } from "@/lib/execution/critical-path";
import {
  tallyVotes,
  transitionCondition,
  canTransitionCondition,
  conditionsCleared,
  openConditionCount,
  DEFAULT_TALLY_POLICY,
  type IcVote,
} from "@/lib/committee/voting";
import { canAccessRow, canWriteRow } from "@/lib/workspace-access";
import { csvConnector, parseCsv, CONNECTOR_REGISTRY, type DealRecord, type FieldMapping } from "@/lib/integrations/connector";

const M = (id: string, dueDate: string | null, status: ExecMilestone["status"], dependsOn: string[] = []): ExecMilestone => ({
  id, title: id, dueDate, status, dependsOn,
});

describe("3A execution critical path", () => {
  // A realistic close sequence: term sheet -> appraisal + environmental ->
  // loan commitment -> closing. Environmental is the later of the two parallel
  // diligence tracks, so it is on the critical path; appraisal is not.
  const milestones = [
    M("term_sheet", "2026-07-01", "complete"),
    M("appraisal", "2026-07-15", "in_progress", ["term_sheet"]),
    M("environmental", "2026-08-01", "not_started", ["term_sheet"]),
    M("loan_commitment", "2026-08-20", "not_started", ["appraisal", "environmental"]),
    M("closing", "2026-09-01", "not_started", ["loan_commitment"]),
  ];

  test("computes the longest-by-date dependency chain and the projected close", () => {
    const r = computeCriticalPath(milestones, "2026-09-01", "2026-07-10");
    expect(r.hasCycle).toBe(false);
    expect(r.projectedCloseDate).toBe("2026-09-01");
    // Environmental (Aug 1) beats appraisal (Jul 15), so it is on the path.
    expect(r.criticalPath).toEqual(["term_sheet", "environmental", "loan_commitment", "closing"]);
    // Topological order places predecessors before dependents.
    expect(r.order.indexOf("term_sheet")).toBeLessThan(r.order.indexOf("loan_commitment"));
    expect(r.order.indexOf("loan_commitment")).toBeLessThan(r.order.indexOf("closing"));
  });

  test("surfaces the open items that threaten the close, worst-first by slack", () => {
    const r = computeCriticalPath(milestones, "2026-09-01", "2026-07-10");
    // Closing (0 slack) before loan commitment (12) before environmental (31).
    expect(r.blocking.map((b) => b.id)).toEqual(["closing", "loan_commitment", "environmental"]);
    const closing = r.blocking.find((b) => b.id === "closing")!;
    expect(closing.slackDays).toBe(0);
    expect(closing.reasons).toContain("on_critical_path");
    expect(closing.reasons).toContain("blocked_by_incomplete");
    // Appraisal is not overdue, not on the path, and its only predecessor is
    // complete, so it does not threaten the close.
    expect(r.blocking.some((b) => b.id === "appraisal")).toBe(false);
  });

  test("flags overdue items and negative slack when the chain runs past close", () => {
    // Today is past two due dates; target close is BEFORE the projected close.
    const r = computeCriticalPath(milestones, "2026-08-25", "2026-08-10");
    const env = r.blocking.find((b) => b.id === "environmental")!;
    expect(env.reasons).toContain("overdue"); // due Aug 1 < today Aug 10
    const closing = r.blocking.find((b) => b.id === "closing")!;
    // Projected close Sep 1 is 7 days past the Aug 25 target -> negative slack.
    expect(closing.slackDays).toBe(-7);
  });

  test("detects dependency cycles without infinite recursion", () => {
    const cyclic = [M("a", "2026-07-01", "not_started", ["b"]), M("b", "2026-07-02", "not_started", ["a"])];
    const r = computeCriticalPath(cyclic, null, "2026-07-01");
    expect(r.hasCycle).toBe(true);
    expect(r.cycles.length).toBeGreaterThan(0);
  });
});

describe("3B IC vote tallying", () => {
  const vote = (memberId: string, v: IcVote["vote"]): IcVote => ({ memberId, vote: v });

  test("a clear majority approves", () => {
    const t = tallyVotes([vote("a", "approve"), vote("b", "approve"), vote("c", "approve"), vote("d", "reject")]);
    expect(t.quorumMet).toBe(true);
    expect(t.approvalPct).toBe(75);
    expect(t.outcome).toBe("approved");
  });

  test("conditional approvals dominate -> approved_with_conditions", () => {
    const t = tallyVotes([vote("a", "approve_with_conditions"), vote("b", "approve_with_conditions"), vote("c", "approve")]);
    expect(t.outcome).toBe("approved_with_conditions");
  });

  test("below quorum -> no_quorum (abstentions are not decisive)", () => {
    const t = tallyVotes([vote("a", "approve"), vote("b", "abstain"), vote("c", "abstain")]);
    expect(t.decisiveVotes).toBe(1);
    expect(t.outcome).toBe("no_quorum");
  });

  test("an even split is a tie, not an approval", () => {
    const t = tallyVotes([vote("a", "approve"), vote("b", "reject")]);
    expect(t.approvalPct).toBe(50);
    expect(t.outcome).toBe("tie");
  });

  test("reject-blocks policy lets a single reject veto an approval", () => {
    const t = tallyVotes(
      [vote("a", "approve"), vote("b", "approve"), vote("c", "approve"), vote("d", "reject")],
      { ...DEFAULT_TALLY_POLICY, rejectBlocks: true },
    );
    expect(t.outcome).toBe("rejected");
  });

  test("a member's latest vote replaces an earlier one", () => {
    const t = tallyVotes([vote("a", "reject"), vote("a", "approve"), vote("b", "approve")]);
    expect(t.counts.approve).toBe(2);
    expect(t.counts.reject).toBe(0);
    expect(t.outcome).toBe("approved");
  });

  test("a supermajority threshold blocks a simple majority (regression)", () => {
    const policy = { ...DEFAULT_TALLY_POLICY, approveThresholdPct: 67 };
    const approve = (n: number) => Array.from({ length: n }, (_, i) => vote(`a${i}`, "approve"));
    const reject = (n: number) => Array.from({ length: n }, (_, i) => vote(`r${i}`, "reject"));
    // 6 approve / 4 reject = 60% decisive approval: short of the 67% bar, so it
    // must NOT pass (previously a >50% short-circuit approved it anyway).
    const short = tallyVotes([...approve(6), ...reject(4)], policy);
    expect(short.approvalPct).toBeCloseTo(60);
    expect(short.outcome).not.toBe("approved");
    // 7 approve / 3 reject = 70%: clears the supermajority and approves.
    const clears = tallyVotes([...approve(7), ...reject(3)], policy);
    expect(clears.approvalPct).toBeCloseTo(70);
    expect(clears.outcome).toBe("approved");
  });
});

describe("3B approval conditions tracked to close", () => {
  test("legal transitions move open -> satisfied / waived and back", () => {
    expect(transitionCondition("open", "satisfy")).toBe("satisfied");
    expect(transitionCondition("open", "waive")).toBe("waived");
    expect(transitionCondition("satisfied", "reopen")).toBe("open");
    expect(canTransitionCondition("satisfied", "satisfy")).toBe(false);
  });

  test("illegal transitions throw rather than silently corrupting state", () => {
    expect(() => transitionCondition("open", "reopen")).toThrow();
    expect(() => transitionCondition("waived", "satisfy")).toThrow();
  });

  test("a conditional approval clears for close only when no condition is open", () => {
    expect(conditionsCleared([{ status: "open" }, { status: "satisfied" }])).toBe(false);
    expect(conditionsCleared([{ status: "satisfied" }, { status: "waived" }])).toBe(true);
    expect(openConditionCount([{ status: "open" }, { status: "open" }, { status: "satisfied" }])).toBe(2);
  });
});

describe("RLS: owner + workspace-member predicate is two-tenant isolated", () => {
  const tenantA = { userId: "user-A", workspaceIds: ["ws-A"] };
  const tenantB = { userId: "user-B", workspaceIds: ["ws-B"] };
  const colleagueA = { userId: "user-A2", workspaceIds: ["ws-A"] };

  test("an owner-only row is visible to its owner and no one else", () => {
    const row = { owner_id: "user-A", workspace_id: null };
    expect(canAccessRow(row, tenantA)).toBe(true);
    expect(canAccessRow(row, tenantB)).toBe(false);
    expect(canAccessRow(row, colleagueA)).toBe(false); // not shared to the workspace
  });

  test("a workspace-shared row is visible to members, never to another tenant", () => {
    const row = { owner_id: "user-A", workspace_id: "ws-A" };
    expect(canAccessRow(row, tenantA)).toBe(true);
    expect(canAccessRow(row, colleagueA)).toBe(true);
    expect(canAccessRow(row, tenantB)).toBe(false);
  });

  test("a row cannot be written into a workspace the author does not belong to", () => {
    // Owner stamping their row with another tenant's workspace fails WITH CHECK.
    expect(canWriteRow({ owner_id: "user-A", workspace_id: "ws-B" }, tenantA)).toBe(false);
    expect(canWriteRow({ owner_id: "user-A", workspace_id: "ws-A" }, tenantA)).toBe(true);
    expect(canWriteRow({ owner_id: "user-A", workspace_id: null }, tenantA)).toBe(true);
    // A non-owner cannot write the row as someone else.
    expect(canWriteRow({ owner_id: "user-A", workspace_id: "ws-A" }, tenantB)).toBe(false);
  });
});

describe("3C integrations: CSV reference connector round-trip", () => {
  const mapping: FieldMapping = {
    "Deal ID": "external_id",
    "Opportunity Name": "name",
    "Market": "location",
    "Product": "type",
    "Lead Source": "source",
    "Win %": "probability",
    "Target Close": "target_close_date",
  };
  const records: DealRecord[] = [
    { external_id: "CRM-1", name: "Harbour Centre, Phase II", location: "Vancouver, BC", type: "mixed_use", source: "broker", probability: 60, target_close_date: "2026-09-01" },
    { external_id: "CRM-2", name: "Rivergate", location: "Austin, TX", type: "multifamily", source: "direct", probability: 35, target_close_date: null },
  ];

  test("export then import is a faithful round-trip through the field mapping", () => {
    const csv = csvConnector.formatOutbound(records, mapping);
    const { records: back, errors } = csvConnector.parseInbound(csv, mapping);
    expect(errors).toEqual([]);
    expect(back).toEqual(records);
  });

  test("a name containing a comma survives CSV quoting", () => {
    const csv = csvConnector.formatOutbound(records, mapping);
    expect(csv).toContain('"Harbour Centre, Phase II"');
    expect(parseCsv(csv)[1]).toContain("Harbour Centre, Phase II");
  });

  test("rows missing the mapped external id or name are reported, not imported", () => {
    const csv = "Deal ID,Opportunity Name\n,No ID Deal\nCRM-9,\nCRM-10,Good Deal";
    const { records: parsed, errors } = csvConnector.parseInbound(csv, { "Deal ID": "external_id", "Opportunity Name": "name" });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].external_id).toBe("CRM-10");
    expect(errors.length).toBe(2);
  });

  test("the registry marks CSV live and CRM providers planned (no fake connections)", () => {
    expect(CONNECTOR_REGISTRY.find((c) => c.provider === "csv")?.status).toBe("live");
    expect(CONNECTOR_REGISTRY.find((c) => c.provider === "salesforce")?.status).toBe("planned");
    expect(CONNECTOR_REGISTRY.find((c) => c.provider === "dealcloud")?.status).toBe("planned");
  });
});
