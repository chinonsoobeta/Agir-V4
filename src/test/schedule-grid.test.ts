import { describe, test, expect } from "vitest";
import { runUnderwriting, mapleHeightsInput, buildScheduleGrid, phaseForPeriod } from "@/lib/engine";

describe("WS3 3A schedule grid data contract", () => {
  const out = runUnderwriting({ ...mapleHeightsInput(), monthlyModel: true });

  test("the monthly spine is present when monthly mode is on", () => {
    expect(out.schedule).toBeDefined();
    // 18 construction + 12 lease-up + 12 hold (holdYears 1) = 42 months.
    expect(out.schedule!.months).toBe(42);
  });

  test("a deal without monthly mode has no schedule (nothing to grid)", () => {
    expect(runUnderwriting(mapleHeightsInput()).schedule).toBeUndefined();
  });

  test("grid is periods-across-columns, line-items-down-rows, every cell carries its formula", () => {
    const grid = buildScheduleGrid(out.schedule!);
    expect(grid.months).toBe(out.schedule!.months);
    expect(grid.rows.length).toBeGreaterThan(0);
    // Each row spans every period.
    for (const row of grid.rows) expect(row.cells.length).toBe(grid.months);
    // Every populated cell carries a readable formula_text (the audit guarantee).
    let populated = 0;
    for (const row of grid.rows) {
      for (const cell of row.cells) {
        if (cell) {
          populated++;
          expect(typeof cell.formula_text).toBe("string");
          expect(cell.formula_text.length).toBeGreaterThan(0);
        }
      }
    }
    expect(populated).toBeGreaterThan(0);
    // Operations + construction lines are present and ordered (a draw before NOI).
    const keys = grid.rows.map((r) => r.lineKey);
    expect(keys).toContain("noi");
    expect(keys).toContain("hard_draw");
    expect(keys.indexOf("hard_draw")).toBeLessThan(keys.indexOf("noi"));
  });

  test("phases cover construction, lease-up, and hold with correct boundaries", () => {
    const grid = buildScheduleGrid(out.schedule!);
    const byKey = Object.fromEntries(grid.phases.map((p) => [p.key, p]));
    expect(byKey.construction).toMatchObject({ startMonth: 0, endMonth: 18 });
    expect(byKey.lease_up).toMatchObject({ startMonth: 18, endMonth: 30 });
    expect(byKey.hold).toMatchObject({ startMonth: 30, endMonth: 42 });
    expect(phaseForPeriod(out.schedule!, 0)).toBe("construction");
    expect(phaseForPeriod(out.schedule!, 20)).toBe("lease_up");
    expect(phaseForPeriod(out.schedule!, 35)).toBe("hold");
  });
});
