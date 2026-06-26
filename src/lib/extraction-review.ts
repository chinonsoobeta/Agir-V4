// WS2 / 2A. Pure, deterministic helpers for the extraction review surface.
//
// The review center turns auto-extracted candidates into TRUSTED inputs with the
// fewest analyst minutes. These helpers decide the triage order (what needs human
// attention first), which high-confidence rows are safe to bulk-accept, and how to
// highlight the matched value inside its source snippet. They invent nothing: they
// only order, filter, and segment values the deterministic extractor already
// produced.

export type ReviewRow = {
  id: string;
  field_key: string;
  field_label?: string | null;
  status: string;
  confidence_score?: number | null;
  confidence_band?: string | null;
  value_numeric?: number | null;
  value_text?: string | null;
  unit?: string | null;
  source_text?: string | null;
  source_location?: string | null;
};

// Priority of a row in the triage queue. Lower = surfaced first. A row that does
// not need triage (already approved/rejected/missing, or high-confidence and
// clean) returns null and is excluded from the queue.
export function triagePriority(row: Pick<ReviewRow, "status" | "confidence_band">): number | null {
  // Conflicts block underwriting: always first.
  if (row.status === "conflicting") return 0;
  // Only undecided, value-bearing rows are triageable.
  if (row.status !== "extracted" && row.status !== "needs_review") return null;
  if (row.confidence_band === "low") return 1;
  if (row.confidence_band === "medium") return 2;
  // High-confidence extracted rows fall to the bulk-accept tail, not the queue.
  return null;
}

// Order the rows that need human attention: conflicts first, then low, then medium
// confidence; within a tier the lowest confidence_score comes first, then
// field_label, then input order, for a stable deterministic queue.
export function triageOrder<T extends ReviewRow>(rows: T[]): T[] {
  return rows
    .map((row, index) => ({ row, index, priority: triagePriority(row) }))
    .filter((x): x is { row: T; index: number; priority: number } => x.priority !== null)
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        (a.row.confidence_score ?? 0) - (b.row.confidence_score ?? 0) ||
        String(a.row.field_label ?? a.row.field_key).localeCompare(String(b.row.field_label ?? b.row.field_key)) ||
        a.index - b.index,
    )
    .map((x) => x.row);
}

// Ids of the high-confidence tail: rows safe to approve in bulk. A row qualifies
// only when it is a clean (non-conflicting) extracted row in the high band: exactly
// the set an analyst would otherwise approve one by one.
export function selectHighConfidenceTail<T extends ReviewRow>(rows: T[]): string[] {
  return rows.filter((r) => r.status === "extracted" && r.confidence_band === "high").map((r) => r.id);
}

export type HighlightSegment = { text: string; match: boolean };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The bare numeric core of a value_text ("$3,050/mo" -> "3,050"), so the value is
// still highlighted when the source writes the number without its currency/suffix.
function numericCore(valueText: string): string {
  const m = valueText.match(/-?\d[\d,]*(?:\.\d+)?/);
  return m ? m[0] : "";
}

// Split a source snippet into segments, marking every occurrence of the extracted
// value (and its bare numeric core) so the UI can highlight what was lifted.
// Deterministic, case-insensitive; returns a single non-match segment when there
// is nothing to highlight. Never alters the text.
export function highlightSegments(
  sourceText: string | null | undefined,
  valueText: string | null | undefined,
): HighlightSegment[] {
  const text = sourceText ?? "";
  if (!text) return [];
  const needles = Array.from(
    new Set([valueText ?? "", numericCore(valueText ?? "")].map((n) => n.trim()).filter((n) => n.length >= 1)),
  ).sort((a, b) => b.length - a.length); // longest-first so "$3,050" wins over "3,050"
  if (!needles.length) return [{ text, match: false }];
  const re = new RegExp(`(${needles.map(escapeRegExp).join("|")})`, "gi");
  // String.split with one capture group yields [non, match, non, match, ...]:
  // even indices are literal text, odd indices are the captured needle.
  const parts = text.split(re);
  const out: HighlightSegment[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "") continue;
    out.push({ text: parts[i], match: i % 2 === 1 });
  }
  return out;
}
