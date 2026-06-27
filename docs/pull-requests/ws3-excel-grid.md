# WS3: Excel-grade UI + flexible sensitivity

Branch: `feat/ws3-excel-grid`. STACKS ON WS1: it is based on `feat/ws1-monthly-schedule`
(not main) because 3A renders WS1's monthly spine. Merge after WS1. 3B is independent of WS1.

## Why

Underwriters trust Excel for two things this engine lacked a UI for: (1) clicking any cell to see
how a number was derived, and (2) flexing any assumption to see what moves. WS3 delivers both while
keeping the trust guarantees: render like Excel, compute like the typed engine. Every number shown
is a real `runUnderwriting` output; nothing is synthesized, and there are no arbitrary user formulas.

No persistence and NO migration: sensitivity is ephemeral re-runs and the schedule is in-memory on
the engine output, so both features re-run the pure engine on demand.

## Architecture: one server fn, compute client-side

New server fn `getEngineInput({ project_id })` (underwriting.functions.ts) returns the assembled
`UnderwritingInput` or `{ blocked, missing, conflicting }` (reusing `loadEngineInput`, fail-closed,
RLS-scoped via the user client; it only exposes the user's own approved inputs and never persists).
The new UI runs the PURE engine client-side over that input -- a tornado/grid is ~16-100
`runUnderwriting` calls (sub-100ms), fully deterministic, no per-cell round-trips. The engine is pure
TS with no server-only imports, so it is safe in the client bundle.

## 3A. Spreadsheet-grid transparency view

- `src/lib/engine/schedule-grid.ts` (pure): `buildScheduleGrid(schedule)` turns
  `EngineOutput.schedule` into periods-across-columns, line-items-down-rows, grouped into
  construction / lease-up / hold phases, in a canonical line order. Each cell carries the node's
  amount and `formula_text`.
- `src/components/schedule-grid.tsx`: a scrollable `.data-grid` (periods as columns); the component
  re-runs `runUnderwriting({ ...input, monthlyModel: true })` (a byte-identical roll-up when no
  precision feature is set, so it renders for any ready deal). Clicking any cell opens a provenance
  panel showing that node's `formula_text` -- the audit-any-number experience, with no user formulas.

## 3B. Flexible sensitivity

- `src/lib/engine/sensitivity.ts` (pure): `SENSITIVITY_VARS` (flexable drivers, each with
  read/set to an absolute value: interest rate, exit cap, expense ratio, stabilized occupancy [shifts
  component occupancies by the same delta], rent growth, disposition costs, loan amount, hold years,
  plus rent-level and cost-level index drivers), `SENSITIVITY_METRICS` (IRR, equity multiple, DSCR,
  profit on cost, yield on cost, development profit, debt yield, cash-on-cash). Functions:
  `runPoint`, `tornado` (each driver +/- a step, sorted by swing), `breakeven` (bisection root or
  null when the bounds do not bracket a sign change -- a missing breakeven is never faked), `grid2d`
  (2-variable matrix), `linspace`. Every value is a real engine re-run.
- `src/components/sensitivity-panel.tsx`: a metric selector; a hand-rolled tornado (no chart lib, so
  no rendered number escapes the engine); a breakeven readout; a 2-variable scenario grid heatmap.
  All recomputed with `useMemo` over the base input.

## Wiring

`src/components/analysis-panel.tsx` loads `getEngineInput` (queryOptions + useSuspenseQuery) and
renders `<SensitivityPanel>` + `<ScheduleGrid>` (guarded on `!engineInput.blocked`) before the
existing Pro Forma section. The placeholder "Sensitivity" summary card was relabeled "Stress
worst-case" to disambiguate it from the new full sensitivity section. `src/lib/engine/index.ts`
re-exports the new symbols.

## Tests (`npm run test`: 25 files, 218 passing; +11 new)

- `sensitivity.test.ts`: hand-checked breakeven (development-profit breakeven on exit cap equals the
  going-in yield on cost), tornado sorted by swing with an irrelevant driver (interest rate) showing
  ~0 swing on profit and sorting last, tornado/grid endpoints equal direct `runUnderwriting` re-runs
  (proving "every cell is a real run"), an unreachable target returns null, `linspace` spacing, and a
  provenance assertion that tornado endpoints are exactly engine outputs.
- `schedule-grid.test.ts`: the data contract from `runUnderwriting(monthlyModel)` -- month count,
  rows present and ordered (a draw before NOI), every populated cell carries a `formula_text`, phase
  boundaries, and that a deal without monthly mode has no schedule.

## Verification

- `npm run typecheck` 0; `npm run test` all green incl. new; `npm run build` green. No migration ->
  types.ts untouched, no drift.
- Browser (local Supabase, Maple Heights): the Analysis tab renders the tornado (sorted widest-first,
  zero-swing bars for drivers that do not enter the metric, base line marked), the breakeven solver
  (e.g. Exit Cap Rate = 1.11% for development profit = $0), the 2-variable scenario grid (monotonic
  real re-run cells), and the monthly schedule grid; clicking a grid cell shows its formula (e.g.
  "Hard cost draw month 1 = 148,000,000 x draw increment (straight_line) = 8,222,222"). No console
  errors.

## Definition of done

typecheck 0; tests green incl. new; build green; no migration / no drift; no em dashes; no new
`as any`; golden fixtures untouched; sensitivity cells are real engine re-runs (provenance-clean).
