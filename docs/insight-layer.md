# The Deterministic Insight Layer

**Date:** 2026-06-23
**Goal:** Make the engine, the findings engine, and the memo generator behave
"as close to an AI as possible — without being an AI." The calculator stays the
solid, deterministic foundation; a new **Insight Layer** sits on top and adds
context-aware judgment, benchmark reasoning, causal attribution, and
analyst-voice narrative. Every number it emits remains provenance-backed, and an
LLM can later be slotted behind the same interface (wording-only, re-verified).

## Architecture

All of `src/lib/context/`:

| Module | Responsibility |
|---|---|
| `deal-context.ts` | Derive a `DealContext` (asset class & GPR-weighted mix, market tier, deal stage, loan structure) from existing approved inputs — no new analyst inputs. |
| `benchmarks.ts` | Curated CRE knowledge base (asset-class × market-tier norms) + a layered resolver: **curated defaults → firm config overrides → portfolio-derived percentiles**, each tagged with its `source`. |
| `portfolio.ts` | `computePortfolioNorms()` — p25/p50/p75 bands from the firm's own deals (the third norm source). |
| `interpret.ts` | Grade each metric into a contextual band (`strong`/`in_line`/`soft`/`weak`), with a comparative phrase ("~70 bps below the …norm of 9.5%"), a context note, and a salience score. |
| `attribution.ts` | Causal drivers (yield-on-cost vs exit cap) and **what-would-make-it-a-yes** levers (closed-form input changes to clear each gate). |
| `narrative.ts` | Deterministic NLG: thesis, audience-adapted paragraph (IC/lender/investor/internal), and bullets. Varied phrasing via a **stable hash** (no `Math.random`/`Date`). Defines the `InsightProvider` interface + the `deterministic` provider, and the pluggable seam (`getInsightProvider`/`setInsightProvider`). |
| `insight.ts` | `buildInsight()` assembles the bundle and exposes `derivedValues` — every number the prose can contain — so the memo's provenance verifier admits them. |

## How it's wired (one layer, three surfaces)

The underwriting run (`runFullUnderwriting`) builds the insight once and persists
it as a single `financial_outputs` row (`metric_key='insight'`, `scenario_key='base'`)
whose `inputs` JSON holds the thesis, interpretations, levers, per-audience
narratives, and `derivedValues`. Portfolio norms are gathered from the owner's
other deals at run time.

- **Deterministic engine → Analysis tab.** `underwriting-panel.tsx` renders a
  *Deterministic Read · Contextual Analysis* card: context chips, the thesis,
  metric-by-metric contextual interpretation, and the what-if levers.
- **Findings engine → Decision tab.** `buildDecision()` attaches the insight to
  the `DecisionSummary`; `deal-overview.tsx` surfaces the thesis + contextual
  interpretations in the executive summary.
- **Memo engine.** `buildMemoReport()` (IC memo) and `build-executive-summary.ts`
  lead with the thesis + audience narrative and add a *What Would Move the Needle*
  section. `insightFor()` is null-safe (older deals fall back to templated prose),
  and the insight's `derivedValues` are threaded into `reportAllowedValues` so the
  numeric-provenance verifier still passes (verified: 0 orphans).

## One reconciled recommendation

Two lenses independently produce a recommendation: the **gate verdict**
(`computeInvestmentVerdict` — return/stress hurdles + hard-fail) and the
**findings engine** (severity of prioritized findings). They can legitimately
disagree (e.g. a deal that clears every finding but trips a stress gate, as the
Confluence Yards sample does). `reconcileRecommendation()` (in `decision.ts`)
folds them — plus the contextual read — into ONE recommendation:

- A hard fail (equity wipeout / unresolved error flag) is terminal → **REJECT**.
- Otherwise take the **more conservative** of the two lenses; a non-hard-fail
  gate REJECT is treated as a returnable **RETURN_TO_UNDERWRITING**.
- A below-norm **contextual** read can escalate an otherwise-clean approve to
  *with conditions* (context tightens, never loosens).
- The result carries a plain-language rationale naming the binding lens.

The run computes it once (calling the findings engine exactly as the decision
tab does — same assumptions/scenarios, no engine `input` — so the persisted
value matches what the tab would compute) and persists it on the `insight` row.
Every surface then reads that single value: the deal header and Decision tab
(via `buildDecision`, which prefers the persisted value), the Analysis
*Recommendation* card, the memo banner, and the thesis. The raw gate verdict
remains visible as supporting detail (gate count / rationale), never as a
competing headline.

## Guarantees preserved

- **No LLM touches a number or a decision.** The calculator and the hard verdict
  gates are unchanged; the Insight Layer is additive interpretation/narration.
- **Provenance.** Benchmark norms come from the curated KB (a vetted constant
  source); every deal figure still traces to an approved input or engine output.
  The memo verifier admits the layer's numbers via `derivedValues`.
- **Determinism.** Same inputs → same thesis/narrative (no randomness/time).
- **Pluggable later.** An LLM provider can implement `InsightProvider` (wording
  only) behind `setInsightProvider`; the engine never depends on it.

## Tests

`src/test/insight.test.ts` — deal-context classification, layered benchmark
resolution (curated/firm/portfolio), interpretation bands + comparative phrasing,
deterministic synthesis, and a **provenance-clean** assertion over the full
narrative across all four audiences. Full suite: 87 passing.
