# Deterministic Engine Review — "Northgate Commons" Sample Scenario

**Date:** 2026-06-22
**Scope:** End-to-end exercise of Agir's deterministic underwriting engine on a fresh
development deal, root-cause analysis of where the engine fell short, and the changes made
in response.
**Run mode:** `Analysis → Engine (deterministic)` — `runFullUnderwriting({ mode: "deterministic" })`.
No LLM participated in any number below.

---

## 1. Executive summary

I created a realistic development scenario ("Northgate Commons" — a 220-unit multifamily +
ground-floor retail build, 5-year hold, interest-only construction-to-perm loan, modest
rent/expense growth), seeded it into Agir exactly the way the product's own golden fixtures
are seeded, and ran the full deterministic deal analysis.

The engine correctly identified the deal as sub-institutional. **But it reached that
conclusion partly for the wrong reasons.** Two reconciliation checks emitted *false* error
flags, and because an error-severity reconciliation flag is an automatic hard-fail
(`verdict.ts`), the deal was flagged **RETURN TO UNDERWRITING / CRITICAL (risk 90/100)** on
the back of two bugs rather than its real economics. Separately, the equity multiple and IRR
silently dropped a full year of cash flow, and the two metrics a lender actually sizes on —
**debt yield** and **break-even occupancy** — were not reported at all.

| | Before | After fixes |
|---|---|---|
| Reconciliation **error** flags | 2 (both false positives) | **0** (only 4 legitimate occupancy warnings) |
| Verdict | RETURN TO UNDERWRITING — **hard-fail** | REJECT — honest, 5/5 gates fail on merits |
| Risk score | **90 / 100 (CRITICAL)** | **65 / 100** |
| Equity multiple | 1.32x | **1.37x** (restored dropped year-5 cash flow) |
| Levered IRR | 5.99% | **6.72%** |
| Debt yield | *not computed* | **8.31%** (new first-class metric) |
| Break-even occupancy | *not computed* | **83.05%** (new first-class metric) |
| Stress scenarios | 5 | **7** (added occupancy & expense shocks) |

All 78 unit tests pass after the changes (the golden Maple Heights equity multiple was
re-pinned from 1.07 → 1.08 to reflect the corrected cash-flow treatment).

---

## 2. The sample scenario — Northgate Commons

A secondary-market development with the kind of structure (multi-year build + lease-up,
interest-only loan, multiple unit types, thin-but-positive spread) that real deals have and
that the existing golden fixtures (Maple Heights, 1-year hold; Rivergate, no IO-for-hold) did
not stress.

**Budget (TDC $91.5M):** Land $11.0M · Hard $62.0M · Soft $9.5M · Contingency $3.5M ·
Financing interest $5.5M.

**Revenue program (220 units + retail):** 1BR 120 @ $2,500/mo · 2BR 80 @ $3,250/mo ·
3BR 20 @ $4,200/mo · Retail 12,000 SF @ $34/SF (all residential @ 94% occ, retail @ 90%).

**Key assumptions:** expense ratio 34% · other income $240k · exit cap 5.25% · loan
$62.5M @ 6.25% · **30-yr amort but interest-only for 60 months (the entire 5-yr hold)** ·
hold 5 yr · rent growth 3.0% · expense growth 2.5% · selling costs 1.5% · min DSCR covenant
1.20x · lender stabilization 95% · stated unit count 220.

Every input was seeded as `approved` so the fail-closed readiness gate passed and the engine
ran end-to-end.

---

## 3. What the engine produced (base case, before fixes)

NOI **$5,195,203** · TDC $91.5M · yield-on-cost 5.68% · exit value $98.96M · amortizing ADS
$4,617,879 · **DSCR (amortizing) 1.13x** · IO DSCR 1.33x · **equity multiple 1.32x** ·
**IRR 5.99%** · profit on cost 8.15% · development spread 42.78 bps · LTC 68.3% ·
**risk score 90/100** · verdict **RETURN TO UNDERWRITING (hard-fail)**.

Reconciliation flags emitted:

- `error · covenant_feasibility` — "Debt unsupportable: covenant requires NOI 5,541,455
  (1.20x × ADS 4,617,879) vs engine NOI 5,195,203."
- `error · unit_count_consistency` — "Documents disagree on unit count: 120 vs 80 vs 20 vs 220."
- `warning · occupancy_vs_lender` × 4 (legitimate).

---

## 4. Findings — where the engine fell short and why

### Finding 1 — `unit_count_consistency` false-fails every multi-unit-type building *(critical)*

**What happened.** The engine reported "Documents disagree on unit count: 120 vs 80 vs 20 vs
220" — an error-severity flag — for a building whose unit types are *defined* as 120 + 80 +
20 = 220.

**Why.** `buildReconciliationContext` fed the per-**unit-type** counts to the check as if each
were a competing building **total**: `unitCounts: [...perUnitCounts, statedUnits]` →
`[120, 80, 20, 220]`. The check (`reconciliation.ts`, check 6) then flagged the four distinct
values as a disagreement. The check's *intent* (per its own comment, "220 must stay 220") is
to catch documents that state *different building totals*; the implementation conflated a
unit-type breakdown with a document-level total. This misfires for essentially every real
multifamily deal (the 1-year golden Maple Heights fixture would trip it too — 60 vs 50 vs 10 —
but Maple is never run through reconciliation in tests).

**Impact.** A spurious error flag (+15 risk) and, because any error flag is a hard-fail, an
automatic RETURN TO UNDERWRITING — independent of the deal's economics.

### Finding 2 — Covenant feasibility tests an interest-only loan against an amortizing payment *(critical)*

**What happened.** The engine emitted `error · covenant_feasibility` claiming the debt is
"unsupportable" because NOI ($5.20M) < 1.20× **amortizing** ADS ($4.62M) = $5.54M. But the
loan is interest-only for the full 5-year hold (`io_months = 60`). The payment actually due
during the hold is the IO payment ($3.91M); on that basis the covenant requires only
1.20 × $3.91M = $4.69M, which NOI clears comfortably (IO DSCR 1.33x).

**Why.** `reconciliation.ts` check 3 used `amortizingAnnualDebtService` unconditionally. The
loan-balance math elsewhere already honors the IO period (`debt.ts`), so the model was
internally inconsistent: it amortizes the *balance* like an IO loan but tests the *covenant*
like a fully-amortizing one.

**Impact.** A second false error flag (+15 risk) and a second hard-fail driver. The headline
"Refinance Risk / Weak Debt Coverage" framing was overstated for a loan that is not amortizing
during the hold.

### Finding 3 — Equity multiple and IRR drop the sale-year operating cash flow *(high)*

**What happened.** Equity multiple was 1.32x and IRR 5.99%. The return calculation summed
operating cash flows for years 1…N-1 and then used **only net sale proceeds** for the exit
year — discarding year N's operating levered cash flow (~$1.29M here, a real distribution to
equity).

**Why.** In `proforma.ts`, `interimLevered = holdLevered.slice(0, exitYear - 1)` and
`finalEquityFlow = saleProceedsToEquity`. The exit-year element of `holdLevered` was never
added to either the equity-multiple numerator or the IRR cash-flow vector. On the 1-year
Maple Heights fixture this dropped the *entire* operating year (which is why the golden EM was
pinned at the slightly-low 1.07x).

**Impact.** Systematic understatement of levered returns by one full year of operating cash
flow on every deal.

### Finding 4 — Debt yield is not a first-class metric *(high)*

**What happened.** Debt yield (NOI / loan) — the primary metric lenders size construction
takeouts on — appeared nowhere in the engine's metric set, the persisted `financial_outputs`,
the headline cards, the risk register, or the risk score. (It existed only as a low-severity
"observation" buried in the findings layer.) Northgate's debt yield is **8.31%** — thin for
this profile — and nothing surfaced it.

**Why.** It was simply never added to `proforma.ts` outputs or `reconciliation.ts` scoring.

### Finding 5 — Break-even occupancy is not computed *(high)*

**What happened.** The occupancy at which the deal stops carrying its debt — the single most
important downside metric for a lease-up-heavy development — was not computed anywhere.

**Why.** Never implemented.

### Finding 6 — The stress suite cannot shock occupancy or operating expenses *(medium)*

**What happened.** The five presets shock cap rate, cost, rate, and rent. For a deal whose
dominant risks are lease-up/occupancy slippage and expense inflation, the suite was blind to
both. `revenue_down` cuts rent but never touches occupancy; nothing touches the expense ratio.

**Why.** `StressPreset` / `applyStress` (`scenarios.ts`) had no occupancy or expense-ratio
levers.

### Finding 7 — The cash-flow ledger and exit valuation are thin / inconsistent *(recommendation only — see §6)*

The persisted cash-flow ledger emits only year 0, year 1, and the exit year, so the
multi-year hold is uninspectable; and the engine grows operating NOI across the hold but
capitalizes the exit on *going-in* NOI. The exit-on-going-in choice is defensibly conservative
for development underwriting, so it is documented as a recommendation rather than "fixed"
(changing it would make the engine less conservative and would rescue the intentionally-failing
Rivergate fixture).

---

## 5. Changes implemented

All changes preserve the architecture's central rule — the engine reads only typed, approved
inputs and no LLM ever supplies a number.

| # | Finding | Change | Files |
|---|---|---|---|
| F1 | 3 | Include the sale-year operating cash flow in the equity multiple **and** the IRR vector; also emit it as a `levered_cf` ledger row in the exit year. | `engine/proforma.ts` |
| F2 | 1 | Cross-check the **summed** building unit total (Σ per-type counts) against any document-stated total, instead of treating each unit type as a competing total. | `underwriting.functions.ts` |
| F3 | 2 | Covenant feasibility is tested against the debt service **actually in force during the hold** — the interest-only payment when the loan is IO for the entire hold, the amortizing constant otherwise. | `engine/reconciliation.ts`, `underwriting.functions.ts` |
| F4 | 4 | New first-class **Debt Yield** metric (NOI / loan), plus a deterministic risk-register entry and risk-score contribution when thin. | `engine/proforma.ts`, `engine/reconciliation.ts`, `engine/types.ts` |
| F5 | 5 | New first-class **Break-even Occupancy** metric, plus a risk-register entry / risk-score contribution when the cushion is thin. | `engine/proforma.ts`, `engine/reconciliation.ts`, `engine/types.ts` |
| F6 | 6 | Two new stress presets — **Occupancy Downside (−500 bps)** and **Expense Inflation (+500 bps ratio)** — with matching `applyStress` levers and UI/driver labels. | `engine/scenarios.ts`, `components/underwriting-panel.tsx`, `findings/modules/scenarios.ts` |
| UI | 4,5 | Surface Debt Yield and Break-even Occupancy as headline cards on the Analysis tab. | `components/underwriting-panel.tsx` |

**Tests.** `src/test/engine.test.ts` was updated (golden Maple EM 1.07 → 1.08 with an
explanatory comment; preset list 5 → 7) and extended with three new tests: debt-yield /
break-even presence, the unit-count "sum vs stated total" behavior, and the IO-vs-amortizing
covenant basis. Full suite: **78/78 passing**, including the intentionally-catastrophic
Rivergate findings fixture (unchanged — confirming the fixes don't paper over a bad deal).

**Net effect on Northgate (deterministic re-run).** Both false error flags gone; verdict is
now an honest REJECT (no hard-fail); risk score 90 → 65; equity multiple 1.32x → 1.37x;
IRR 5.99% → 6.72%; debt yield (8.31%) and break-even occupancy (83.05%) now reported; stress
matrix now includes occupancy and expense columns. The deal still — correctly — does not
clear an institutional bar (weak amortizing DSCR, thin spread, low profit margin), but it is
now judged on its real economics.

---

## 6. Recommended future work (not implemented)

1. **Phase the development timeline into the return model (highest value).** Equity is
   currently deployed at t=0 and stabilized NOI is received from year 1, even though Northgate
   has 22 months of construction + 14 months of lease-up. This overstates IRR/equity multiple
   for every development deal and hides negative-carry risk. A proper fix introduces an
   explicit construction/lease-up phase before stabilized operations. It was deferred here
   because it needs a timeline data model and a broad re-pinning of golden expectations —
   it should be its own change.
2. **Make the exit valuation/ hold-period growth consistent and explicit.** Either capitalize
   a forward (grown) NOI at exit or state the going-in-NOI exit convention as a deliberate,
   labeled conservatism. (Implemented choice: leave it conservative and document it.)
3. **Split operating expenses into fixed + variable** rather than a flat % of effective
   income, so downside-occupancy scenarios don't understate OpEx.
4. **A configurable, asset-class-aware policy box** (min DSCR, max LTC, min debt yield, min
   spread) instead of constants scattered across `reconciliation.ts`, `verdict.ts`, and
   `findings-rules.ts`.
5. **Emit the full year-by-year cash-flow ledger** (every hold year), not just year 0/1/exit,
   so the multi-year story is inspectable and auditable.

---

## 7. Appendix — reproducing the run

1. Seed the scenario (project `22222222-2222-2222-2222-222222222222`, owner = the
   `maple.heights@example.com` user) with the budget / revenue / underwriting-input rows in
   §2, all `status = 'approved'`.
2. Open the deal → **Analysis** tab → toggle **Engine** → **Run Deterministic Underwriting**.
3. Inspect `financial_outputs`, `reconciliation_flags`, and `risk_register` for the project,
   or read the headline cards / pro-forma table / stress matrix in the Analysis tab.
