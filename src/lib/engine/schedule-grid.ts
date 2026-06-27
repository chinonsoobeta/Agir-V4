// WS3 / 3A. Pure data contract for the spreadsheet-grid transparency view: turn a
// monthly spine (EngineOutput.schedule) into periods-across-columns,
// line-items-down-rows. The grid renders ONLY this; it never computes a number.
// Each cell carries the node's amount and its formula_text, so clicking any cell
// shows exactly how the engine derived it.

import type { MonthlySchedule, PeriodNode, ScheduleLineKey } from "./types";

export type ScheduleGridCell = { period: number; amount: number; formula_text: string } | null;

export type ScheduleGridRow = {
  key: string; // node key (lineKey for built-ins, custom_<slug> for custom lines)
  lineKey: ScheduleLineKey;
  label: string;
  cells: ScheduleGridCell[]; // length = months; null where the line has no node that period
  total: number; // sum of the row's node amounts (audit aid)
};

export type SchedulePhase = {
  key: "construction" | "lease_up" | "hold";
  label: string;
  startMonth: number;
  endMonth: number;
};

export type ScheduleGrid = {
  months: number;
  phases: SchedulePhase[];
  rows: ScheduleGridRow[];
};

// Canonical row order: construction draws, financing carry, equity, operations,
// debt service, distributions, the refinance event, exit, then custom lines.
const LINE_ORDER: ScheduleLineKey[] = [
  "land_draw",
  "hard_draw",
  "soft_draw",
  "contingency_draw",
  "construction_interest",
  "equity_contribution",
  "gpr",
  "egi",
  "opex",
  "noi",
  "senior_interest",
  "senior_principal",
  "senior_debt_service",
  "mezz_interest",
  "mezz_principal",
  "mezz_debt_service",
  "levered_cf",
  "distribution",
  "refi_proceeds",
  "refi_payoff",
  "refi_cash_out",
  "sale",
  "loan_payoff",
  "custom",
];

const orderIndex = (lineKey: ScheduleLineKey): number => {
  const i = LINE_ORDER.indexOf(lineKey);
  return i < 0 ? LINE_ORDER.length : i;
};

export function buildScheduleGrid(schedule: MonthlySchedule): ScheduleGrid {
  const months = schedule.months;

  // Group nodes by their stable key (custom lines keep their own key/label/lineKey).
  const byKey = new Map<string, { lineKey: ScheduleLineKey; label: string; nodes: PeriodNode[] }>();
  for (const node of schedule.nodes) {
    const entry = byKey.get(node.key) ?? { lineKey: node.lineKey, label: node.label, nodes: [] };
    entry.nodes.push(node);
    byKey.set(node.key, entry);
  }

  const rows: ScheduleGridRow[] = Array.from(byKey.entries())
    .map(([key, { lineKey, label, nodes }]) => {
      const cells: ScheduleGridCell[] = Array.from({ length: months }, () => null);
      let total = 0;
      for (const n of nodes) {
        if (n.period >= 0 && n.period < months) {
          cells[n.period] = { period: n.period, amount: n.amount, formula_text: n.formula_text };
        }
        total += n.amount;
      }
      return { key, lineKey, label, cells, total };
    })
    // Stable order: by canonical line position, then custom lines alphabetically by key.
    .sort((a, b) => orderIndex(a.lineKey) - orderIndex(b.lineKey) || a.key.localeCompare(b.key));

  const phases = buildPhases(schedule);
  return { months, phases, rows };
}

function buildPhases(schedule: MonthlySchedule): SchedulePhase[] {
  const { constructionMonths: c, leaseUpMonths: l, holdMonths: h } = schedule;
  const phases: SchedulePhase[] = [];
  if (c > 0)
    phases.push({ key: "construction", label: "Construction", startMonth: 0, endMonth: c });
  if (l > 0) phases.push({ key: "lease_up", label: "Lease-up", startMonth: c, endMonth: c + l });
  if (h > 0)
    phases.push({ key: "hold", label: "Stabilized hold", startMonth: c + l, endMonth: c + l + h });
  return phases;
}

// The phase a given month index falls in (for column grouping / shading).
export function phaseForPeriod(schedule: MonthlySchedule, period: number): SchedulePhase["key"] {
  const c = schedule.constructionMonths;
  const l = schedule.leaseUpMonths;
  if (period < c) return "construction";
  if (period < c + l) return "lease_up";
  return "hold";
}
