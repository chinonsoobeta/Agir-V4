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
import { buildCommitteeReadiness } from "@/lib/committee/readiness";
import { canAccessRow, canWriteRow } from "@/lib/workspace-access";
import {
  csvConnector,
  parseCsv,
  CONNECTOR_REGISTRY,
  type DealRecord,
  type FieldMapping,
} from "@/lib/integrations/connector";
import { importDealRecords } from "@/lib/operating-layer.functions";

// Minimal PostgREST-shaped fake: records every (table, op) so tests can assert
// query counts (the N+1 guard), executes filters/inserts against an in-memory
// db, and can fail a project insert by name to exercise the per-row fallback.
function fakeSupabase(seed: Record<string, any[]> = {}, opts: { failProjectName?: string } = {}) {
  const db: Record<string, any[]> = {
    projects: [...(seed.projects ?? [])],
    external_record_links: [...(seed.external_record_links ?? [])],
  };
  const calls: Array<{ table: string; op: string }> = [];
  let idSeq = 1000;

  function from(table: string) {
    const state: {
      op: "select" | "insert" | "update";
      filters: Array<["eq" | "in", string, any]>;
      patch: any;
      rows: any[] | null;
      returning: boolean;
    } = { op: "select", filters: [], patch: null, rows: null, returning: false };

    const applyFilters = (rows: any[]) => {
      let out = rows;
      for (const [type, col, val] of state.filters) {
        if (type === "eq") out = out.filter((r) => r[col] === val);
        else {
          const set = new Set(val as any[]);
          out = out.filter((r) => set.has(r[col]));
        }
      }
      return out;
    };

    const run = (single: boolean) => {
      calls.push({ table, op: state.op });
      if (state.op === "insert") {
        const rows = state.rows ?? [];
        if (table === "projects" && opts.failProjectName) {
          // A statement that includes the poison row fails as a whole, exactly
          // like Postgres rejecting a multi-row INSERT on one bad tuple.
          if (rows.some((r) => r.name === opts.failProjectName)) {
            return { data: null, error: { message: "invalid row in batch" } };
          }
        }
        const created = rows.map((r) => ({ ...r, id: r.id ?? `gen-${idSeq++}` }));
        (db[table] ??= []).push(...created);
        const data = state.returning ? created.map((r) => ({ id: r.id })) : null;
        return { data: single ? (data?.[0] ?? null) : data, error: null };
      }
      if (state.op === "update") {
        const matched = applyFilters(db[table] ?? []);
        for (const row of matched) Object.assign(row, state.patch);
        const data = matched.map((r) => ({ ...r }));
        return { data: single ? (data[0] ?? null) : data, error: null };
      }
      const rows = applyFilters(db[table] ?? []).map((r) => ({ ...r }));
      return { data: single ? (rows[0] ?? null) : rows, error: null };
    };

    const builder: any = {
      select(_cols?: string) {
        state.returning = true;
        return builder;
      },
      update(patch: any) {
        state.op = "update";
        state.patch = patch;
        return builder;
      },
      insert(rows: any) {
        state.op = "insert";
        state.rows = Array.isArray(rows) ? rows : [rows];
        return builder;
      },
      eq(col: string, val: any) {
        state.filters.push(["eq", col, val]);
        return builder;
      },
      in(col: string, vals: any[]) {
        state.filters.push(["in", col, vals]);
        return builder;
      },
      single: async () => run(true),
      maybeSingle: async () => run(true),
      then: (res: any, rej: any) => Promise.resolve(run(false)).then(res, rej),
    };
    return builder;
  }

  return { from, calls, db };
}

const countOps = (calls: Array<{ table: string; op: string }>, table: string, op: string) =>
  calls.filter((c) => c.table === table && c.op === op).length;

const M = (
  id: string,
  dueDate: string | null,
  status: ExecMilestone["status"],
  dependsOn: string[] = [],
): ExecMilestone => ({
  id,
  title: id,
  dueDate,
  status,
  dependsOn,
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
    const cyclic = [
      M("a", "2026-07-01", "not_started", ["b"]),
      M("b", "2026-07-02", "not_started", ["a"]),
    ];
    const r = computeCriticalPath(cyclic, null, "2026-07-01");
    expect(r.hasCycle).toBe(true);
    expect(r.cycles.length).toBeGreaterThan(0);
  });
});

describe("3B IC vote tallying", () => {
  const vote = (memberId: string, v: IcVote["vote"]): IcVote => ({ memberId, vote: v });

  test("a clear majority approves", () => {
    const t = tallyVotes([
      vote("a", "approve"),
      vote("b", "approve"),
      vote("c", "approve"),
      vote("d", "reject"),
    ]);
    expect(t.quorumMet).toBe(true);
    expect(t.approvalPct).toBe(75);
    expect(t.outcome).toBe("approved");
  });

  test("conditional approvals dominate -> approved_with_conditions", () => {
    const t = tallyVotes([
      vote("a", "approve_with_conditions"),
      vote("b", "approve_with_conditions"),
      vote("c", "approve"),
    ]);
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
    expect(
      openConditionCount([{ status: "open" }, { status: "open" }, { status: "satisfied" }]),
    ).toBe(2);
  });
});

describe("3B committee readiness accountability", () => {
  test("blocks committee before deterministic outputs and clean assumptions exist", () => {
    const readiness = buildCommitteeReadiness({
      hasUnderwriting: false,
      assumptions: [{ status: "approved" }, { status: "conflicting" }, { status: "missing" }],
      reconciliationFlags: [{ severity: "error", resolved: false }],
      voteTally: tallyVotes([]),
      conditions: [{ status: "open" }],
      decisions: [],
      memoCount: 0,
    });

    expect(readiness.status).toBe("blocked");
    expect(readiness.blockers).toBeGreaterThanOrEqual(3);
    expect(readiness.items.find((item) => item.key === "underwriting")?.severity).toBe("blocker");
    expect(readiness.items.find((item) => item.key === "assumptions")?.severity).toBe("blocker");
    expect(readiness.items.find((item) => item.key === "reconciliation")?.severity).toBe("blocker");
  });

  test("marks a clean package ready while preserving workflow warnings", () => {
    const readiness = buildCommitteeReadiness({
      hasUnderwriting: true,
      assumptions: [{ status: "approved" }, { status: "modified" }],
      reconciliationFlags: [],
      voteTally: tallyVotes([
        { memberId: "a", vote: "approve" },
        { memberId: "b", vote: "approve_with_conditions" },
      ]),
      conditions: [],
      decisions: [],
      memoCount: 0,
    });

    expect(readiness.status).toBe("ready");
    expect(readiness.blockers).toBe(0);
    expect(readiness.items.find((item) => item.key === "memo")?.severity).toBe("warning");
    expect(readiness.items.find((item) => item.key === "decision_history")?.severity).toBe(
      "warning",
    );
  });

  test("records a decided package once committee has made a terminal decision", () => {
    const readiness = buildCommitteeReadiness({
      hasUnderwriting: true,
      assumptions: [{ status: "approved" }],
      reconciliationFlags: [],
      voteTally: tallyVotes([
        { memberId: "a", vote: "approve" },
        { memberId: "b", vote: "approve" },
      ]),
      conditions: [{ status: "satisfied" }],
      decisions: [{ decision: "approve", user_name: "A. Sponsor", created_at: "2026-06-27" }],
      memoCount: 1,
    });

    expect(readiness.status).toBe("decided");
    expect(readiness.label).toBe("Decision recorded");
    expect(readiness.items.find((item) => item.key === "decision_history")?.detail).toContain(
      "A. Sponsor",
    );
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
    Market: "location",
    Product: "type",
    "Lead Source": "source",
    "Win %": "probability",
    "Target Close": "target_close_date",
  };
  const records: DealRecord[] = [
    {
      external_id: "CRM-1",
      name: "Harbour Centre, Phase II",
      location: "Vancouver, BC",
      type: "mixed_use",
      source: "broker",
      probability: 60,
      target_close_date: "2026-09-01",
    },
    {
      external_id: "CRM-2",
      name: "Rivergate",
      location: "Austin, TX",
      type: "multifamily",
      source: "direct",
      probability: 35,
      target_close_date: null,
    },
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
    const { records: parsed, errors } = csvConnector.parseInbound(csv, {
      "Deal ID": "external_id",
      "Opportunity Name": "name",
    });
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

describe("3C integrations: deal import persistence batches its queries (N+1 guard)", () => {
  const deal = (external_id: string, name: string): DealRecord => ({
    external_id,
    name,
    location: null,
    type: null,
    source: "broker",
    probability: null,
    target_close_date: null,
  });

  test("N brand-new deals cost one read, one project insert, and one link insert", async () => {
    const supabase = fakeSupabase();
    const records = [deal("CRM-1", "Alpha"), deal("CRM-2", "Beta"), deal("CRM-3", "Gamma")];

    const result = await importDealRecords(supabase, {
      connectionId: "conn-1",
      ownerId: "user-1",
      workspaceId: null,
      records,
    });

    expect(result).toEqual({ created: 3, updated: 0, failed: 0 });
    // The N+1 that this fix targets: link lookups must be a single IN query, not
    // one SELECT per record. Writes are likewise two statements, not 2N.
    expect(countOps(supabase.calls, "external_record_links", "select")).toBe(1);
    expect(countOps(supabase.calls, "projects", "insert")).toBe(1);
    expect(countOps(supabase.calls, "external_record_links", "insert")).toBe(1);
    expect(supabase.db.projects).toHaveLength(3);
    expect(supabase.db.external_record_links).toHaveLength(3);
  });

  test("existing deals update in place and refresh last_synced_at in one batched touch", async () => {
    const supabase = fakeSupabase({
      projects: [{ id: "p1", name: "Old Name" }],
      external_record_links: [
        { id: "l1", connection_id: "conn-1", external_id: "CRM-1", project_id: "p1" },
      ],
    });

    const result = await importDealRecords(supabase, {
      connectionId: "conn-1",
      ownerId: "user-1",
      workspaceId: null,
      records: [deal("CRM-1", "New Name"), deal("CRM-2", "Fresh")],
    });

    expect(result).toEqual({ created: 1, updated: 1, failed: 0 });
    expect(supabase.db.projects.find((p) => p.id === "p1")?.name).toBe("New Name");
    // One project UPDATE for the existing deal, and exactly one batched link
    // touch (not one per updated record).
    expect(countOps(supabase.calls, "projects", "update")).toBe(1);
    expect(countOps(supabase.calls, "external_record_links", "update")).toBe(1);
    expect(
      supabase.db.external_record_links.find((l) => l.id === "l1")?.last_synced_at,
    ).toBeTruthy();
  });

  test("one unparseable row falls back to per-row inserts without poisoning the batch", async () => {
    const supabase = fakeSupabase({}, { failProjectName: "Bad Deal" });

    const result = await importDealRecords(supabase, {
      connectionId: "conn-1",
      ownerId: "user-1",
      workspaceId: null,
      records: [deal("CRM-1", "Good A"), deal("CRM-2", "Bad Deal"), deal("CRM-3", "Good B")],
    });

    expect(result).toEqual({ created: 2, updated: 0, failed: 1 });
    // The good rows still land despite the poison row.
    expect(supabase.db.projects.map((p) => p.name).sort()).toEqual(["Good A", "Good B"]);
    expect(supabase.db.external_record_links).toHaveLength(2);
  });

  test("an empty record set performs no writes at all", async () => {
    const supabase = fakeSupabase();
    const result = await importDealRecords(supabase, {
      connectionId: "conn-1",
      ownerId: "user-1",
      workspaceId: null,
      records: [],
    });
    expect(result).toEqual({ created: 0, updated: 0, failed: 0 });
    expect(supabase.calls).toHaveLength(0);
  });
});
