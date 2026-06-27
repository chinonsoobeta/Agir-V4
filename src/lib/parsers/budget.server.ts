import * as XLSX from "xlsx";
import { detectMoneyScale } from "../money-scale";
import { readSheetRows, selectSheets, type HeaderScorer, type SheetRow } from "./xlsx-utils";

export type ParsedBudgetRow = {
  label: string;
  amount: number;
  category: "land" | "hard" | "soft" | "contingency" | "financing_interest" | "other";
  sourceCellRef: string;
  sourceText: string;
};

export type BudgetParseMeta = {
  sheetsScanned: number;
  sheetSelected: string;
  headerRow: number; // 1-indexed for human reading
  mergedCellsFilled: number;
};

export type BudgetParseResult = {
  inserted: ParsedBudgetRow[];
  rejected: { row: number; reason: string; values: (string | number | boolean | null)[] }[];
  meta: BudgetParseMeta;
};

export function categoryFor(label: string): ParsedBudgetRow["category"] {
  const normalized = label.toLowerCase();
  if (/^other\b/.test(normalized)) return "other";
  // Reserves and offsite/infrastructure go to "other": checked BEFORE land so
  // "offsite" (contains "site") and "environmental" are not miscategorised.
  if (/environmental|remediation|pfas|\besa\b/.test(normalized)) return "other";
  if (/off[\s-]?site|public road|infrastructure|municipal|substation|stormwater/.test(normalized)) return "other";
  if (/contingenc/.test(normalized)) return "contingency";
  if (/interest|financing|loan fee|lender|capitalized interest/.test(normalized)) return "financing_interest";
  if (/hard|construction|gmp|sitework|building|shell/.test(normalized)) return "hard";
  if (/soft|design|architect|engineering|permit|legal|consulting|developer fee|leasing|tenant improvement|\bti\b|\blc\b/.test(normalized)) return "soft";
  if (/land|acquisition/.test(normalized)) return "land";
  return "other";
}

// Header heuristic for budget tabs: a money-named amount column plus a
// category/line-item label column. A rent-roll tab (unit type / count / rent)
// scores 0, so it is never mistaken for the budget.
export const budgetHeaderScore: HeaderScorer = (cells) => {
  let s = 0;
  const has = (re: RegExp) => cells.some((c) => re.test(c));
  if (has(/amount|cost|budget|\$|^total$|value/)) s += 2;
  if (has(/category/)) s += 1;
  if (has(/item|description|label/)) s += 1;
  return s;
};

// Parse a single budget sheet given its rows and the detected header-row index.
function parseBudgetSheet(
  rows: SheetRow[],
  headerRowIndex: number,
  sheetName: string,
): { inserted: ParsedBudgetRow[]; rejected: BudgetParseResult["rejected"] } {
  const inserted: ParsedBudgetRow[] = [];
  const rejected: BudgetParseResult["rejected"] = [];
  const headerRow = rows[headerRowIndex] ?? [];
  const header = headerRow.map((cell) => String(cell ?? "").toLowerCase());
  const dataRows = rows.slice(headerRowIndex + 1);

  const categoryIndex = header.findIndex((h) => /category/.test(h));
  const itemIndex = header.findIndex((h) => /item|description|label/.test(h));
  const labelIndex = itemIndex >= 0 ? itemIndex : Math.max(0, categoryIndex);
  // Amount column: among money-named headers, prefer one whose DATA cells are
  // actually numeric: a *label* column named "Total Project Cost" or "Cost
  // Item" must never be mistaken for the dollar column. Fall back to the last
  // money-named header, then the first numeric column.
  const numericShare = (i: number) => {
    const vals = dataRows.map((r) => r[i]).filter((c) => c != null && String(c).trim() !== "");
    if (!vals.length) return 0;
    const n = vals.filter((c) => Number.isFinite(typeof c === "number" ? c : Number(String(c).replace(/[$,%\s]/g, "")))).length;
    return n / vals.length;
  };
  const moneyCols = header
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) => i !== labelIndex && i !== categoryIndex && /amount|cost|budget|total|value|\$/.test(h));
  let amountIndex =
    moneyCols.find(({ i }) => numericShare(i) >= 0.6)?.i ??
    (moneyCols.length ? moneyCols[moneyCols.length - 1].i : -1);
  if (amountIndex < 0) amountIndex = header.findIndex((_, i) => i !== labelIndex && i !== categoryIndex && numericShare(i) >= 0.6);
  // No identifiable amount column (no money-named header, no column whose data is
  // >=60% numeric): never guess a column. The previous `Math.max(1, -1)` forced
  // column 1, so a non-money column (a phase number, code, or year) could be read
  // as dollar amounts -- fabricating budget figures, the one thing the platform
  // must never do. Reject every row so a malformed sheet yields nothing instead.
  if (amountIndex < 0) {
    return {
      inserted,
      rejected: dataRows.map((row, i) => ({
        row: headerRowIndex + i + 2,
        reason: "No amount column could be identified; rows skipped to avoid fabricating budget figures.",
        values: row,
      })),
    };
  }

  // Honor a declared scale ("$ in thousands / millions") from the amount-column
  // header first, then the sheet name, the header row, and any caption/title
  // rows ABOVE the header (a merged "$ in thousands" banner is common).
  const amountHeader = amountIndex >= 0 ? String(headerRow[amountIndex] ?? "") : "";
  const columnScale = detectMoneyScale(amountHeader);
  const captionCells = rows.slice(0, headerRowIndex + 1).flat().map((c) => String(c ?? ""));
  const scale =
    columnScale !== 1
      ? columnScale
      : detectMoneyScale([sheetName, ...captionCells].join(" "));
  const scaleLabel = scale === 1_000 ? "thousands" : scale === 1_000_000 ? "millions" : scale === 1_000_000_000 ? "billions" : null;

  dataRows.forEach((row, i) => {
    const rowNumber = headerRowIndex + i + 2;
    const categoryLabel = categoryIndex >= 0 ? String(row[categoryIndex] ?? "").trim() : "";
    const itemLabel = String(row[labelIndex] ?? "").trim();
    const label = itemLabel || categoryLabel;
    const rawAmount = row[amountIndex];
    const parsedAmount = typeof rawAmount === "number" ? rawAmount : Number(String(rawAmount ?? "").replace(/[$,]/g, ""));
    const amount = Number.isFinite(parsedAmount) ? parsedAmount * scale : parsedAmount;
    if (/^total$/i.test(categoryLabel) || /total development cost|^total$/i.test(label)) {
      rejected.push({ row: rowNumber, reason: "Total row skipped to avoid double counting.", values: row });
      return;
    }
    if (!label || !Number.isFinite(amount)) {
      rejected.push({ row: rowNumber, reason: "Missing label or numeric amount.", values: row });
      return;
    }
    const category = categoryFor(categoryLabel || label);
    inserted.push({
      label,
      amount,
      category,
      sourceCellRef: `Sheet ${sheetName} row ${rowNumber}`,
      sourceText: [
        categoryLabel ? `Category=${categoryLabel}` : null,
        label ? `Line Item=${label}` : null,
        `Amount=$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(amount)}`,
        scaleLabel ? `Scale=${scaleLabel}` : null,
      ].filter(Boolean).join(" | "),
    });
  });

  return { inserted, rejected };
}

export function parseBudgetWorkbook(buffer: ArrayBuffer): BudgetParseResult {
  const workbook = XLSX.read(buffer, { type: "array" });
  // A workbook may carry several tabs (summary, detail, rent roll). Pick the
  // single best budget tab by header heuristics; summing multiple budget tabs
  // would risk double counting a summary against its detail, so budget stays
  // single-sheet (selected, not assumed to be the first tab).
  const [selected] = selectSheets(workbook, budgetHeaderScore);
  const ws = workbook.Sheets[selected.name];
  const { rows, mergedCellsFilled } = readSheetRows(ws);
  const { inserted, rejected } = parseBudgetSheet(rows, selected.headerRowIndex, selected.name);
  return {
    inserted,
    rejected,
    meta: {
      sheetsScanned: workbook.SheetNames.length,
      sheetSelected: selected.name,
      headerRow: selected.headerRowIndex + 1,
      mergedCellsFilled,
    },
  };
}
