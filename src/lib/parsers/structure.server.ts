// WS2 / 2B + 2C. Structure-aware, DETERMINISTIC Excel recovery.
//
// Beyond same-line regex and single-table sheet selection, this module recovers
// MORE structure from a workbook so a value's meaning is found from the author's
// own layout: defined (named) ranges, a Sources & Uses block, and multiple blocks
// on one sheet. It also provides the deterministic consumer for 2C: an LLM (or any
// rule) may SUGGEST a header-text -> canonical-key map, and `applyHeaderMapping`
// turns that suggestion into column indices. The model never sees or returns a
// value: every number is still read from a literal cell here.

import * as XLSX from "xlsx";
import { resolveAlias, ASSUMPTION_BY_KEY } from "../assumption-taxonomy";
import type { MappedCandidate } from "../assumption-mapping";
import { categoryFor, budgetHeaderScore, type ParsedBudgetRow } from "./budget.server";
import { rentRollHeaderScore } from "./rent-roll.server";
import type { SheetCell, SheetRow } from "./xlsx-utils";
import { readSheetRows } from "./xlsx-utils";

// Parse a numeric cell value (number passthrough, or a numeric string stripped of
// currency/percent formatting). Returns null when the cell is not a number.
function toNumeric(value: SheetCell): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value == null) return null;
  const s = String(value).trim();
  if (!/\d/.test(s)) return null;
  const n = Number(s.replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function roleFor(key: string, unit: string): MappedCandidate["candidate_role"] {
  if (key === "total_project_cost") return "stated_total";
  if (unit === "x") return "ratio";
  return "scalar_assumption";
}

// ---------- 2B.1 Named ranges ----------
//
// A defined name is an explicit author label for a cell, so it is a high-trust
// signal. Resolve the name to a taxonomy key and read the value at its cell.

function readRefValue(
  workbook: XLSX.WorkBook,
  ref: string,
): { sheet: string; cellRef: string; value: SheetCell } | null {
  const bang = ref.lastIndexOf("!");
  if (bang < 0) return null;
  let sheet = ref.slice(0, bang).trim();
  if (sheet.startsWith("'") && sheet.endsWith("'")) sheet = sheet.slice(1, -1).replace(/''/g, "'");
  const cellRef = ref.slice(bang + 1).split(":")[0].replace(/\$/g, "");
  const ws = workbook.Sheets[sheet];
  if (!ws) return null;
  const cell = (ws as Record<string, { v?: unknown } | undefined>)[cellRef];
  if (cell == null || cell.v == null) return null;
  return { sheet, cellRef, value: cell.v as SheetCell };
}

export function parseNamedRanges(workbook: XLSX.WorkBook, docName: string): MappedCandidate[] {
  const names = (workbook.Workbook?.Names ?? []) as Array<{ Name?: string; Ref?: string }>;
  const out: MappedCandidate[] = [];
  for (const n of names) {
    const rawName = (n?.Name ?? "").trim();
    const ref = (n?.Ref ?? "").trim();
    if (!rawName || !ref || rawName.startsWith("_")) continue; // skip Excel internals like _FilterDatabase
    // Named ranges are rarely spaced: split snake_case and camelCase into words so
    // "ExitCapRate" / "exit_cap_rate" both resolve via the alias index.
    const human = rawName.replace(/_+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
    const key = resolveAlias(human);
    if (!key) continue;
    const def = ASSUMPTION_BY_KEY[key];
    if (!def) continue;
    const cell = readRefValue(workbook, ref);
    if (!cell) continue;
    const numeric = toNumeric(cell.value);
    if (def.numeric && numeric == null) continue;
    out.push({
      field_key: def.key,
      value_numeric: def.numeric ? numeric : null,
      value_text: def.numeric ? null : String(cell.value ?? ""),
      unit: def.unit,
      confidence: 95,
      source_doc_name: docName,
      source_text: `Named range "${rawName}" -> ${ref}`,
      source_location: `Named range ${rawName} (Sheet ${cell.sheet} ${cell.cellRef})`,
      matched_alias: `named_range:${rawName.toLowerCase()}`,
      via: "alias",
      candidate_role: roleFor(def.key, def.unit),
    });
  }
  return out;
}

// ---------- 2B.2 Block detection ----------
//
// A single sheet often stacks several tables (a budget above a Sources & Uses
// block, a rent roll beside a debt summary). Detect each recognized block's header
// row so a mixed sheet can be parsed block by block instead of as one table.

export type BlockKind = "sources" | "uses" | "rent_roll" | "budget" | "debt_summary";
export type DetectedBlock = { kind: BlockKind; headerRow: number };

const lowerCells = (row: SheetRow | undefined): string[] => (row ?? []).map((c) => String(c ?? "").trim().toLowerCase());

// A section marker is a short label row (essentially just the section title), not a
// wide data/header row that happens to contain the word.
function isSectionMarker(cells: string[]): boolean {
  return cells.filter((c) => c !== "").length <= 2;
}

export function detectBlocks(rows: SheetRow[]): DetectedBlock[] {
  const blocks: DetectedBlock[] = [];
  for (let i = 0; i < rows.length; i++) {
    const cells = lowerCells(rows[i]);
    const joined = cells.join(" ").trim();
    if (!joined) continue;
    if (isSectionMarker(cells) && /\bsources?\b|sources of/.test(joined) && !/\buses?\b/.test(joined)) {
      blocks.push({ kind: "sources", headerRow: i });
    } else if (isSectionMarker(cells) && (/\buses?\b/.test(joined) || /use of funds/.test(joined)) && !/\bsources?\b/.test(joined)) {
      blocks.push({ kind: "uses", headerRow: i });
    } else if (/debt summary|financing summary|loan summary|debt service/.test(joined)) {
      blocks.push({ kind: "debt_summary", headerRow: i });
    } else if (rentRollHeaderScore(cells) >= 2) {
      blocks.push({ kind: "rent_roll", headerRow: i });
    } else if (budgetHeaderScore(cells) >= 2) {
      blocks.push({ kind: "budget", headerRow: i });
    }
  }
  return blocks;
}

// ---------- 2B.3 Sources & Uses ----------
//
// Lift the capital stack (debt / equity) from a Sources block and the budget
// categories from a Uses block. Today these scalars come only from loose text;
// the structured block is authoritative.

export type SourcesUsesResult = {
  budgetRows: ParsedBudgetRow[];
  scalars: MappedCandidate[];
};

function rowLabelAmount(row: SheetRow): { label: string; amount: number } | null {
  let label = "";
  let amount: number | null = null;
  for (const cell of row) {
    const s = String(cell ?? "").trim();
    if (!s) continue;
    const n = toNumeric(cell);
    if (n != null) amount = n; // keep the last numeric cell as the amount
    else if (!label) label = s; // first text cell is the line label
  }
  if (!label || amount == null) return null;
  return { label, amount };
}

function sourcesKeyFor(label: string): string | null {
  const t = label.toLowerCase();
  if (/total/.test(t)) return null;
  if (/mezz/.test(t)) return "mezz_debt_amount";
  if (/senior|construction loan|mortgage|\bloan\b|\bdebt\b|facility/.test(t)) return "debt_amount";
  if (/equity|sponsor|\blp\b|\bgp\b|preferred|common/.test(t)) return "equity_amount";
  return null;
}

export function parseSourcesAndUses(rows: SheetRow[], sheetName: string, docName: string): SourcesUsesResult {
  const blocks = detectBlocks(rows);
  if (!blocks.some((b) => b.kind === "sources") && !blocks.some((b) => b.kind === "uses")) {
    return { budgetRows: [], scalars: [] };
  }
  const markerAt = new Map<number, "sources" | "uses">();
  for (const b of blocks) if (b.kind === "sources" || b.kind === "uses") markerAt.set(b.headerRow, b.kind);

  const budgetRows: ParsedBudgetRow[] = [];
  const scalars: MappedCandidate[] = [];
  let section: "sources" | "uses" | null = null;

  rows.forEach((row, i) => {
    const marker = markerAt.get(i);
    if (marker) {
      section = marker;
      return;
    }
    if (!section) return;
    const la = rowLabelAmount(row);
    if (!la) return;
    const rowNumber = i + 1;
    if (section === "uses") {
      if (/^total|total uses|total development/i.test(la.label)) return;
      budgetRows.push({
        label: la.label,
        amount: la.amount,
        category: categoryFor(la.label),
        sourceCellRef: `Sheet ${sheetName} row ${rowNumber}`,
        sourceText: `Uses: ${la.label} = $${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(la.amount)}`,
      });
    } else {
      const key = sourcesKeyFor(la.label);
      if (!key) return;
      const def = ASSUMPTION_BY_KEY[key];
      if (!def) return;
      scalars.push({
        field_key: def.key,
        value_numeric: la.amount,
        value_text: null,
        unit: def.unit,
        confidence: 90,
        source_doc_name: docName,
        source_text: `Sources: ${la.label} = $${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(la.amount)}`,
        source_location: `Sheet ${sheetName} row ${rowNumber}`,
        matched_alias: `sources_and_uses:${la.label.toLowerCase()}`,
        via: "alias",
        candidate_role: roleFor(def.key, def.unit),
      });
    }
  });

  return { budgetRows, scalars };
}

// ---------- 2C. Header mapping (deterministic consumer of a structure suggestion) ----------

// A header-text -> canonical-key suggestion. The value "ignore" (or any unknown
// key) is dropped. This is the ONLY thing an LLM may produce here: structure.
export type HeaderMappingSuggestion = Record<string, string>;
export type ColumnMapping = { columnIndex: number; field_key: string; header: string };

// An injectable boundary: the live implementation reuses the gated AI gateway and
// returns ONLY this structure map. Kept as a type so the deterministic consumer
// (and its tests) never depend on a model being present.
export type HeaderMappingSuggester = (headers: string[]) => Promise<HeaderMappingSuggestion>;

// Turn a header row + a suggested header->key map into column indices. A suggested
// key the taxonomy does not recognize is dropped (fail-closed). Deterministic.
export function applyHeaderMapping(headerRow: SheetRow, suggestion: HeaderMappingSuggestion): ColumnMapping[] {
  const out: ColumnMapping[] = [];
  const seen = new Set<string>();
  headerRow.forEach((cell, i) => {
    const header = String(cell ?? "").trim();
    if (!header) return;
    const raw = suggestion[header] ?? suggestion[header.toLowerCase()];
    if (!raw || raw === "ignore") return;
    const key = ASSUMPTION_BY_KEY[raw] ? raw : resolveAlias(raw);
    if (!key || !ASSUMPTION_BY_KEY[key] || seen.has(key)) return;
    seen.add(key);
    out.push({ columnIndex: i, field_key: key, header });
  });
  return out;
}

// ---------- Workbook entry point for the orchestrator ----------

export type StructuredWorkbook = {
  namedRanges: MappedCandidate[];
  sourcesUses: SourcesUsesResult;
};

export function parseStructuredWorkbook(buffer: ArrayBuffer, docName: string): StructuredWorkbook {
  const workbook = XLSX.read(buffer, { type: "array" });
  const namedRanges = parseNamedRanges(workbook, docName);
  const sourcesUses: SourcesUsesResult = { budgetRows: [], scalars: [] };
  for (const name of workbook.SheetNames) {
    const ws = workbook.Sheets[name];
    if (!ws) continue;
    const { rows } = readSheetRows(ws);
    const su = parseSourcesAndUses(rows, name, docName);
    sourcesUses.budgetRows.push(...su.budgetRows);
    sourcesUses.scalars.push(...su.scalars);
  }
  return { namedRanges, sourcesUses };
}
