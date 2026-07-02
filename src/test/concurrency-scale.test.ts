import { describe, expect, test } from "vitest";
import {
  STALE_ASSUMPTION_REVIEW_MESSAGE,
  updateAssumptionWithExpectedVersion,
} from "@/lib/assumptions.functions";
import {
  APPROVED_ASSUMPTION_SYNC_MESSAGE,
  assertApprovedAssumptionsSynced,
  persistAcceptedDefaults,
} from "@/lib/underwriting.functions";
import { loadReportData } from "@/lib/reports/report-data.server";
import { claimJob, completeJob } from "@/lib/extraction-jobs.server";

type QueryRecord = {
  table: string;
  operation: "select" | "update" | "upsert";
  filters: Array<{ type: "eq" | "in"; column: string; value: unknown }>;
  rowCount?: number;
};

class FakeQuery {
  private filters: QueryRecord["filters"] = [];
  private operation: "select" | "update" | "upsert" = "select";
  private rowCount: number | undefined;

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

  async upsert(rows: Record<string, unknown> | Record<string, unknown>[]) {
    const list = Array.isArray(rows) ? rows : [rows];
    this.operation = "upsert";
    this.rowCount = list.length;
    this.records.push({
      table: this.table,
      operation: "upsert",
      filters: [],
      rowCount: list.length,
    });
    const target = (this.db[this.table] ??= []);
    target.push(...list);
    return { data: list, error: null };
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

  test("assumption updates retry without dual-control columns on older schemas", async () => {
    const row = {
      id: "a1",
      current_version: 1,
      status: "extracted",
    };
    const updates: Record<string, unknown>[] = [];
    const supabase = {
      from(table: string) {
        expect(table).toBe("assumptions");
        const query = {
          patch: {} as Record<string, unknown>,
          update(patch: Record<string, unknown>) {
            this.patch = patch;
            updates.push(patch);
            return this;
          },
          eq() {
            return this;
          },
          select() {
            return this;
          },
          async maybeSingle() {
            if ("dual_control_pending" in this.patch || "override_reason" in this.patch) {
              return {
                data: null,
                error: {
                  code: "PGRST204",
                  message:
                    "Could not find the 'override_reason' column of 'assumptions' in the schema cache",
                },
              };
            }
            Object.assign(row, this.patch);
            return { data: { ...row }, error: null };
          },
        };
        return query;
      },
    };

    const result = await updateAssumptionWithExpectedVersion(supabase, "a1", 1, {
      current_version: 2,
      status: "modified",
      override_reason: "Broker OM conflict resolved to conservative cap rate",
      requires_dual_control: true,
      dual_control_pending: true,
      second_approval_by: null,
      second_approval_at: null,
      second_approver_name: null,
    });

    expect(result.status).toBe("modified");
    expect(updates).toHaveLength(2);
    expect(updates[0]).toHaveProperty(
      "override_reason",
      "Broker OM conflict resolved to conservative cap rate",
    );
    expect(updates[0]).toHaveProperty("dual_control_pending", true);
    expect(updates[1]).not.toHaveProperty("override_reason");
    expect(updates[1]).not.toHaveProperty("requires_dual_control");
    expect(updates[1]).not.toHaveProperty("dual_control_pending");
    expect(updates[1]).not.toHaveProperty("second_approval_by");
  });

  test("assumption dual-control missing columns throw in strict schema mode", async () => {
    const previousMode = process.env.AGIR_SCHEMA_COMPAT_MODE;
    process.env.AGIR_SCHEMA_COMPAT_MODE = "strict";
    const supabase = {
      from(table: string) {
        expect(table).toBe("assumptions");
        return {
          update() {
            return this;
          },
          eq() {
            return this;
          },
          select() {
            return this;
          },
          async maybeSingle() {
            return {
              data: null,
              error: {
                code: "PGRST204",
                message:
                  "Could not find the 'override_reason' column of 'assumptions' in the schema cache",
              },
            };
          },
        };
      },
    };

    try {
      await expect(
        updateAssumptionWithExpectedVersion(supabase, "a1", 1, {
          current_version: 2,
          override_reason: "conflict resolution",
          dual_control_pending: true,
        }),
      ).rejects.toThrow(/assumption dual-control review.*assumptions\.dual-control columns/);
    } finally {
      if (previousMode == null) delete process.env.AGIR_SCHEMA_COMPAT_MODE;
      else process.env.AGIR_SCHEMA_COMPAT_MODE = previousMode;
    }
  });

  test("extraction jobs fall back to inline execution when the job table is missing", async () => {
    const supabase = {
      from(table: string) {
        expect(table).toBe("extraction_jobs");
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          async maybeSingle() {
            return {
              data: null,
              error: {
                code: "PGRST205",
                message: "Could not find the table 'public.extraction_jobs' in the schema cache",
              },
            };
          },
          insert() {
            throw new Error("claimJob should not write when the table is missing");
          },
          update() {
            throw new Error("inline jobs should not update a missing table");
          },
        };
      },
    };

    const ctx = { supabase: supabase as never, userId: "user-1" };
    const { job, existed } = await claimJob(ctx, {
      kind: "assumption_extraction",
      idempotencyKey: "demo-hash",
      projectId: "project-1",
      total: 3,
      message: "Extracting assumptions from 3 document(s)",
    });

    expect(existed).toBe(false);
    expect(job.id).toContain("inline-job:assumption_extraction:demo-hash");
    expect(job.total).toBe(3);
    await expect(completeJob(ctx, job.id, {})).resolves.toBe(undefined);
  });

  test("extraction jobs throw clearly when the job table is missing in strict schema mode", async () => {
    const previousMode = process.env.AGIR_SCHEMA_COMPAT_MODE;
    process.env.AGIR_SCHEMA_COMPAT_MODE = "strict";
    const supabase = {
      from(table: string) {
        expect(table).toBe("extraction_jobs");
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          async maybeSingle() {
            return {
              data: null,
              error: {
                code: "PGRST205",
                message: "Could not find the table 'public.extraction_jobs' in the schema cache",
              },
            };
          },
        };
      },
    };

    try {
      await expect(
        claimJob(
          { supabase: supabase as never, userId: "user-1" },
          {
            kind: "assumption_extraction",
            idempotencyKey: "strict-hash",
            projectId: "project-1",
          },
        ),
      ).rejects.toThrow(
        /Required database schema is missing.*extraction_jobs queue.*extraction_jobs/,
      );
    } finally {
      if (previousMode == null) delete process.env.AGIR_SCHEMA_COMPAT_MODE;
      else process.env.AGIR_SCHEMA_COMPAT_MODE = previousMode;
    }
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

    const report = await loadReportData(
      supabase as unknown as Parameters<typeof loadReportData>[0],
      "p1",
    );
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

  test("accepting defaults batches N keys into one upsert instead of N", async () => {
    const supabase = fakeSupabase({ underwriting_inputs: [] });
    const keys = ["expense_ratio_pct", "selling_costs_pct", "hold_years", "lease_up_months"];

    const accepted = await persistAcceptedDefaults(supabase, {
      projectId: "p1",
      userId: "u1",
      keys,
      via: "analyst",
    });

    expect(accepted).toEqual(keys);
    const upserts = supabase.records.filter((record) => record.operation === "upsert");
    expect(upserts).toHaveLength(1);
    expect(upserts[0].table).toBe("underwriting_inputs");
    expect(upserts[0].rowCount).toBe(keys.length);
  });

  test("default acceptance collapses duplicate keys so one conflict row is never touched twice", async () => {
    const supabase = fakeSupabase({ underwriting_inputs: [] });

    const accepted = await persistAcceptedDefaults(supabase, {
      projectId: "p1",
      userId: "u1",
      // The AI path can return the same index twice; a single upsert statement
      // must not list the same (project_id,key) conflict row more than once.
      keys: ["hold_years", "hold_years", "not_a_real_default"],
      via: "ai",
    });

    expect(accepted).toEqual(["hold_years"]);
    const upserts = supabase.records.filter((record) => record.operation === "upsert");
    expect(upserts).toHaveLength(1);
    expect(upserts[0].rowCount).toBe(1);
  });

  test("accepting an empty default set issues no write at all", async () => {
    const supabase = fakeSupabase({ underwriting_inputs: [] });
    const accepted = await persistAcceptedDefaults(supabase, {
      projectId: "p1",
      userId: "u1",
      keys: [],
      via: "analyst",
    });
    expect(accepted).toEqual([]);
    expect(supabase.records.filter((r) => r.operation === "upsert")).toHaveLength(0);
  });
});
