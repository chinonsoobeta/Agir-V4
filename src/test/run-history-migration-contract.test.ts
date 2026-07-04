import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20260704000200_lock_run_history_insert_integrity.sql",
  "utf8",
);

const historyTables = [
  "run_financial_outputs",
  "run_cash_flows",
  "run_reconciliation_flags",
  "run_risk_register",
];

describe("normalized run history migration contract", () => {
  test("authenticated users cannot directly insert immutable run-history rows", () => {
    for (const table of historyTables) {
      expect(sql).toContain(`REVOKE INSERT ON public.${table} FROM authenticated;`);
      expect(sql).toContain(`DROP POLICY IF EXISTS "${table}_insert_allowed" ON public.${table};`);
    }
  });

  test("insert trigger verifies run, project, owner, and completed status", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.validate_run_history_insert()");
    expect(sql).toContain("run_row.status <> 'completed'");
    expect(sql).toContain("run_row.project_id <> NEW.project_id");
    expect(sql).toContain("run_row.owner_id <> NEW.owner_id");
    for (const table of historyTables) {
      expect(sql).toContain(`BEFORE INSERT ON public.${table}`);
    }
  });
});
