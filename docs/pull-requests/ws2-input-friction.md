# WS2: Defeat input friction

Branch: `feat/ws2-input-friction` (off `main`). Independent of WS1.

## Why

The bottleneck to a TRUSTED input is analyst minutes, not raw extraction accuracy. This PR
optimizes recall + correction speed + verification speed while keeping extraction fully
deterministic: the regex candidate extractor and the deterministic alias mapper still produce every
value. New code recovers MORE STRUCTURE, an LLM may only SUGGEST structure (never a number), and a
learning layer turns each accepted correction into a compounding deterministic asset.

Nothing here can mint a value. Every number still comes from a document token; the new layers only
order, classify, or remember label -> key STRUCTURE.

## What shipped

### 2A. Extraction review UX (`src/components/assumption-review.tsx`, `src/lib/extraction-review.ts`)
- A confidence-ranked TRIAGE QUEUE: conflicts first, then low, then medium confidence (high-
  confidence clean rows fall to a bulk tail). Pure ordering in `triageOrder`.
- Keyboard-first triage: `A` approve, `R` reject, `E` modify, number keys pick a documented value
  for a conflict, `J`/`K` (and arrows) navigate, `Esc` close. Ignores keystrokes while an input is
  focused.
- Bulk-accept the high-confidence tail in one action (`selectHighConfidenceTail` +
  `bulkApproveAssumptions`).
- Source highlight: the extracted value (and its bare numeric core) is highlighted inside its
  source snippet, in both the triage queue and the existing source panel (`highlightSegments`,
  regex-escaped, deterministic).

### 2B. Structure-aware Excel extraction (`src/lib/parsers/structure.server.ts`)
- `parseNamedRanges`: an XLSX defined name is an explicit author label; resolve it to a taxonomy
  key (camelCase / snake_case split) and read the value at its cell.
- `parseSourcesAndUses`: lift the capital stack (debt / mezz / equity) from a Sources block and the
  budget categories from a Uses block. Self-gating (no Sources/Uses markers -> nothing), so it never
  fires on an unrelated sheet.
- `detectBlocks`: segment a single sheet into its recognized blocks (sources, uses, rent roll,
  budget, debt summary) so a mixed sheet is parsed block by block.
- Wired into `extractAssumptions` Stage 1; structured candidates take precedence over loose text.

### 2C. LLM for STRUCTURE, never values (`applyHeaderMapping` in `structure.server.ts`)
- `HeaderMappingSuggester` is an injectable boundary; the live impl reuses the existing gated AI
  gateway and returns ONLY a header-text -> canonical-key map.
- `applyHeaderMapping` deterministically turns that suggestion into column indices and drops any key
  the taxonomy does not recognize (fail-closed). The model never sees or returns a value.

### 2D. Learn from corrections (the compounding moat)
- Pure logic (`src/lib/extraction-learning.ts`): `documentFingerprint` (stable, order- and value-
  independent hash of a document's label STRUCTURE), `deriveAliasFromCorrection`, `applyTemplate`,
  `buildTemplateEntries`, `sourceLabelFromText`.
- The deterministic mapper now accepts optional learned aliases
  (`mapCandidates(candidates, learnedAliases)`), checked with the SAME proximity/guard rules as the
  static aliases. An empty set is byte-identical (verified by the extraction suites).
- Wiring (`src/lib/extraction-learning.server.ts`, `assumptions.functions.ts`): at extraction we
  load workspace-scoped learned aliases + counterparty templates, auto-map this run's candidates
  from any known template, promote AI-mapped novel labels into the deterministic store, and record
  each document's structure as a template under its fingerprint. On `reviewAssumption` approve/modify
  we record a learned alias from the accepted row's source label. Every learning write is best-effort
  and migration-safe (a missing table or a race never breaks extraction or review).

## Schema (new migration `supabase/migrations/20260626000100_extraction_learning.sql`)

Two workspace-scoped tables, both holding STRUCTURE only (label -> key), never a value:
- `extraction_aliases` (workspace_id nullable, owner_id, field_key, alias_text, usage_count, ...).
- `counterparty_templates` (workspace_id nullable, owner_id, fingerprint, label, field_key, ...).

RLS mirrors the established additive dual pattern: an owner policy (`owner_id = auth.uid()`) plus a
`_workspace_member` policy (`workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id)`),
both with `WITH CHECK`. A unique index per scope (COALESCE(workspace_id, owner_id) + key columns)
prevents duplicates. `src/integrations/supabase/types.ts` regenerated from the migration (no drift).

## New server functions (all `requireSupabaseAuth` + zod + user-scoped client; RLS-enforced)
- `bulkApproveAssumptions({ project_id, ids })`: approves the clean (non-conflicting) extracted rows
  in `ids` and propagates each to the engine-readable tables, reusing `propagateApprovedToEngine` +
  `recordVersion`. A conflict still requires a human pick.

## Determinism / trust guarantees preserved
- No minted values: the LLM and the learning layer only assign an already-extracted token to a key.
- Fail-closed: a bad suggestion or correction with an unknown key / too-short label is dropped; a
  unit/kind mismatch is refused (`applyTemplate` gates on `kindFitsKey`).
- The golden extraction suites (Harbour, Rivergate, Summit Point, parsers, extraction-scale) are
  byte-identical: every new mapper path defaults to off / empty.

## Tests (`npm run test`: 24 files, 202 passing; +22 new)
- `extraction-review.test.ts`: triage order, high-confidence tail, source highlight (regex-escaped,
  numeric-core fallback).
- `structure-extraction.test.ts`: named ranges, Sources & Uses lift + no-false-positive, block
  detection, header mapping (alias + fail-closed).
- `extraction-learning.test.ts`: fingerprint stability, learned-alias resolve + byte-identical empty
  set, template auto-map + unit/kind refusal, correction normalization, source-label recovery.

## Verification
- `npm run typecheck` 0 errors; `npm run test` all green incl. new; `npm run build` green; types.ts
  matches migrations (clean `db reset` + `gen types` shows no drift).
- Browser (local Supabase + seeded varied assumptions): the triage queue renders conflicts-first,
  `J` advances the cursor, the source snippet highlights the extracted value (e.g. `6.5` inside
  "6.50%"), conflicts show numbered documented-value picks, and Accept N high approves the tail and
  propagates to `underwriting_inputs` / `development_budget` with no console errors.

## Definition of done
typecheck 0; tests green incl. new; build green; types match migrations; no em dashes; no new
`as any`; new tables use additive owner + workspace-member RLS with WITH CHECK and no cross-tenant
path; extraction suites byte-identical.
