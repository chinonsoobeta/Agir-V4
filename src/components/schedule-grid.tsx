// WS3 / 3A. Spreadsheet-grid transparency view: the monthly spine rendered like
// Excel (periods across columns, line items down rows). Clicking any cell shows
// the engine's formula_text for that node -- audit any number, with no arbitrary
// user formulas. The grid renders the in-memory schedule from a client-side engine
// re-run; it computes nothing itself.

import { useMemo, useRef, useState } from "react";
import {
  runUnderwriting,
  buildScheduleGrid,
  type ScheduleGridCell,
  type UnderwritingInput,
} from "@/lib/engine";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/decision-ui";
import { Table2 } from "lucide-react";

const money = (n: number) =>
  (n < 0 ? "-" : "") +
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Math.abs(n));

type Selected = { rowLabel: string; period: number; phase: string; cell: ScheduleGridCell };

export function ScheduleGrid({ input }: { input: UnderwritingInput }) {
  // Forcing monthlyModel on is a byte-identical roll-up when no precision feature
  // is set, so the grid renders for any ready deal without changing its numbers.
  const out = useMemo(() => runUnderwriting({ ...input, monthlyModel: true }), [input]);
  const grid = useMemo(() => (out.schedule ? buildScheduleGrid(out.schedule) : null), [out]);
  const [selected, setSelected] = useState<Selected | null>(null);
  // Roving tabindex: only one cell is tab-focusable; arrows move between cells so
  // the grid is a single tab stop rather than hundreds of buttons.
  const cellRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const firstKey = useMemo(() => {
    if (!grid) return null;
    for (let r = 0; r < grid.rows.length; r++) {
      const c = grid.rows[r].cells.findIndex((x) => x);
      if (c >= 0) return `${r}-${c}`;
    }
    return null;
  }, [grid]);

  if (!grid) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        The monthly schedule is unavailable for this deal.
      </Card>
    );
  }

  const rows = grid.rows;
  const effectiveActive = activeKey ?? firstKey;
  const focusCell = (r: number, c: number) => {
    const el = cellRefs.current.get(`${r}-${c}`);
    if (el) {
      setActiveKey(`${r}-${c}`);
      el.focus();
      return true;
    }
    return false;
  };
  const onGridKey = (e: React.KeyboardEvent, r: number, c: number) => {
    const go = (rr: number, cc: number) => {
      e.preventDefault();
      focusCell(rr, cc);
    };
    if (e.key === "ArrowRight") {
      for (let cc = c + 1; cc < rows[r].cells.length; cc++) if (rows[r].cells[cc]) return go(r, cc);
    } else if (e.key === "ArrowLeft") {
      for (let cc = c - 1; cc >= 0; cc--) if (rows[r].cells[cc]) return go(r, cc);
    } else if (e.key === "ArrowDown") {
      for (let rr = r + 1; rr < rows.length; rr++) if (rows[rr].cells[c]) return go(rr, c);
    } else if (e.key === "ArrowUp") {
      for (let rr = r - 1; rr >= 0; rr--) if (rows[rr].cells[c]) return go(rr, c);
    } else if (e.key === "Home") {
      const cc = rows[r].cells.findIndex((x) => x);
      if (cc >= 0) return go(r, cc);
    } else if (e.key === "End") {
      for (let cc = rows[r].cells.length - 1; cc >= 0; cc--)
        if (rows[r].cells[cc]) return go(r, cc);
    }
  };

  const phaseOf = (period: number): string =>
    grid.phases.find((p) => period >= p.startMonth && period < p.endMonth)?.label ?? "";

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <Table2 className="size-4 text-primary" />
        <Eyebrow>Monthly schedule · {grid.months} periods · click any cell for its formula</Eyebrow>
      </div>
      <Card className="overflow-x-auto elevated">
        <table className="data-grid w-full text-xs">
          <caption className="sr-only">
            Monthly schedule of engine-computed line items across {grid.months} periods. Select any
            cell to see the formula behind its value.
          </caption>
          <thead>
            <tr className="bg-muted/30">
              <th className="text-left sticky left-0 bg-muted/30 z-10" scope="col">
                Phase
              </th>
              {grid.phases.map((p) => (
                <th
                  key={p.key}
                  className="text-center"
                  scope="colgroup"
                  colSpan={p.endMonth - p.startMonth}
                >
                  {p.label}
                </th>
              ))}
            </tr>
            <tr className="bg-muted/20">
              <th className="text-left sticky left-0 bg-muted/20 z-10" scope="col">
                Line item · month
              </th>
              {Array.from({ length: grid.months }, (_, m) => (
                <th key={m} className="text-right num text-muted-foreground" scope="col">
                  {m + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row, ri) => (
              <tr key={row.key}>
                <td className="font-medium whitespace-nowrap sticky left-0 bg-background z-10">
                  {row.label}
                </td>
                {row.cells.map((cell, period) => (
                  <td key={period} className="text-right num p-0">
                    {cell ? (
                      <button
                        type="button"
                        ref={(el) => {
                          const k = `${ri}-${period}`;
                          if (el) cellRefs.current.set(k, el);
                          else cellRefs.current.delete(k);
                        }}
                        tabIndex={`${ri}-${period}` === effectiveActive ? 0 : -1}
                        onFocus={() => setActiveKey(`${ri}-${period}`)}
                        onKeyDown={(e) => onGridKey(e, ri, period)}
                        title={cell.formula_text}
                        aria-label={`${row.label}, month ${period + 1}${phaseOf(period) ? `, ${phaseOf(period)}` : ""}: ${money(cell.amount)}. Select for formula.`}
                        onClick={() =>
                          setSelected({ rowLabel: row.label, period, phase: phaseOf(period), cell })
                        }
                        className={`w-full h-full px-2 py-1 text-right hover:bg-primary/15 transition-colors ${
                          selected?.rowLabel === row.label && selected?.period === period
                            ? "bg-primary/25"
                            : ""
                        } ${cell.amount < 0 ? "text-destructive" : ""}`}
                      >
                        {money(cell.amount)}
                      </button>
                    ) : (
                      <span className="px-2 py-1 inline-block text-muted-foreground/40">·</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {selected && (
        <Card className="mt-3 p-4 border-primary/40">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Cell provenance
              </div>
              <div className="text-sm font-medium mt-1">
                {selected.rowLabel} · month {selected.period + 1}
                {selected.phase ? ` (${selected.phase})` : ""}
              </div>
            </div>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setSelected(null)}
            >
              Dismiss
            </button>
          </div>
          <div className="num text-xl mt-2">{selected.cell ? money(selected.cell.amount) : ""}</div>
          <blockquote className="text-xs text-muted-foreground border-l-2 border-primary pl-3 mt-2 whitespace-pre-wrap">
            {selected.cell?.formula_text}
          </blockquote>
        </Card>
      )}
    </section>
  );
}
