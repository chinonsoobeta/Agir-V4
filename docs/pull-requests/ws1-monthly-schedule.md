# WS1 (keystone) - Monthly cash-flow spine

Branch: `feat/ws1-monthly-schedule` (off `main`).

Green on every gate: `npm run typecheck` (0 errors), `npm run test` (207 tests,
all pass), `npm run build`, types in sync with migrations (no migration in this
PR), no em dashes, no new `as any`, no new cross-tenant access. The golden
fixtures (Maple Heights, Harbour Centre, Summit Point, Rivergate, Northgate) are
byte-identical and the numeric-provenance verifier stays green.

## Summary

Adds a typed, period-indexed, deterministic monthly calculation graph (a "spine")
that an underwriter can trust as the model of record, while preserving every trust
guarantee. The annual engine (`proforma.ts`) is untouched and remains the source
of truth for any deal that does not opt in.

The work is strictly ADDITIVE and OPT-IN. A deal that does not set `monthly_model`
returns today's annual output byte-for-byte and carries no `schedule`. When a deal
opts in, the annual figures become a roll-up of the spine and three precision
features unlock, each off by default and each computed from the SAME annual locals
the proforma already derived (passed in via `ScheduleContext`), so the spine can
never drift from the backbone.

We did NOT emulate Excel's arbitrary per-cell formulas (the trust hole). We kept a
closed, typed, auditable calc-DAG: every node is a pure function of approved inputs
and other nodes and carries a readable `formula_text`. The only node that holds an
analyst-authored formula is the sandboxed custom line, whose expression IS its
`formula_text` and which can never mint a value from nothing.

## Architecture: branch, don't fork

`runUnderwriting` builds today's output exactly as before (`baseOutput`). Then:

```
if (!input.monthlyModel) return baseOutput;            // byte-identical, no schedule
return applyMonthlySchedule(input, baseOutput, ctx);   // augment: spine + refined annual + precision metrics
```

All new complexity lives in two new pure modules. New precision fields on
`EngineOutput.values` are optional and set only on the on-path; the on-path builds
a new `values` object while the off-path returns the existing literal untouched,
so the off output is identical even under `toStrictEqual`. New metric rows use the
existing `...(active ? [metric] : [])` conditional pattern, so no extra rows appear
when off.

## New modules

- `src/lib/engine/schedule.ts` - the monthly spine. Period nodes for construction
  draws, construction interest, equity contributions, GPR/EGI/OpEx/NOI (with
  absorption), per-tranche interest/principal/debt-service, the refinance event,
  custom lines, and sale + payoff. Plus `rollUpToAnnual` reconciliation and the
  precision metrics.
- `src/lib/engine/expression.ts` - the sandboxed custom-line evaluator (see below).

## 1A. Construction-draw S-curve with interest on the actual balance

When `monthly_model` is on and `construction_s_curve` is on, construction draws
follow a smoothstep S-curve (slow start, fast middle, slow finish - the standard
construction profile) and interest is computed on the ACTUAL monthly outstanding
balance: the loan ramps with the draw curve during construction and carries the
full balance through lease-up. This replaces the `avgOutstandingFactor` shortcut.
With the S-curve off, the spine mirrors the annual interest reserve exactly
(distributed straight-line) so the roll-up reconciles to the dollar.

Hand-check (in tests): 6,000,000 senior @ 6%, 10-month build + 2-month lease-up,
no mezz. The symmetric S-curve averages 0.5 of the balance over the build months
(= 5 month-equivalents); both lease-up months carry the full balance (= 2).
Interest = 6,000,000 x (0.06 / 12) x (5 + 2) = 210,000.

New output: `scheduleConstructionInterest` (metric `schedule_construction_interest`,
emitted only when the S-curve is on).

## 1B. Real lease-up absorption schedule

When `monthly_model` and `lease_up_curve` are on, the single midpoint-triangle
flow (the existing `lease_up_adjusted_irr` approximation) is replaced by a real
per-period linear absorption ramp: lease-up month k earns `(k + 0.5)/L` of the
stabilized monthly NOI / levered cash flow. Each absorption dollar is discounted at
its true time in the monthly-model IRR, so the result is strictly more accurate
than the single midpoint flow and sits above the conservative full-delay IRR.

## 1C. Refinance event (rate-and-term and/or cash-out)

When a positive `refinance_month` is approved, at that month the senior loan's
outstanding balance is paid off and replaced by a new loan. Cash-out = new loan -
senior balance retired (negative = a paydown funded by equity), flowed to equity at
the refinance month. The new senior debt service applies for the remaining periods
and the exit payoff uses the new loan's balance. Mezzanine is unaffected. New loan
size: an explicit `refinance_amount`, else `refinance_ltv_pct` applied to the value
implied by in-place NOI and exit cap, else a pure rate-and-term takeout at the same
balance with new terms.

New outputs (present only when a refinance is configured): `refiNewLoanAmount`,
`refiCashOut`, `refiNewAnnualDebtService`, `postRefiDscr`.

## Custom line items (sandboxed expression language)

`src/lib/engine/expression.ts` is a pure, deterministic evaluator: numeric
literals, references to node values the engine supplies, `+ - * /`, parentheses,
unary minus, and a `min/max/abs` whitelist. There is NO property access, indexing,
assignment, comparison, function definition, or any host access; the tokenizer
rejects everything else (fail-closed). A reference the engine did not supply throws
rather than resolving to zero, so a custom line can never mint a value. Division by
zero and non-finite results throw. The expression string IS the `formula_text`, and
its literal coefficients are surfaced as derived provenance values, so the rendered
formula stays orphan-free under the numeric-provenance verifier. An invalid or
unsafe expression yields no value and a warning, never a fabricated number.

## Monthly-model IRR and roll-up reconciliation

`scheduleLeveredIrrPct` (metric `schedule_levered_irr`, always emitted when monthly
mode is on) is the IRR of the monthly equity cash-flow vector: timed equity
contributions + per-period lease-up absorption (1B) + stabilized annual levered CF
(refinance-aware, 1C) + refinance cash-out + exit. With every feature off this
vector is identical to the annual IRR vector, so the monthly IRR equals the annual
deal IRR exactly. `schedule.reconciliation` ties the roll-up of the monthly nodes
back to the annual figures (construction draws, construction interest, equity,
year-1 NOI, year-1 debt service) within a documented tolerance
(`max($1, 1e-6 x annual)`).

## New assumption keys (taxonomy -> engine), defaults, units

| Taxonomy key | Engine key | Unit | Default (absent) |
| --- | --- | --- | --- |
| `monthly_model` | `monthly_model` | flag (count) | off = annual path (byte-identical) |
| `construction_s_curve` | `construction_s_curve` | flag (count) | off = straight-line draws |
| `refinance_month` | `refinance_month` | months from t0 | 0 = no refinance |
| `refinance_amount` | `refinance_amount` | $ | none (LTV or rate-and-term sizing) |
| `refinance_ltv_pct` | `refinance_ltv_pct` | % | none |
| `refinance_rate` | `refinance_rate_pct` | % | senior rate (rate-and-term) |
| `refinance_amort_years` | `refinance_amort_years` | years | senior amortization |
| `refinance_io_months` | `refinance_io_months` | months | 0 |

`lease_up_curve` (already in the taxonomy) is reused for 1B; with monthly mode on it
drives the real per-period ramp, and with monthly mode off it keeps its existing
midpoint-triangle behavior (byte-identical). None of the new keys is added to
`REQUIRED_SCALAR_KEYS`, so absence preserves current behavior (fail-closed is
unaffected).

## Schema

None. New outputs persist through the existing `financial_outputs` path
(`underwriting.functions.ts` iterates `output.metrics`); the monthly spine rides on
the optional `EngineOutput.schedule` field and is re-derivable by re-running the
pure engine (the WS3 grid will render it the way `STRESS_PRESETS` re-runs work). So
`src/integrations/supabase/types.ts` is unchanged and there is no schema drift.

Custom-line definitions reach the engine via the optional `customLines` field on
`UnderwritingInput`. The engine capability and its tests ship in this PR; the
authoring UI and the persistence of the expression string (and the wiring of its
literal coefficients into report `derived_values`) are a thin follow-up that needs
no migration.

## Tests

- `src/test/expression.test.ts` (15): arithmetic and precedence, references resolve
  only from the supplied context, `allowedRefs` restriction, fail-closed safety
  (member access / indexing / assignment / comparison / non-whitelisted calls all
  rejected; unknown reference and division by zero throw), determinism, and a
  provenance-clean rendered formula.
- `src/test/monthly-schedule.test.ts` (12): (a) byte-identical off-path and golden
  fixture; (b) roll-up reconciliation and unchanged annual figures with features
  off; (c) hand-computed smoothstep curve, the 210,000 S-curve interest, the linear
  absorption ramp raising the IRR, and the refinance cash-out / resize / DSCR; the
  sandboxed custom line evaluating deterministically and failing closed on an unsafe
  expression; (d) every new metric formula passes numeric provenance with zero
  orphans.

## Out of scope (later PRs)

- WS2 (extraction friction) and WS3 (Excel grid + flexible sensitivity).
- A `monthly_cash_flows` persistence table, only if WS3 shows re-running the engine
  is insufficient for the grid.
