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

// Match the rent/rate column. Uses \brent\b so "Rentable SF" (the word
// "rentable", not "rent") is NOT taken as rent. Crucially it does NOT exclude
// "sf"/"square": the most common commercial rent header states its basis inline
// ("Rent ($/SF)", "Rent/SF", "Base Rent $/SF/yr") and previously those were
// dropped, silently zeroing retail/office revenue. Count/basis columns are still
// excluded so they are not mistaken for the rent column.
const isRentHeader = (h: string) =>
  /\brent\b|\brate\b/.test(h) && !/basis|count|\bunits\b|qty|gpr|egi/.test(h);

// Header heuristic for rent-roll tabs: a unit-type/component column, a count
// column, and a rent/rate column. A budget tab scores 0.
export const rentRollHeaderScore: HeaderScorer = (cells) => {
  let s = 0;
  if (cells.some((c) => /unit type|type|plan|component/.test(c))) s += 1;
  if (cells.some((c) => /count|units|qty/.test(c))) s += 1;
  if (cells.some((c) => isRentHeader(c))) s += 1;
  return s;
};

const parseNumeric = (cell: unknown): number => {
  if (cell == null || String(cell).trim() === "") return NaN;
  return typeof cell === "number" ? cell : Number(String(cell).replace(/[$,%\s]/g, ""));
};

function isSubtotalOrTotalRow(unitType: string, row: SheetRow): boolean {
  const rowText = row
    .map((cell) => String(cell ?? ""))
    .join(" ")
    .toLowerCase();
  return /\b(?:sub\s*total|subtotal|grand total|total)\b/.test(`${unitType} ${rowText}`);
}

function aggregateRentRollRows(rows: ParsedRentRollRow[]): ParsedRentRollRow[] {
  const groups = new Map<string, ParsedRentRollRow[]>();
  for (const row of rows) {
    const key = `${row.unitType.toLowerCase()}|${row.rentBasis}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const out: ParsedRentRollRow[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    const first = group[0];
    const sfTotal = group.reduce((sum, row) => sum + (row.avgSf ?? 0), 0);
    const unitTotal = group.reduce((sum, row) => sum + row.unitCount, 0);
    const weightFor = (row: ParsedRentRollRow) =>
      row.rentBasis === "per_sf" && row.avgSf ? row.avgSf : row.unitCount;
    const weightTotal = group.reduce((sum, row) => sum + weightFor(row), 0);
    const weighted = (pick: (row: ParsedRentRollRow) => number | null) => {
      if (weightTotal <= 0) return null;
      let total = 0;
      let seen = false;
      for (const row of group) {
        const value = pick(row);
        if (value == null || !Number.isFinite(value)) continue;
        total += value * weightFor(row);
        seen = true;
      }
      return seen ? total / weightTotal : null;
    };
    out.push({
      unitType: first.unitType,
      tenant:
        group
          .map((row) => row.tenant)
          .filter(Boolean)
          .join(", ") || null,
      unitCount: unitTotal || first.unitCount,
      avgSf: sfTotal || first.avgSf,
      rent: weighted((row) => row.rent) ?? first.rent,
      rentBasis: first.rentBasis,
      occupancyPct: weighted((row) => row.occupancyPct),
      sourceCellRef: group.map((row) => row.sourceCellRef).join("; "),
    });
  }
  return out;
}

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
  // Word-boundary \bsf\b so a rent column like "Rent PSF" (the "sf" inside
  // "psf") is NOT taken as the square-footage column; also exclude rent headers.
  const sfIndex = header.findIndex(
    (h) => /\bsf\b|square|rentable area|\barea\b|\brsf\b|\bgla\b/.test(h) && !isRentHeader(h),
  );
  // A commercial schedule is keyed by SF, not a unit count: accept a sheet that
  // has a type + rent column and EITHER a count or an SF column. (Requiring a
  // count column silently zeroed every retail/office rent roll.)
  if (typeIndex < 0 || rentIndex < 0 || (countIndex < 0 && sfIndex < 0)) {
    return { inserted, rejected };
  }
  const tenantIndex = header.findIndex((h) => /tenant|lessee|occupant/.test(h));
  const rentBasisIndex = header.findIndex((h) => /basis|rent basis|billing/.test(h));
  const occupancyIndex = header.findIndex((h) => /occupanc|occ\.?\s|occ%|occ$/.test(h));
  const rentHeader = header[rentIndex] ?? "";
  const perSfRent = /psf|\/\s?sf|per\s?sf|per\s?square/.test(rentHeader);

  dataRows.forEach((row, i) => {
    const rowNumber = headerRowIndex + i + 2;
    const unitType = String(row[typeIndex] ?? "").trim();
    if (!unitType) return;
    if (isSubtotalOrTotalRow(unitType, row)) {
      rejected.push({ row: rowNumber, reason: "Subtotal or total row.", values: row });
      return;
    }
    const tenant = tenantIndex >= 0 ? String(row[tenantIndex] ?? "").trim() || null : null;
    const rawUnitCount = countIndex >= 0 ? parseNumeric(row[countIndex]) : NaN;
    const avgSf = sfIndex >= 0 ? parseNumeric(row[sfIndex] ?? 0) || null : null;
    const rent = parseNumeric(row[rentIndex]);
    const occupancyRaw = occupancyIndex >= 0 ? parseNumeric(row[occupancyIndex]) : NaN;
    // Accept either 0-1 fractions or 0-100 percents from the sheet. A reported
    // 0% (a vacant / just-delivered component) is a real value, not "unknown":
    // keep it as 0 rather than null so revenue is not silently assumed stabilized.
    const occupancyPct = !Number.isFinite(occupancyRaw)
      ? null
      : occupancyRaw > 0 && occupancyRaw <= 1
        ? occupancyRaw * 100
        : occupancyRaw;
    const basisText = rentBasisIndex >= 0 ? String(row[rentBasisIndex] ?? "").toLowerCase() : "";
    const rentBasis: ParsedRentRollRow["rentBasis"] =
      /per[_\s-]*sf|psf|\$?\s*\/\s*sf|sf\s*\/\s*yr|square/.test(basisText)
        ? "per_sf"
        : /per[_\s-]*unit|unit|month|mo/.test(basisText)
          ? "per_unit"
          : perSfRent && avgSf
            ? "per_sf"
            : "per_unit";
    const annualOtherIncome =
      /other income|ancillary|parking|solar/.test(unitType.toLowerCase()) &&
      /annual|year|yr/.test(basisText);
    // Blank unit cells are normal in commercial SF-keyed schedules. Treat each
    // per-SF row as one suite, but keep residential/unit schedules strict.
    const unitCount =
      Number.isFinite(rawUnitCount) && rawUnitCount > 0
        ? rawUnitCount
        : annualOtherIncome
          ? 1
          : rentBasis === "per_sf"
            ? 1
            : NaN;
    if (!Number.isFinite(unitCount) || !Number.isFinite(rent) || rent <= 0) {
      rejected.push({ row: rowNumber, reason: "Missing unit type, count, or rent.", values: row });
      return;
    }
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
    inserted: aggregateRentRollRows(inserted),
    rejected,
    meta: {
      sheetsScanned: workbook.SheetNames.length,
      sheetsSelected: sheetsSelected.length
        ? sheetsSelected
        : ([selected[0]?.name].filter(Boolean) as string[]),
      mergedCellsFilled,
    },
  };
}
