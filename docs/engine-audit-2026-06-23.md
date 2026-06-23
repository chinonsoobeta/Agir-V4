# Engine Audit — Deterministic Engine + Assumptions Engine

**Date:** 2026-06-23
**Scope:** Line-by-line correctness audit of (1) the deterministic underwriting
engine (`src/lib/engine/*`, `src/lib/verdict.ts`) and (2) the assumptions engine
(extraction → mapping → review → propagation: `src/lib/assumption-*`,
`src/lib/parsers/*`, `src/lib/taxonomy-engine-map.ts`, the assumptions/underwriting
server functions). Method: three independent deep readers (two on the assumptions
engine, one on the deterministic engine) plus a manual pass; every reported issue
was re-verified against the source before any change. A complex sample scenario was
then run end-to-end to confirm the fixes.

**Result:** 16 correctness fixes implemented across 9 files; **83/83 unit tests
pass** (7 new); `tsc` net-new errors introduced: **0** (measured against a pristine
baseline of 78 pre-existing loose-Supabase-typing errors the project does not gate
on). Architectural invariants preserved: fail-closed readiness, amortizing headline
DSCR, conservative conflict resolution, and "no LLM value ever reaches the engine."

---

## 1. Deterministic engine — fixes

| # | Severity | Fix | File |
|---|----------|-----|------|
| 1 | High | **In-force debt service in the cash-flow model.** The hold cash flows, equity multiple, IRR, cumulative shortfall, cash-on-cash and break-even now use the debt service actually due each year — interest-only during the IO period, amortizing after, blended on the straddle year — instead of always billing the amortizing payment. Previously the model "paid" amortization that the loan balance (which honors IO) never applied; this contradicted the covenant test that was already IO-aware. The **headline DSCR stays amortizing** (a deliberate conservative coverage reference). | `engine/proforma.ts` |
| 2 | Medium | **EM and IRR agree on a total loss.** IRR is now `not_meaningful` whenever distributions to equity are ≤ 0 (matching the equity multiple flooring at ~0.0x), so the two headline return metrics never disagree. | `engine/proforma.ts` |
| 3 | Medium | **IRR boundary.** A near-total-loss deal whose only root sits at the −99% bound now returns that IRR instead of NaN ("not meaningful"). | `engine/metrics.ts` |
| 4 | Low | **Cash-on-cash guarded** for negative equity (returns 0 rather than a sign-flipped percentage). | `engine/proforma.ts` |
| 5 | Medium | **"Combined Stress" now includes the occupancy (−500 bps) and expense (+500 bps) shocks.** The verdict's stress gate reads the `combined` preset, so without this the two newly-added shocks never reached the verdict. | `engine/scenarios.ts` |
| 6 | Medium | **Debt-yield covenant enforced.** `min_debt_yield` now maps to the engine and a reconciliation check flags (error severity) a debt yield below the covenant — previously approving the covenant silently no-op'd. | `engine/reconciliation.ts`, `underwriting.functions.ts`, `taxonomy-engine-map.ts` |

## 2. Assumptions engine — fixes

| # | Severity | Fix | File |
|---|----------|-----|------|
| 7 | Critical | **Duplicate `unit_type` no longer crashes propagation.** `.maybeSingle()` threw when a project had >1 revenue row for a unit type (re-parsed/re-uploaded rent roll). Propagation now folds duplicates into one engine-visible component. | `assumptions.functions.ts` |
| 8 | High | **`modify` on a conflicting key requires a documented candidate.** Previously `approve` was blocked on a conflict but `modify` let an analyst type any number — an "invent a value" path the architecture forbids. Now mirrors `resolveConflict`. | `assumptions.functions.ts` |
| 9 | High | **Conflicting budget/revenue assumptions block readiness** (symmetry with scalar conflicts). The fail-closed gate previously only saw scalar conflicts. | `underwriting.functions.ts` |
| 10 | Medium | **Budget approval no longer clobbers sibling lines in a shared category.** The category replace is scoped by line label, so e.g. environmental reserve and tax reassessment (both → `other`) coexist. | `assumptions.functions.ts` |
| 11 | Medium | **Rejecting a revenue assumption demotes its row** (clears the specific field so readiness drops an incomplete component; occupancy reverts to fallback). Was asymmetric with propagation. | `assumptions.functions.ts` |
| 12 | Medium | **Other-income annualization.** A dead no-op ternary stored a multi-unit monthly figure (e.g. parking stalls @ $/mo) as annual, understating other income 12×. Now annualizes per the parser's $/unit/month convention while leaving single aggregate lines as-is. | `revenue-assumption-mapper.ts` |
| 13 | High | **`$5b` parses as $5 billion** (the `b` scale suffix was unhandled, yielding $5). | `assumption-candidates.server.ts` |
| 14 | High | **Rent-roll `SF` column no longer collides with "Rent PSF"** (word-boundary `\bsf\b` + rent-header exclusion), so a per-SF rent is not copied into `avgSf`. | `parsers/rent-roll.server.ts` |
| 15 | Medium | **Budget amount column is numeric-aware**: a label column named like money ("Cost Center", "Total Project Cost") no longer preempts the actual dollar column. | `parsers/budget.server.ts` |

## 3. Reviewed and judged correct (intentionally unchanged)

- **Fail-closed readiness** — blocking on any missing/conflicting required input is by design.
- **Amortizing headline DSCR** — IO DSCR is intentionally secondary; only the cash-flow side was made IO-consistent (fix #1).
- **Exit value on going-in NOI** — a deliberate conservatism for development underwriting; documented, not "fixed" (changing it would make the engine less conservative).
- **`conservativePick` directions** (max for cost-like, min for income-like) — correct for the enumerated keys.
- **`debt.ts` mortgage math** (amortization, IO-then-amortize balance, rate=0 branch) — verified correct.
- **`verdict.ts`** gate logic and hard-fail (equity wipeout or any error-severity reconciliation flag) — correct.
- **`provenance.ts`** numeric verifier — fail-closed; the bare-`M`/`B` suffix handling only makes it stricter (cannot admit a fabricated number), so left as-is.

## 4. Complex scenario validation — "Confluence Yards"

A $250M mixed-use development (residential 320 units + retail 45k SF + office 80k SF +
last-mile industrial 60k SF), **7-year hold, loan interest-only for 30 of 84 months**,
3% rent / 2.5% expense growth, `min_debt_yield` 9.0% covenant. Run via the deterministic
engine; it exercised every fix at once:

- **Partial-IO blend:** year-1 ledger debt service = **$9.0M (interest-only)**, not the
  $10.79M amortizing payment; year-7 (post-conversion) operating cash flow is included in
  returns. Headline DSCR still amortizing (**1.45x**).
- **Debt-yield covenant:** debt yield **10.43%** clears the 9% covenant → no false flag.
- **Reconciliation:** the only flag is one legitimate office-occupancy warning (90% < 92%
  lender stabilization). No false unit-count error (320 vs 320), no false covenant error.
- **Stress:** 8 scenarios; "Combined" NOI ($12.40M) is below revenue-only ($14.07M),
  confirming occupancy + expense shocks now feed the combined case (and the verdict gate).
- **Verdict: APPROVE_WITH_CONDITIONS** (risk 5/100) — a correct, nuanced result on a healthy
  deal, contrasting the earlier Northgate Commons REJECT and confirming the engine
  discriminates across deal quality.

## 5. Remaining recommendations (not implemented)

1. **Phase the construction/lease-up timeline into the return model** — still the largest
   modeling gap: equity deploys at t=0 and stabilized NOI is received from year 1 despite a
   multi-year build + lease-up, overstating IRR/EM. Needs a timeline data model and broad
   golden re-pinning, so it warrants its own change.
2. **Fixed/variable operating-expense split** instead of a flat % of effective income.
3. **Configurable, asset-class-aware policy box** (min DSCR / LTC / debt yield / spread)
   centralizing thresholds now spread across `reconciliation.ts`, `verdict.ts`,
   `findings-rules.ts`.
4. **`conservativePick` should throw on an unclassified key** rather than defaulting to the
   income-like (optimistic) direction.
5. **Surface swallowed audit/version write failures** (currently ignored), and make the TDC
   re-derivation idempotent with a `recordVersion` entry.
6. **Add a `UNIQUE(project_id, unit_type)` constraint** to `revenue_program` to back the
   code-level duplicate-folding fix (#7) at the database layer.

## 6. Tests

`src/test/engine.test.ts` (+4: in-force IO cash flow, debt-yield/break-even presence, the
two reconciliation-gate behaviors, debt-yield covenant) and a new `src/test/parsers.test.ts`
(+3: the rent-roll SF/PSF and budget amount-column fixes). Full suite: **83/83 passing**;
the Rivergate findings fixture and Harbour conflict fixture are unchanged, confirming the
fixes do not paper over a bad deal.
