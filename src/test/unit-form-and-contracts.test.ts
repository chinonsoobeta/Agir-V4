// Task 3: branded units extended beyond the engine boundary.
// (a) UI form-state parsers brand raw input and reject implausible/wrong-unit
//     entries at the edge; (b) the DB-read / report-build boundary surfaces
//     unit-contract drift (a persisted assumption whose stored unit no longer
//     matches the taxonomy, or a financial output emitting a non-canonical unit).

import { describe, expect, test } from "vitest";
import {
  parseMoneyField,
  parsePercentField,
  parseMonthsField,
  parsePerSfField,
  formatMoney,
  formatPercent,
} from "@/lib/unit-form";
import { loadReportData } from "@/lib/reports/report-data.server";

describe("UI form-state branded parsers", () => {
  test("money parses and strips presentation noise", () => {
    const r = parseMoneyField("$34,500,000");
    expect(r.ok && r.value).toBe(34_500_000);
  });

  test("a parenthesized amount parses as negative and is rejected by the non-negative domain", () => {
    expect(parseMoneyField("(500)").ok).toBe(false);
  });

  test("percent strips the % sign and enforces the whole-percent domain", () => {
    const ok = parsePercentField("6.25%");
    expect(ok.ok && ok.value).toBe(6.25);
    // 0.0625 would be a fraction-vs-whole slip only if out of domain; a rate
    // field bounded to <=40 rejects an implausible 600.
    expect(parsePercentField("600", { max: 40, label: "Interest rate" }).ok).toBe(false);
  });

  test("months and per-sf parse within their domains", () => {
    expect(parseMonthsField("24").ok).toBe(true);
    const psf = parsePerSfField("$42");
    expect(psf.ok ? psf.value : null).toBe(42);
    expect(parsePerSfField("not a number").ok).toBe(false);
  });

  test("formatters keep the unit explicit", () => {
    // The branded value is a number at runtime; the casts only matter at compile.
    expect(formatPercent(6.25 as never)).toBe("6.25%");
    expect(formatMoney(34_500_000 as never)).toContain("34,500,000");
  });
});

// ---- Report-data boundary: a minimal PostgREST-shaped fake ----

function fakeSupabase(db: Record<string, any[]>, project: any) {
  const make = (table: string) => {
    const builder: any = {
      _table: table,
      select() {
        return builder;
      },
      eq() {
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      in() {
        return builder;
      },
      maybeSingle: async () => ({ data: project, error: null }),
      then: (res: any, rej: any) =>
        Promise.resolve({ data: db[table] ?? [], error: null }).then(res, rej),
    };
    return builder;
  };
  return { from: (t: string) => make(t) };
}

const emptyTables = {
  documents: [],
  underwriting_inputs: [],
  development_budget: [],
  revenue_program: [],
  cash_flows: [],
  reconciliation_flags: [],
  risk_register: [],
  investment_memos: [],
  decision_logs: [],
  audit_logs: [],
  scenarios: [],
  assumption_versions: [],
};

describe("unit-contract drift surfaced at the report-data boundary", () => {
  test("a clean project surfaces no unit-contract issues", async () => {
    const supabase = fakeSupabase(
      {
        ...emptyTables,
        assumptions: [{ id: "a1", field_key: "land_cost", unit: "$", value_numeric: 1 }],
        financial_outputs: [{ metric_key: "noi", unit: "$", value_numeric: 1 }],
      },
      { id: "p1", name: "Clean" },
    );
    const report = await loadReportData(
      supabase as unknown as Parameters<typeof loadReportData>[0],
      "p1",
    );
    expect(report.unitContractIssues).toEqual([]);
  });

  test("a drifted assumption unit and a non-canonical output unit both surface", async () => {
    const supabase = fakeSupabase(
      {
        ...emptyTables,
        // land_cost must be "$"; persisted as "%" is drift.
        assumptions: [{ id: "a1", field_key: "land_cost", unit: "%", value_numeric: 1 }],
        // a null unit predates the column and is NOT treated as drift.
        // financial output emitting a bogus unit.
        financial_outputs: [{ metric_key: "noi", unit: "bananas", value_numeric: 1 }],
      },
      { id: "p1", name: "Drifted" },
    );
    const report = await loadReportData(
      supabase as unknown as Parameters<typeof loadReportData>[0],
      "p1",
    );
    const keys = report.unitContractIssues.map((i) => i.key);
    expect(keys).toContain("land_cost");
    expect(keys).toContain("noi");
  });

  test("a null-unit assumption (pre-dates the unit column) is not flagged as drift", async () => {
    const supabase = fakeSupabase(
      {
        ...emptyTables,
        assumptions: [{ id: "a1", field_key: "land_cost", unit: null, value_numeric: 1 }],
        financial_outputs: [],
      },
      { id: "p1", name: "Legacy" },
    );
    const report = await loadReportData(
      supabase as unknown as Parameters<typeof loadReportData>[0],
      "p1",
    );
    expect(report.unitContractIssues).toEqual([]);
  });
});
