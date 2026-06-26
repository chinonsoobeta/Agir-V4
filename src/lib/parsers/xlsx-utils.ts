// Shared, deterministic helpers for reading messy real-world workbooks.
//
// These do not invent or alter any value: they recover MORE structure (merged
// ranges, the correct sheet, the real header row) so the existing typed parsers
// see the cells a human would. Every number still comes from a literal cell.

import * as XLSX from "xlsx";

export type SheetCell = string | number | boolean | null;
export type SheetRow = SheetCell[];

// 2C. Merged cells. XLSX stores a merged range's value only in its top-left
// (anchor) cell; the spanned cells are empty. When that range covers a label or
// amount, header:1 row arrays drop it and downstream column indices shift.
// Propagate the anchor value into every spanned cell so labels/amounts survive
// and column positions stay stable. Returns the number of cells filled (for the
// debug trace). Mutates the worksheet in place.
export function fillMergedCells(ws: XLSX.WorkSheet): number {
  const merges = ws["!merges"];
  if (!Array.isArray(merges) || merges.length === 0) return 0;
  let filled = 0;
  for (const m of merges) {
    const anchor = ws[XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c })];
    if (anchor == null) continue;
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (r === m.s.r && c === m.s.c) continue;
        const ref = XLSX.utils.encode_cell({ r, c });
        if (ws[ref] == null) {
          // Copy the anchor cell (value + type) so sheet_to_json reads it back.
          ws[ref] = { t: anchor.t, v: anchor.v, w: anchor.w };
          filled++;
        }
      }
    }
  }
  return filled;
}

// Read a worksheet to a 2-D array WITHOUT mutating it (no merge propagation).
// Used for sheet selection / header detection so scoring never pre-fills the
// merges that the real parse then needs to count.
export function readSheetRowsRaw(ws: XLSX.WorkSheet): SheetRow[] {
  return XLSX.utils.sheet_to_json<SheetRow>(ws, { header: 1, blankrows: false });
}

// Read a worksheet to a 2-D array AFTER propagating merged cells. blankrows are
// dropped (matching the existing parsers) so the header heuristics are stable.
export function readSheetRows(ws: XLSX.WorkSheet): { rows: SheetRow[]; mergedCellsFilled: number } {
  const mergedCellsFilled = fillMergedCells(ws);
  const rows = XLSX.utils.sheet_to_json<SheetRow>(ws, { header: 1, blankrows: false });
  return { rows, mergedCellsFilled };
}

// A header scorer inspects a row's lowercased, trimmed cells and returns a
// positive score when the row looks like the header of the target table (higher
// = better match). 0 means "not this table".
export type HeaderScorer = (cells: string[]) => number;

const lower = (row: SheetRow | undefined): string[] => (row ?? []).map((c) => String(c ?? "").trim().toLowerCase());

// Real workbooks often put a merged title / "$ in thousands" caption above the
// real header row. Scan the first few rows and pick the best-scoring one as the
// header, so a title row never gets mistaken for the columns. Ties resolve to
// the earliest row. Returns 0 when nothing scores (today's assumption).
export function findHeaderRow(rows: SheetRow[], scorer: HeaderScorer, maxScan = 6): number {
  let bestIndex = 0;
  let bestScore = -1;
  const scan = Math.min(maxScan, rows.length);
  for (let i = 0; i < scan; i++) {
    const score = scorer(lower(rows[i]));
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestScore > 0 ? bestIndex : 0;
}

export type SelectedSheet = { name: string; headerRowIndex: number; score: number };

// 2B. Multi-sheet selection. Score every sheet by its best header row and return
// the qualifying sheet(s), best-first. multi=false returns just the single best
// sheet; multi=true returns every sheet that scores above 0 (e.g. separate
// residential / commercial rent-roll tabs that should both be parsed). Always
// falls back to the first sheet so a workbook never silently yields nothing,
// preserving today's behavior for a single-sheet book.
export function selectSheets(
  workbook: XLSX.WorkBook,
  scorer: HeaderScorer,
  opts: { multi?: boolean } = {},
): SelectedSheet[] {
  const scored: SelectedSheet[] = workbook.SheetNames.map((name) => {
    const ws = workbook.Sheets[name];
    if (!ws) return { name, headerRowIndex: 0, score: 0 };
    // Score on a NON-mutating read so the real parse still sees (and counts) the
    // merged ranges. Filling indices does not change row order, so the header
    // index computed here is valid for the filled rows too.
    const rows = readSheetRowsRaw(ws);
    const headerRowIndex = findHeaderRow(rows, scorer);
    return { name, headerRowIndex, score: scorer(lower(rows[headerRowIndex])) };
  });
  const qualifying = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  if (qualifying.length === 0) {
    return [{ name: workbook.SheetNames[0], headerRowIndex: 0, score: 0 }];
  }
  return opts.multi ? qualifying : [qualifying[0]];
}
