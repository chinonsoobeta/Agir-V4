// Stage 2 of the extraction pipeline: DETERMINISTIC alias mapping. Given the
// regex candidates from Stage 1, this module maps each candidate to a canonical
// assumption key using ONLY its label hint, surrounding context, and unit/kind
// compatibility: no LLM, no invented values. The AI classifier (when an API
// key is configured) is a secondary pass for candidates this mapper leaves
// unresolved; it can never override a deterministic mapping and can never mint
// a value the regex pass did not already lift from a document.

import type { Candidate, CandidateKind } from "./assumption-candidates.server";
import { ASSUMPTION_DEFS, ASSUMPTION_BY_KEY, type AssumptionDef } from "./assumption-taxonomy";
import { roundForGrouping } from "./engine/tolerance-policy";

// Candidate kinds (and rent denomination) admissible for a taxonomy unit. This
// guards against gross mismatches (e.g. a percentage on a dollar field); the
// label match is the primary signal.
//
// Rent candidates carry a denomination in `unit` ("$/mo" vs "$/SF"). It must be
// honoured: a per-SF rent ($/SF) is ~100x a monthly per-unit rent, so letting an
// "$X PSF" office rent satisfy a "$"-unit monthly field (it used to, via a
// generic "asking rent" alias) put a wrong field AND a wrong magnitude into the
// engine. A monthly rent likewise must never fill a $/SF field.
function kindFitsKey(cand: Candidate, def: AssumptionDef): boolean {
  const { kind } = cand;
  switch (def.unit) {
    case "%":
      return kind === "percent";
    case "SF":
      return kind === "sf";
    case "units":
      return kind === "units";
    case "x":
      return kind === "ratio";
    case "yr":
    case "mo":
      return kind === "duration";
    case "$":
      // Absolute / monthly-per-unit dollar field: a per-SF rent must not land here.
      // residential_rent_monthly is the ONLY $-unit field that is actually a
      // monthly per-unit rent, so a multi-$M lump sum (a mislabelled total/loan)
      // can never be a monthly rent - gate it by a plausible per-unit ceiling.
      if (kind === "currency") {
        if (def.key === "residential_rent_monthly")
          return Math.abs(cand.value_numeric ?? 0) <= 100_000;
        return true;
      }
      return kind === "rent" && cand.unit !== "$/SF";
    case "$/SF":
      // Per-SF field: a monthly per-unit rent must not land here, and a lump-sum
      // currency is only plausibly a per-SF rate when it is small (PSF rents are
      // tens to low hundreds of dollars, never millions).
      if (kind === "rent") return cand.unit !== "$/mo";
      if (kind === "currency") return Math.abs(cand.value_numeric ?? 0) <= 1_000;
      return false;
    case "text":
      return true;
    default:
      return kind === "currency";
  }
}

// All search strings for a definition, longest-first so the most specific alias
// wins (e.g. "residential occupancy" beats the generic "occupancy").
function aliasStrings(def: AssumptionDef): string[] {
  const set = new Set<string>();
  set.add(def.key.replace(/_/g, " "));
  set.add(def.label.toLowerCase());
  for (const a of def.aliases) set.add(a.toLowerCase());
  return Array.from(set).filter((s) => s.length >= 3);
}

// Word tokens (>=2 chars) for loose, order-independent alias matching.
function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []).filter(Boolean);
}

const ALIAS_TABLE: Array<{ def: AssumptionDef; alias: string; tokens: string[] }> =
  ASSUMPTION_DEFS.flatMap((def) =>
    aliasStrings(def).map((alias) => ({ def, alias, tokens: tokenize(alias) })),
  ).sort((a, b) => b.alias.length - a.alias.length);

export type CandidateMapping = {
  field_key: string;
  confidence: number;
  via: "alias";
  matched_alias: string;
  where: "hint" | "context";
};

// Deterministically map one candidate to a canonical key, or null.
//
// The label hint (text immediately left of the value) is the primary signal,
// and within it PROXIMITY wins: the alias whose match ends closest to the value
// is chosen, because the label nearest a number is the one that names it. (The
// hint window can spill into a prior line's label; a plain "longest alias" rule
// would mis-assign e.g. a terminal-cap value sitting after a longer, earlier
// label.) Ties break toward the longer alias. Only the broader context is used
// as a fallback when nothing matches in the hint. Unit/kind compatibility gates
// every candidate so a percentage never lands on a dollar field.
// A loan/debt label immediately preceding a value means the value IS the
// debt: it must never be read as a stated total project cost.
const LOAN_DEBT_LABEL_RE =
  /(senior\s+(construction\s+)?(loan|debt)|loan amount|loan facility|facility size|debt amount|mortgage|preferred equity|common equity|senior debt)/i;

// A refinance/takeout or mezzanine/subordinate label must not land on the
// generic senior key just because the generic alias ("loan amount",
// "amortization") matched contiguously. When the label names such a tranche, the
// generic key is excluded and the mapper re-picks the qualified sibling
// (refinance_amount / mezz_debt_amount / refinance_amort_years / ...) via its own
// aliases. (interest_rate is handled by its SENSITIVE_GUARD deny instead.)
const TRANCHE_QUALIFIER_RE =
  /refinanc|\brefi\b|takeout|permanent loan|perm loan|mezzanine|\bmezz\b|subordinate|junior debt/i;
const TRANCHE_GENERIC_KEYS = new Set(["debt_amount", "amortization_years"]);

// Context + range guards for keys that are easily contaminated by lookalike
// rates (the classic failure: an exit-cap value of 5.75% mapping to the
// operating expense ratio). A guarded key requires matching context AND, where
// relevant, a disqualifying context must be ABSENT, AND the value must fall in a
// plausible range. Range alone is never sufficient: context must match.
// `deny` is tested against the hint AND the broader context (a lookalike rate
// betrays itself in nearby words). `denyHint` is tested against the LABEL HINT
// ONLY -- used for tranche qualifiers (mezzanine/refinance) that legitimately
// appear on neighbouring lines of a capital-stack doc and must not disqualify a
// senior value via context bleed; they only disqualify when they name THIS value.
type Guard = { need: RegExp; deny?: RegExp; denyHint?: RegExp; min?: number; max?: number };
const SENSITIVE_GUARDS: Record<string, Guard> = {
  opex_ratio: {
    need: /operating expense|opex|\boer\b|expense ratio|expense load|operating cost ratio|normalized expense|expense assumption|expense %/,
    deny: /exit cap|terminal cap|cap rate|capitalization rate|valuation cap|yield on cost|interest rate|debt yield/,
    min: 10,
    max: 65,
  },
  exit_cap_rate: {
    need: /exit cap|terminal cap|cap rate|capitalization|valuation|appraisal|sale cap|reversion|disposition cap/,
    min: 3,
    max: 12,
  },
  interest_rate: {
    // Bare "sofr"/"spread" removed from `need`: a spread over an index is not the
    // all-in rate. A mezzanine/subordinate label is denied so a junior-tranche
    // rate never lands on the senior interest rate (it re-picks to mezz_interest_rate).
    need: /interest rate|loan rate|all-in rate|rate lock|financing rate|coupon|note rate/,
    // ALL contamination terms are hint-only. A neighbouring "Exit cap rate" /
    // "Mezzanine loan" line (rate and cap sit side by side on every term sheet)
    // must not deny a value whose OWN label is "Interest rate" via context bleed;
    // a value genuinely labelled "cap rate" maps to exit_cap_rate by its longer
    // alias and never becomes interest_rate's pick in the first place.
    denyHint:
      /exit cap|terminal cap|cap rate|debt yield|expense ratio|mezzanine|\bmezz\b|subordinate|refinanc|\brefi\b|takeout|permanent loan/,
    min: 1,
    max: 20,
  },
  min_dscr: {
    // A DSCR covenant is a small ratio (~1.0-2.5x); an EBITDA/valuation multiple
    // (e.g. 7.5x) sharing a "dscr" hint must not land here.
    need: /dscr|debt service coverage|coverage ratio/,
    min: 1,
    max: 3,
  },
  min_all_in_dscr: {
    need: /all-in dscr|whole-stack dscr|all in dscr|debt service coverage/,
    min: 1,
    max: 3,
  },
  min_debt_yield: { need: /debt yield/, min: 4, max: 20 },
  stabilized_occupancy: {
    // `need` mirrors the taxonomy aliases (incl. economic/physical occupancy) so
    // a validly-labelled REQUIRED value is never rejected by a narrower guard.
    need: /stabilized occupancy|economic occupancy|physical occupancy|overall occupancy|portfolio occupancy|blended occupancy|average occupancy/,
    min: 40,
    max: 100,
  },
  tenant_concentration_pct: {
    need: /tenant concentration|revenue concentration|tenant share|largest tenant/,
    min: 1,
    max: 100,
  },
};

function passesSensitiveGuard(cand: Candidate, key: string): boolean {
  const guard = SENSITIVE_GUARDS[key];
  if (!guard) return true;
  const text = `${cand.label_hint || ""} ${cand.context || ""}`.toLowerCase();
  if (!guard.need.test(text)) return false;
  if (guard.deny && guard.deny.test(text)) return false;
  if (guard.denyHint && guard.denyHint.test((cand.label_hint || "").toLowerCase())) return false;
  const v = cand.value_numeric;
  if (v != null && Number.isFinite(v)) {
    if (guard.min != null && v < guard.min) return false;
    if (guard.max != null && v > guard.max) return false;
  }
  return true;
}

export function mapCandidateToKey(
  cand: Candidate,
  exclude: Set<string> = new Set(),
): CandidateMapping | null {
  const hint = (cand.label_hint || "").toLowerCase();

  // Match against the line-scoped label hint, preferring the alias whose match
  // ends closest to the value (the nearest label names it). We deliberately do
  // NOT fall back to the broader multi-line context: that let a value inherit a
  // neighbouring line's label and produced false conflicts.
  let best: CandidateMapping | null = null;
  let bestEnd = -1;
  let bestLen = -1;
  for (const { def, alias } of ALIAS_TABLE) {
    if (exclude.has(def.key)) continue;
    if (!kindFitsKey(cand, def)) continue;
    const idx = hint.lastIndexOf(alias);
    if (idx < 0) continue;
    const end = idx + alias.length;
    if (end > bestEnd || (end === bestEnd && alias.length > bestLen)) {
      bestEnd = end;
      bestLen = alias.length;
      best = {
        field_key: def.key,
        confidence: 90,
        via: "alias",
        matched_alias: alias,
        where: "hint",
      };
    }
  }

  // Token-subset fallback: only when no alias matched as a contiguous substring.
  // A real-world label often interleaves words ("office asking rent" never
  // contains the literal alias "office rent"), so match a multi-word alias when
  // ALL its tokens appear as whole words in the hint. Lower confidence than a
  // contiguous hit; prefers the alias with the most tokens then the longest, so
  // a more specific label wins. Single-token aliases are skipped (a contiguous
  // pass already covers them) to avoid matching on one incidental word.
  if (!best) {
    const hintTokens = new Set(tokenize(hint));
    let bestTokens = -1;
    let bestTokenLen = -1;
    let ambiguous = false;
    for (const { def, alias, tokens } of ALIAS_TABLE) {
      if (exclude.has(def.key)) continue;
      if (!kindFitsKey(cand, def)) continue;
      if (tokens.length < 2) continue;
      if (!tokens.every((t) => hintTokens.has(t))) continue;
      if (
        tokens.length > bestTokens ||
        (tokens.length === bestTokens && alias.length > bestTokenLen)
      ) {
        // A strictly better match supersedes any prior tie.
        ambiguous = false;
        bestTokens = tokens.length;
        bestTokenLen = alias.length;
        best = {
          field_key: def.key,
          confidence: 72,
          via: "alias",
          matched_alias: alias,
          where: "hint",
        };
      } else if (
        tokens.length === bestTokens &&
        alias.length === bestTokenLen &&
        best &&
        def.key !== best.field_key
      ) {
        // A different key matched equally well (e.g. "residential and retail
        // occupancy" satisfies both). Refuse to guess: a miss beats a wrong field.
        ambiguous = true;
      }
    }
    if (ambiguous) best = null;
  }

  // Hard guard: a value whose nearest label is a loan/debt/equity tranche term
  // can never be a stated total project cost (this is exactly the mis-map that
  // turned the $162.5M senior loan into a bogus stated total). Re-pick excluding
  // total_project_cost so it lands on debt_amount (or nothing) instead.
  if (best && best.field_key === "total_project_cost" && !exclude.has("total_project_cost")) {
    const tail = hint.slice(-32);
    if (LOAN_DEBT_LABEL_RE.test(tail)) {
      return mapCandidateToKey(cand, new Set([...exclude, "total_project_cost"]));
    }
  }

  // Tranche re-route: a generic senior key whose label actually names a
  // refinance/mezzanine tranche must yield to its qualified sibling. Re-pick
  // excluding the generic key so refinance_amount / mezz_debt_amount /
  // refinance_amort_years (etc.) win via their own aliases.
  if (
    best &&
    TRANCHE_GENERIC_KEYS.has(best.field_key) &&
    !exclude.has(best.field_key) &&
    TRANCHE_QUALIFIER_RE.test(hint)
  ) {
    return mapCandidateToKey(cand, new Set([...exclude, best.field_key]));
  }

  // Sensitive-key contamination guard: if the best match is a rate/ratio/
  // occupancy key whose context doesn't support it (or whose value is out of
  // range), reject it and re-pick excluding that key. This stops an exit-cap
  // value from landing on the operating expense ratio, an interest rate from a
  // cap-rate context, or a component occupancy from the stabilized field.
  if (best && SENSITIVE_GUARDS[best.field_key] && !passesSensitiveGuard(cand, best.field_key)) {
    return mapCandidateToKey(cand, new Set([...exclude, best.field_key]));
  }
  return best;
}

// Role decides whether multiple values aggregate or conflict. Structured roles
// (category_total, rent_row) come from typed spreadsheet parsing and take
// precedence over loose scalar text candidates for the same key.
export type CandidateRole =
  | "line_item"
  | "category_total"
  | "stated_total"
  | "scalar_assumption"
  | "ratio"
  | "rent_row";

const STRUCTURED_ROLES: ReadonlySet<CandidateRole> = new Set(["category_total", "rent_row"]);

export type MappedCandidate = {
  field_key: string;
  value_numeric: number | null;
  value_text: string | null;
  unit: string;
  confidence: number;
  source_doc_name: string;
  source_text: string;
  source_location: string | null;
  matched_alias: string;
  via: "alias";
  candidate_role?: CandidateRole;
};

// Map every candidate deterministically; unmapped candidates are dropped.
export function mapCandidates(candidates: Candidate[]): MappedCandidate[] {
  const out: MappedCandidate[] = [];
  for (const c of candidates) {
    const m = mapCandidateToKey(c);
    if (!m) continue;
    const def = ASSUMPTION_BY_KEY[m.field_key];
    if (!def) continue;
    if (def.numeric && c.value_numeric == null) continue;
    out.push({
      field_key: def.key,
      value_numeric: def.numeric ? c.value_numeric : null,
      value_text: def.numeric ? null : c.value_text,
      unit: def.unit,
      confidence: m.confidence,
      source_doc_name: c.doc_name,
      source_text: c.context,
      source_location: c.source_location,
      matched_alias: m.matched_alias,
      via: m.via,
      candidate_role:
        def.key === "total_project_cost"
          ? "stated_total"
          : def.unit === "x"
            ? "ratio"
            : "scalar_assumption",
    });
  }
  return out;
}

export type GroupResolution = {
  field_key: string;
  status: "extracted" | "conflicting";
  value_numeric: number | null;
  value_text: string | null;
  winner: MappedCandidate;
  members: MappedCandidate[];
  distinct: Array<number | string | null>;
  conflict_values: Array<{ value: number | string | null; source: string }> | null;
};

export type ResolutionAuditMember = {
  value: number | string | null;
  confidence: number;
  source_doc_name: string;
  source_location: string | null;
  source_text: string;
  matched_alias: string;
  candidate_role: CandidateRole | null;
  selected: boolean;
};

export type ResolutionAudit = {
  field_key: string;
  status: GroupResolution["status"];
  winner_source: string;
  winner_value: number | string | null;
  winner_reason: string;
  distinct: Array<number | string | null>;
  conflict_values: GroupResolution["conflict_values"];
  members: ResolutionAuditMember[];
};

const roundKey = (m: MappedCandidate): number | string | null =>
  m.value_numeric != null ? roundForGrouping(m.value_numeric) : m.value_text;

const compareMaybe = (
  a: string | number | null | undefined,
  b: string | number | null | undefined,
) => String(a ?? "").localeCompare(String(b ?? ""));

function compareMappedCandidates(a: MappedCandidate, b: MappedCandidate): number {
  return (
    b.confidence - a.confidence ||
    compareMaybe(roundKey(a), roundKey(b)) ||
    compareMaybe(a.source_doc_name, b.source_doc_name) ||
    compareMaybe(a.source_location, b.source_location) ||
    compareMaybe(a.source_text, b.source_text) ||
    compareMaybe(a.matched_alias, b.matched_alias)
  );
}

function winnerReason(row: GroupResolution): string {
  if (row.status === "conflicting") return "blocked: distinct values or implausible scale";
  const winner = row.winner;
  const structured = winner.candidate_role && STRUCTURED_ROLES.has(winner.candidate_role);
  const value = roundKey(winner);
  return [
    structured ? `structured ${winner.candidate_role}` : "scalar candidate",
    `confidence ${winner.confidence}`,
    `value ${String(value)}`,
    `source ${winner.source_doc_name}`,
    winner.source_location ? `location ${winner.source_location}` : null,
    `alias ${winner.matched_alias}`,
  ]
    .filter(Boolean)
    .join("; ");
}

export function auditResolution(row: GroupResolution): ResolutionAudit {
  const members = [...row.members].sort(compareMappedCandidates);
  return {
    field_key: row.field_key,
    status: row.status,
    winner_source: row.winner.source_doc_name,
    winner_value: roundKey(row.winner),
    winner_reason: winnerReason(row),
    distinct: row.distinct,
    conflict_values: row.conflict_values,
    members: members.map((member) => ({
      value: roundKey(member),
      confidence: member.confidence,
      source_doc_name: member.source_doc_name,
      source_location: member.source_location,
      source_text: member.source_text,
      matched_alias: member.matched_alias,
      candidate_role: member.candidate_role ?? null,
      selected: member === row.winner,
    })),
  };
}

export function auditResolvedAssumptions(grouped: Map<string, GroupResolution>): ResolutionAudit[] {
  return Array.from(grouped.values())
    .sort((a, b) => a.field_key.localeCompare(b.field_key))
    .map(auditResolution);
}

// Coarse plausibility floor for whole-deal AGGREGATE dollar keys. In
// institutional CRE these are never sub-$250k; a value below the floor is almost
// always a units/scale slip (e.g. a "$ in thousands" budget read 1000x too small
// that scale detection did not catch). Deliberately excludes small-by-nature
// dollar keys (per-unit rent, other income, contingency, reserves, individual
// soft/financing lines) so a legitimate small value is never falsely blocked.
const PLAUSIBILITY_FLOOR: Record<string, number> = {
  total_project_cost: 250_000,
  hard_costs: 250_000,
  debt_amount: 250_000,
  equity_amount: 250_000,
  // Whole-deal loan aggregates share the same units-slip failure mode (a
  // "$ in thousands" takeout/mezz loan read 1000x too small).
  refinance_amount: 250_000,
  mezz_debt_amount: 250_000,
};

// Group mapped candidates by key and resolve each group. Multiple DISTINCT
// values for one key become a conflict: no value is chosen, both sources are
// preserved, and the key must block underwriting. Values are never averaged.
export function groupAndResolve(mapped: MappedCandidate[]): Map<string, GroupResolution> {
  const groups = new Map<string, MappedCandidate[]>();
  for (const m of mapped) {
    const arr = groups.get(m.field_key) ?? [];
    arr.push(m);
    groups.set(m.field_key, arr);
  }

  const out = new Map<string, GroupResolution>();
  for (const [field_key, allMembers] of groups.entries()) {
    // If any structured candidates (aggregated category totals or typed rent-roll
    // rows) exist for this key, they are authoritative: loose scalar text
    // candidates are ignored so a stray line-item mention can't manufacture a
    // false conflict against an aggregated total.
    const structured = allMembers.filter(
      (m) => m.candidate_role && STRUCTURED_ROLES.has(m.candidate_role),
    );
    const members = structured.length > 0 ? structured : allMembers;
    members.sort(compareMappedCandidates);
    const distinct = Array.from(new Set(members.map(roundKey)));
    const isConflict = distinct.length > 1;
    const winner = members[0];
    // Plausibility backstop: an aggregate dollar value below its floor is almost
    // always a units/scale slip. Fail closed -- block it as a conflict so an
    // analyst confirms or corrects the magnitude -- rather than letting a
    // confidently-wrong number flow silently to the engine.
    const floor = PLAUSIBILITY_FLOOR[field_key];
    const implausible =
      !isConflict &&
      floor != null &&
      winner.value_numeric != null &&
      Math.abs(winner.value_numeric) < floor;
    const blocked = isConflict || implausible;
    const conflict_values = isConflict
      ? members
          .filter((m) => m.value_numeric != null || m.value_text != null)
          .map((m) => ({ value: roundKey(m), source: m.source_doc_name }))
          .filter((c, i, all) => all.findIndex((x) => x.value === c.value) === i)
      : implausible
        ? [
            {
              value: roundKey(winner),
              source: `${winner.source_doc_name} - implausibly small for ${field_key}; check units/scale`,
            },
          ]
        : null;
    out.set(field_key, {
      field_key,
      status: blocked ? "conflicting" : "extracted",
      value_numeric: blocked ? null : winner.value_numeric,
      value_text: blocked ? null : winner.value_text,
      winner,
      members,
      distinct,
      conflict_values,
    });
  }
  return out;
}

// ---------- Stage 1.5: candidate prioritisation ----------
//
// Used to bound the OPTIONAL AI classifier prompt without dropping important
// values. Deterministic mapping itself runs over ALL candidates (no cap), so
// canonical Harbour values are never pushed beyond a limit.

export type RankedCandidate = { candidate: Candidate; index: number; score: number };

const KIND_WEIGHT: Record<CandidateKind, number> = {
  currency: 5,
  percent: 5,
  rent: 5,
  sf: 4,
  units: 4,
  ratio: 4,
  duration: 3,
  date: 0,
};

export function scoreCandidate(cand: Candidate): number {
  let score = KIND_WEIGHT[cand.kind] ?? 1;
  const mapping = mapCandidateToKey(cand);
  if (mapping) {
    score += 50;
    if (mapping.where === "hint") score += 20;
    const def = ASSUMPTION_BY_KEY[mapping.field_key];
    if (def?.required) score += 30;
  }
  return score;
}

// Rank candidates by importance, then guarantee at least `topPerDoc` of each
// document's best candidates and broad kind coverage survive any cap.
export function rankCandidates(
  candidates: Candidate[],
  opts: { cap?: number; topPerDoc?: number } = {},
): Candidate[] {
  const cap = opts.cap ?? 220;
  const topPerDoc = opts.topPerDoc ?? 24;
  if (candidates.length <= cap) return candidates;

  const ranked: RankedCandidate[] = candidates.map((candidate, index) => ({
    candidate,
    index,
    score: scoreCandidate(candidate),
  }));
  const byScore = [...ranked].sort((a, b) => b.score - a.score || a.index - b.index);

  const chosen = new Set<number>();

  // 1) Per-document top-N.
  const perDoc = new Map<string, number>();
  for (const r of byScore) {
    const n = perDoc.get(r.candidate.doc_name) ?? 0;
    if (n < topPerDoc) {
      chosen.add(r.index);
      perDoc.set(r.candidate.doc_name, n + 1);
    }
  }
  // 2) Ensure each kind is represented.
  const kinds = new Set<CandidateKind>();
  for (const r of byScore) {
    if (chosen.has(r.index)) {
      kinds.add(r.candidate.kind);
    }
  }
  for (const r of byScore) {
    if (!kinds.has(r.candidate.kind)) {
      chosen.add(r.index);
      kinds.add(r.candidate.kind);
    }
  }
  // 3) Fill remaining capacity by score.
  for (const r of byScore) {
    if (chosen.size >= cap) break;
    chosen.add(r.index);
  }

  return ranked.filter((r) => chosen.has(r.index)).map((r) => r.candidate);
}
