import * as XLSX from "xlsx";
import { readSheetRows, selectSheets, type HeaderScorer, type SheetRow } from "./xlsx-utils";

export type ParsedRentRollRow = {
  unitType: string;
  tenant: string | null;
  unitCount: number;
  avgSf: number | null;
  // per_unit: $/unit/month; per_sf: ANNUAL $/SF.
  rent: number;
  rentBasis: "per_unit" | "per_sf";
  occupancyPct: number | null;
  sourceCellRef: string;
};

export type RentRollParseMeta = {
  sheetsScanned: number;
  sheetsSelected: string[];
  mergedCellsFilled: number;
};

export type RentRollParseResult = {
  inserted: ParsedRentRollRow[];
  rejected: { row: number; reason: string; values: (string | number | boolean | null)[] }[];
  meta: RentRollParseMeta;
};

// Match the rent/rate column but NOT lookalike headers such as "Rentable SF"
// (contains "rent"), "Rent Basis", or count columns.
const isRentHeader = (h: string) => /rent|rate/.test(h) && !/\bsf\b|square|basis|count|units|qty|gpr|egi/.test(h);

// Header heuristic for rent-roll tabs: a unit-type/component column, a count
// column, and a rent/rate column. A budget tab scores 0.
export const rentRollHeaderScore: HeaderScorer = (cells) => {
  let s = 0;
  if (cells.some((c) => /unit type|type|plan|component/.test(c))) s += 1;
  if (cells.some((c) => /count|units|qty/.test(c))) s += 1;
  if (cells.some((c) => isRentHeader(c))) s += 1;
  return s;
};

const parseNumeric = (cell: unknown): number =>
  typeof cell === "number" ? cell : Number(String(cell ?? "").replace(/[$,%\s]/g, ""));

// Parse one rent-roll sheet. Returns no rows when the sheet lacks the required
// type / count / rent columns, so a non-rent-roll tab contributes nothing.
function parseRentRollSheet(
  rows: SheetRow[],
  headerRowIndex: number,
  sheetName: string,
): { inserted: ParsedRentRollRow[]; rejected: RentRollParseResult["rejected"] } {
  const inserted: ParsedRentRollRow[] = [];
  const rejected: RentRollParseResult["rejected"] = [];
  const header = (rows[headerRowIndex] ?? []).map((cell) => String(cell ?? "").toLowerCase());
  const dataRows = rows.slice(headerRowIndex + 1);

  const typeIndex = header.findIndex((h) => /unit type|type|plan|component/.test(h));
  const countIndex = header.findIndex((h) => /count|units|qty/.test(h));
  const rentIndex = header.findIndex(isRentHeader);
  if (typeIndex < 0 || countIndex < 0 || rentIndex < 0) {
    return { inserted, rejected };
  }
  const tenantIndex = header.findIndex((h) => /tenant|lessee|occupant/.test(h));
  // Word-boundary \bsf\b so a rent column like "Rent PSF" (the "sf" inside
  // "psf") is NOT taken as the square-footage column; also exclude rent headers.
  const sfIndex = header.findIndex((h) => /\bsf\b|square/.test(h) && !isRentHeader(h));
  const rentBasisIndex = header.findIndex((h) => /basis|rent basis|billing/.test(h));
  const occupancyIndex = header.findIndex((h) => /occupanc|occ\.?\s|occ%|occ$/.test(h));
  const rentHeader = header[rentIndex] ?? "";
  const perSfRent = /psf|\/\s?sf|per\s?sf|per\s?square/.test(rentHeader);

  dataRows.forEach((row, i) => {
    const rowNumber = headerRowIndex + i + 2;
    const unitType = String(row[typeIndex] ?? "").trim();
    const tenant = tenantIndex >= 0 ? String(row[tenantIndex] ?? "").trim() || null : null;
    const unitCount = parseNumeric(row[countIndex] ?? 0);
    const avgSf = sfIndex >= 0 ? parseNumeric(row[sfIndex] ?? 0) || null : null;
    const rent = parseNumeric(row[rentIndex]);
    const occupancyRaw = occupancyIndex >= 0 ? parseNumeric(row[occupancyIndex]) : NaN;
    // Accept either 0-1 fractions or 0-100 percents from the sheet.
    const occupancyPct = Number.isFinite(occupancyRaw) && occupancyRaw > 0
      ? (occupancyRaw <= 1 ? occupancyRaw * 100 : occupancyRaw)
      : null;
    if (!unitType || !Number.isFinite(unitCount) || !Number.isFinite(rent) || rent <= 0) {
      rejected.push({ row: rowNumber, reason: "Missing unit type, count, or rent.", values: row });
      return;
    }
    const basisText = rentBasisIndex >= 0 ? String(row[rentBasisIndex] ?? "").toLowerCase() : "";
    const rentBasis: ParsedRentRollRow["rentBasis"] =
      /per[_\s-]*sf|psf|square/.test(basisText) ? "per_sf"
      : /per[_\s-]*unit|unit|month|mo/.test(basisText) ? "per_unit"
      : perSfRent && avgSf ? "per_sf" : "per_unit";
    inserted.push({
      unitType,
      tenant,
      unitCount: rentBasis === "per_sf" && unitCount <= 0 ? 1 : unitCount,
      avgSf,
      rent,
      rentBasis,
      occupancyPct,
      sourceCellRef: `Sheet ${sheetName} row ${rowNumber}`,
    });
  });

  return { inserted, rejected };
}

// Deterministic, row-typed parsing (never sheet_to_csv). Multi-row tables map
// to multi-row targets: each rent-roll component becomes its own
// revenue_program row with its own occupancy: never collapsed to a scalar.
// Scans every sheet and parses ALL rent-roll-shaped tabs (e.g. separate
// residential and commercial schedules), merging their rows.
export function parseRentRollWorkbook(buffer: ArrayBuffer): RentRollParseResult {
  const workbook = XLSX.read(buffer, { type: "array" });
  const selected = selectSheets(workbook, rentRollHeaderScore, { multi: true });
  const inserted: ParsedRentRollRow[] = [];
  const rejected: RentRollParseResult["rejected"] = [];
  let mergedCellsFilled = 0;
  const sheetsSelected: string[] = [];
  for (const sel of selected) {
    const ws = workbook.Sheets[sel.name];
    if (!ws) continue;
    const { rows, mergedCellsFilled: filled } = readSheetRows(ws);
    mergedCellsFilled += filled;
    const result = parseRentRollSheet(rows, sel.headerRowIndex, sel.name);
    if (result.inserted.length) sheetsSelected.push(sel.name);
    inserted.push(...result.inserted);
    rejected.push(...result.rejected);
  }
  return {
    inserted,
    rejected,
    meta: {
      sheetsScanned: workbook.SheetNames.length,
      sheetsSelected: sheetsSelected.length ? sheetsSelected : [selected[0]?.name].filter(Boolean) as string[],
      mergedCellsFilled,
    },
  };
}
