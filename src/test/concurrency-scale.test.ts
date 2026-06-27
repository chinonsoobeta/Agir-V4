import { describe, expect, test } from "vitest";
import {
  STALE_ASSUMPTION_REVIEW_MESSAGE,
  updateAssumptionWithExpectedVersion,
} from "@/lib/assumptions.functions";
import {
  APPROVED_ASSUMPTION_SYNC_MESSAGE,
  assertApprovedAssumptionsSynced,
} from "@/lib/underwriting.functions";
import { loadReportData } from "@/lib/reports/report-data.server";

type QueryRecord = {
  table: string;
  operation: "select" | "update";
  filters: Array<{ type: "eq" | "in"; column: string; value: unknown }>;
};

class FakeQuery {
  private filters: QueryRecord["filters"] = [];
  private operation: "select" | "update" = "select";

  constructor(
    private table: string,
    private db: Record<string, any[]>,
    private records: QueryRecord[],
    private patch: Record<string, unknown> | null = null,
  ) {}

  select() {
    return this;
  }

  update(patch: Record<string, unknown>) {
    this.operation = "update";
    this.patch = patch;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ type: "in", column, value });
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return this;
  }

  async maybeSingle() {
    const { data, error } = this.execute();
    return { data: Array.isArray(data) ? (data[0] ?? null) : data, error };
  }

  async single() {
    const { data, error } = this.execute();
    return { data: Array.isArray(data) ? data[0] : data, error };
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: any[]; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute() {
    this.records.push({
      table: this.table,
      operation: this.operation,
      filters: [...this.filters],
    });
    let rows = [...(this.db[this.table] ?? [])];
    for (const filter of this.filters) {
      if (filter.type === "eq") rows = rows.filter((row) => row[filter.column] === filter.value);
      else {
        const values = new Set(filter.value as unknown[]);
        rows = rows.filter((row) => values.has(row[filter.column]));
      }
    }

    if (this.operation === "update") {
      const original = this.db[this.table] ?? [];
      let updated: any | null = null;
      for (const row of original) {
        if (rows.includes(row)) {
          Object.assign(row, this.patch);
          updated = { ...row };
          break;
        }
      }
      return { data: updated ? [updated] : [], error: null };
    }

    return { data: rows.map((row) => ({ ...row })), error: null };
  }
}

function fakeSupabase(db: Record<string, any[]>) {
  const records: QueryRecord[] = [];
  return {
    records,
    from(table: string) {
      return new FakeQuery(table, db, records);
    },
  };
}

describe("concurrency and scale guards", () => {
  test("optimistic assumption updates reject a stale concurrent approval", async () => {
    const supabase = fakeSupabase({
      assumptions: [
        {
          id: "a1",
          current_version: 1,
          status: "extracted",
        },
      ],
    });

    const first = updateAssumptionWithExpectedVersion(supabase, "a1", 1, {
      current_version: 2,
      status: "approved",
    });
    const second = updateAssumptionWithExpectedVersion(supabase, "a1", 1, {
      current_version: 2,
      status: "rejected",
    });

    const results = await Promise.allSettled([first, second]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(Error);
    expect((rejected as PromiseRejectedResult).reason.message).toBe(
      STALE_ASSUMPTION_REVIEW_MESSAGE,
    );
  });

  test("underwriting refuses to run while approved assumptions are not synced to engine rows", async () => {
    const supabase = fakeSupabase({
      assumptions: [
        {
          field_key: "interest_rate",
          field_label: "Interest Rate",
          value_numeric: 6.25,
          status: "approved",
          project_id: "p1",
        },
      ],
      underwriting_inputs: [
        { key: "interest_rate_pct", value_numeric: 5.75, status: "approved", project_id: "p1" },
      ],
      development_budget: [],
      revenue_program: [],
    });

    await expect(assertApprovedAssumptionsSynced(supabase, "p1")).rejects.toThrow(
      APPROVED_ASSUMPTION_SYNC_MESSAGE,
    );
  });

  test("report data batches assumption version loading with one IN query", async () => {
    const supabase = fakeSupabase({
      projects: [{ id: "p1", name: "Project" }],
      documents: [],
      assumptions: [
        { id: "a1", project_id: "p1", field_key: "land_cost" },
        { id: "a2", project_id: "p1", field_key: "hard_costs" },
      ],
      assumption_versions: [
        { id: "v1", assumption_id: "a1" },
        { id: "v2", assumption_id: "a2" },
      ],
      underwriting_inputs: [],
      development_budget: [],
      revenue_program: [],
      financial_outputs: [],
      cash_flows: [],
      reconciliation_flags: [],
      risk_register: [],
      investment_memos: [],
      decision_logs: [],
      audit_logs: [],
      scenarios: [],
    });

    const report = await loadReportData(supabase, "p1");
    expect(report.assumptionVersions).toHaveLength(2);
    const versionQueries = supabase.records.filter(
      (record) => record.table === "assumption_versions",
    );
    expect(versionQueries).toHaveLength(1);
    expect(versionQueries[0].filters).toContainEqual({
      type: "in",
      column: "assumption_id",
      value: ["a1", "a2"],
    });
  });
});
