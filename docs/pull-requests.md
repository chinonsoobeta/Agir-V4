# Pull request descriptions

Ready-to-paste descriptions for the three workstream PRs. Each branch is green on
every gate (typecheck 0 errors, all tests pass, build, types in sync with
migrations, no em dashes, no new cross-tenant access, golden fixtures preserved).

Branches:
- WS1 `feat/ic-grade-financial-modeling`
- WS2 `feat/extraction-robustness`
- WS3 `feat/operating-layer-depth`

---

## WS1 - IC-grade financial modeling (engine)

### Summary
Moves the deterministic engine from screening-grade to IC-grade so an underwriter
can bring LP-facing numbers, not just deal-level ones. Every change is additive
and OFF by default: a deal with none of the new inputs produces output that is
byte-identical to today. The golden fixtures (Maple Heights, Harbour Centre,
Summit Point / Rivergate / Northgate) are preserved and the numeric-provenance
verifier stays green. All math is pure and lives in `src/lib/engine`.

### 1A. Equity draw timing (`src/lib/engine/equity-timing.ts`)
The single t=0 equity outflow becomes a timed contribution vector feeding the
IRR. The default stays a lump sum at t=0, which is the conservative convention
(committing capital earliest maximizes exposure time and yields the lowest
levered IRR). A positive `equity_draw_months` draws equity straight-line over the
build, deferring part of the outflow. The equity multiple is a money multiple and
stays timing-free; the cash-flow ledger is unchanged.

### 1B. Multi-tranche debt (`src/lib/engine/tranches.ts`)
Generalizes the capital stack to an ordered senior + mezzanine list. Total debt,
the computed interest reserve, annual debt service, loan payoff at exit, LTC, and
the equity requirement (TDC - total debt) all sum across tranches. The engine
reports both a senior DSCR (headline, unchanged) and an all-in DSCR. A
senior-only deal reproduces today's single-loan math exactly.

### 1C. LP/GP distribution waterfall and promote (`src/lib/engine/waterfall.ts`) - headline
A deterministic European (back-end) waterfall over the levered equity cash flows:
return of capital + preferred return (pari-passu by capital), optional GP
catch-up, then a promoted carry split across one or two return hurdles. Each
hurdle is an accreting balance (contributed capital grown at the hurdle rate);
distributions retire the lowest balance first, then flow into the carry tiers. It
is fully hand-computable (see tests). New persisted outputs, each with a readable
`formula_text`: `lp_irr`, `lp_equity_multiple`, `lp_preferred_return`, `gp_irr`,
`gp_equity_multiple`, `gp_promote`, plus `total_debt`, `total_debt_service`,
`senior_dscr`, `all_in_dscr`. The existing deal-level levered IRR / equity
multiple are unchanged. With no promote configured the waterfall is inactive, the
LP holds 100% of the deal, LP returns equal the deal returns, and the promote is
zero. `gp_promote` is defined as GP distributions in excess of a pari-passu split
by ownership, so it isolates the carried interest and is zero for a non-promoted
deal.

### 1D. Lease-up absorption curve (`src/lib/engine/lease-up.ts`, opt-in)
The base engine books no operating income during construction + lease-up and
switches on the full stabilized cash flow only at stabilization (conservative).
When `lease_up_curve` is enabled, an opt-in `lease_up_adjusted_irr` credits the
partial income earned during lease-up via a linear 0 -> stabilized absorption
ramp. It never changes the base outputs: with the flag off (every golden fixture)
it equals the deal IRR exactly and emits no extra metric. (A cash-out refinance
scenario was scoped but deferred from this PR to keep the change tightly bounded.)

### UX
"LP return vs deal return" is surfaced in three places, each rendered only when a
promote is configured so non-waterfall deals are visually unchanged: the
underwriting panel ("Capital Structure & LP/GP Returns"), the IC memo, and the
reports ("LP / GP Returns" in the shared memo-report model).

### New assumption keys (taxonomy -> engine), defaults, units

| Taxonomy key | Engine key | Unit | Default (absent) |
| --- | --- | --- | --- |
| `equity_draw_months` | `equity_draw_months` | months | 0 = single lump sum at t=0 (conservative) |
| `mezz_debt_amount` | `mezz_loan_amount` | $ | none (senior-only) |
| `mezz_interest_rate` | `mezz_interest_rate_pct` | % | 0 (used only if mezz amount > 0) |
| `mezz_amortization_years` | `mezz_amort_years` | years | 0 (interest-only) |
| `mezz_io_months` | `mezz_io_months` | months | 0 |
| `lp_equity_pct` | `lp_equity_pct` | % | 100 (LP holds the whole deal) |
| `gp_equity_pct` | `gp_equity_pct` | % | 0 |
| `preferred_return_pct` | `preferred_return_pct` | % | 0 |
| `gp_catch_up_pct` | `gp_catch_up_pct` | % | 0 (no catch-up) |
| `promote_tier1_hurdle_pct` | `promote_tier1_hurdle_pct` | % | none = open (top) tier |
| `promote_tier1_gp_pct` | `promote_tier1_gp_pct` | % | none = no tier 1 |
| `promote_tier2_hurdle_pct` | `promote_tier2_hurdle_pct` | % | none |
| `promote_tier2_gp_pct` | `promote_tier2_gp_pct` | % | none = no tier 2 |
| `lease_up_curve` | `lease_up_curve` | flag (count) | off |

Conflict policy: `mezz_interest_rate_pct` resolves conservative-high,
`mezz_loan_amount` conservative-low (matching the senior loan).

### Schema
None. New inputs persist as rows in `underwriting_inputs` / `assumptions`; new
outputs in `financial_outputs`. All existing key-value tables, so `types.ts` is
unchanged.

### Tests (`src/test/ic-grade-modeling.test.ts`)
Backward-compatibility byte-identity; a mezzanine tranche raises total debt
service and lowers required equity (senior DSCR unchanged, all-in DSCR lower); an
8% preferred return + 80/20 promote splits a known vector into hand-computed
LP/GP IRRs; GP catch-up reaches the carry share; return ordering (GP IRR > deal
IRR > LP IRR with GP co-invest); a straight-line equity draw raises IRR with the
ledger unchanged; the lease-up curve raises IRR only when on; and LP/GP figures
pass numeric provenance in a rendered memo report.

---

## WS2 - Extraction robustness

### Summary
Makes extraction trustworthy on messy real-world documents. Extraction stays
deterministic: the new code recovers more structure (the right sheet, merged
ranges, OCR text), but the existing regex candidate extractor and deterministic
alias mapper still produce every value. No invented numbers. No schema change.

### 2A. OCR fallback for scanned / image-only PDFs
`pdfBufferToTextWithMeta` reads the embedded text layer first; when it is empty or
near-empty it runs OCR and uses the recovered text, recording `recovered_via_ocr`
plus a confidence so the UI can warn "verify." tesseract.js and a canvas raster
backend are OPTIONAL runtime dependencies loaded through a dynamic import the
bundler does not statically resolve, so the production build never fails when they
are absent (the runner degrades to no-text). The OCR boundary is injectable, so
tests exercise empty-layer -> OCR -> candidates without the heavy dependencies.

### 2B. Multi-sheet workbooks (`src/lib/parsers/xlsx-utils.ts` + parsers)
The typed parsers no longer assume `SheetNames[0]`: `selectSheets` scores every
sheet by header heuristics and picks the budget tab (single best) or every
rent-roll tab (residential + commercial schedules are merged). `findHeaderRow`
skips a merged title banner above the real header. Falls back to the first sheet,
so a single-sheet workbook is unchanged.

### 2C. Merged cells
`fillMergedCells` propagates a merged range's anchor value into every spanned cell
so a merged label/amount is not dropped and column indices stay stable. Applied in
both typed parsers and the free-text path. A merged "$ in thousands" title banner
still sets the scale.

### 2D. Extraction transparency
The per-document debug trace now carries `recovered_via_ocr`, `ocr_confidence`,
`needs_verification`, the sheet(s) selected, merged-cell count, and each
candidate's source location. The review UI shows a "verify before approving"
banner for OCR-recovered documents, a Recovery column, and value-at-source
previews, so auto-extraction reads as a checkable first pass, not gospel.

### Tests
Multi-sheet selection, merged-cell propagation (typed parsers + free-text), the
OCR fallback path (mocked boundary) and graceful degradation, and a non-PDF never
invoking the OCR runner. The Harbour / Rivergate / Summit Point extraction suites
stay green.

---

## WS3 - Operating-layer depth

### Summary
Makes execution, IC, and integrations usable for a team running many concurrent
deals. One additive migration (`20260625000100_operating_layer_depth.sql`) adds
the schema; `types.ts` is regenerated to match (the CI schema-drift gate passes).
Every new table uses the hardened owner + workspace-member RLS pattern with proper
WITH CHECK, so there is no cross-tenant path. The deterministic engine and its
verdict are never touched: this layer is governance and workflow around the deal.

### 3A. Execution critical path (`src/lib/execution/critical-path.ts`)
`deal_milestones` gains a `depends_on UUID[]` (predecessors). A pure
longest-path-by-date engine computes the critical path, the projected close date,
and exactly which open / overdue items threaten the target close (with slack
days), plus dependency-cycle detection. `execution.tsx` surfaces the per-deal
blocking chain, worst slack first.

### 3B. IC voting + conditions (`src/lib/committee/voting.ts`)
New `ic_votes` (one decisive vote per member; a later vote replaces the earlier
one) and `ic_conditions` (open -> satisfied / waived, tracked to close). Pure
tally (quorum, approval threshold, optional reject-blocks) and a condition state
machine that throws on illegal transitions. `committee-panel.tsx` adds a votes
tally and a condition tracker. The deterministic engine verdict and the audit
trail are intact: votes and conditions are governance layered on top.

### 3C. Integrations connector (`src/lib/integrations/connector.ts`)
A pure connector abstraction with a LIVE CSV reference connector (parse/format
with an explicit field mapping, RFC-4180 quoting) and a registry that marks
Salesforce / DealCloud / generic HTTP as PLANNED (no fake "connected" states).
Server functions import/export deals, record `integration_sync_runs`, and link
external records idempotently via `external_record_links`. `integrations.tsx`
shows honest live/planned status and a CSV import/export panel.

### Server functions
`src/lib/operating-layer.functions.ts` - every function attaches
`requireSupabaseAuth`, validates input with zod, and queries through the
user-scoped client so RLS is the only authority on access.

### Schema + RLS
Migration `20260625000100_operating_layer_depth.sql`: `deal_milestones.depends_on`
column; `ic_votes`, `ic_conditions`, `external_record_links` tables. Each new table
follows the owner-OR-member USING / owner-AND-member WITH CHECK pattern modeled on
the hardened workspace isolation migration. `types.ts` was regenerated with
`supabase gen types` and verified idempotent against the migrations.

### Tests (`src/test/operating-layer.test.ts`)
Critical-path order / projected close / blocking slack / cycle detection; vote
tally outcomes (majority, conditional, no-quorum, tie, reject-blocks) and
latest-vote dedupe; condition transitions (legal + illegal) and clear-to-close;
the CSV import/export round-trip with field mapping and error reporting; and a
two-tenant simulation of the RLS predicate (`src/lib/workspace-access.ts`) proving
owner + workspace isolation. The test job has no database, so RLS is verified by
simulating the policy predicate rather than against live Postgres.
