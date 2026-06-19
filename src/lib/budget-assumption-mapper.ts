import { ASSUMPTION_BY_KEY } from "./assumption-taxonomy";
import type { MappedCandidate } from "./assumption-mapping";
import type { ParsedBudgetRow } from "./parsers/budget.server";

const BUDGET_KEY_BY_CATEGORY = {
  land: "land_cost",
  hard: "hard_costs",
  soft: "soft_costs",
  contingency: "contingency",
  financing_interest: "financing_costs",
  other: null,
} as const;

const money = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);

// Classify a budget "other" line item into a distinct reserve key so it is not
// lost or summed with unrelated reserves.
function reserveKeyFor(label: string): string | null {
  const t = label.toLowerCase();
  if (/environmental|remediation|pfas|\besa\b/.test(t)) return "environmental_reserve";
  if (/off[\s-]?site|public road|infrastructure|municipal|substation|stormwater/.test(t)) return "offsite_improvements";
  if (/leasing|tenant improvement|\bti\b|\blc\b/.test(t)) return "leasing_reserve";
  if (/tax reassess|reassessed/.test(t)) return "tax_reassessment";
  return null;
}

// Single-row mapper kept for compatibility / non-aggregated callers.
export function mapBudgetRowToAssumption(row: ParsedBudgetRow, sourceDocument: { name: string }): MappedCandidate | null {
  const key = BUDGET_KEY_BY_CATEGORY[row.category];
  if (!key) return null;
  const def = ASSUMPTION_BY_KEY[key];
  return {
    field_key: key,
    value_numeric: row.amount,
    value_text: null,
    unit: def.unit,
    confidence: 98,
    source_doc_name: sourceDocument.name,
    source_text: row.sourceText || `${row.sourceCellRef}: ${row.label} | $${row.amount}`,
    source_location: row.sourceCellRef,
    matched_alias: `${row.category} structured budget row`,
    via: "alias",
    candidate_role: "line_item",
  };
}

// Aggregate parsed budget rows from ONE document by category. Line items in the
// same category are SUMMED into a single category total (never treated as
// conflicts). "other" rows are split into distinct reserve keys. Line-item
// detail is preserved in source_text for audit drilldown. A conflict can only
// arise later when a DIFFERENT document claims a competing total for the same
// category (groupAndResolve sees two category_totals).
export function aggregateBudgetRows(rows: ParsedBudgetRow[], sourceDocument: { name: string }): MappedCandidate[] {
  type Bucket = { key: string; total: number; lines: ParsedBudgetRow[] };
  const buckets = new Map<string, Bucket>();

  for (const row of rows) {
    let key: string | null = BUDGET_KEY_BY_CATEGORY[row.category];
    if (!key && row.category === "other") key = reserveKeyFor(row.label);
    if (!key) continue;
    const b = buckets.get(key) ?? { key, total: 0, lines: [] };
    b.total += row.amount;
    b.lines.push(row);
    buckets.set(key, b);
  }

  const out: MappedCandidate[] = [];
  for (const b of buckets.values()) {
    const def = ASSUMPTION_BY_KEY[b.key];
    if (!def) continue;
    const detail = b.lines.map((l) => `${l.label} $${money(l.amount)}`).join(" + ");
    const ref = b.lines[0]?.sourceCellRef ?? "budget";
    out.push({
      field_key: b.key,
      value_numeric: b.total,
      value_text: null,
      unit: def.unit,
      confidence: 99,
      source_doc_name: sourceDocument.name,
      source_text: `${def.label} = ${detail} = $${money(b.total)} (${b.lines.length} line item${b.lines.length === 1 ? "" : "s"})`,
      source_location: ref,
      matched_alias: `${b.key} category total`,
      via: "alias",
      candidate_role: "category_total",
    });
  }
  return out;
}
