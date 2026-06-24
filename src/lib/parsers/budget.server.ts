import * as XLSX from "xlsx";

export type ParsedBudgetRow = {
  label: string;
  amount: number;
  category: "land" | "hard" | "soft" | "contingency" | "financing_interest" | "other";
  sourceCellRef: string;
  sourceText: string;
};

export type BudgetParseResult = {
  inserted: ParsedBudgetRow[];
  rejected: { row: number; reason: string; values: unknown[] }[];
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

export function parseBudgetWorkbook(buffer: ArrayBuffer): BudgetParseResult {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  const inserted: ParsedBudgetRow[] = [];
  const rejected: BudgetParseResult["rejected"] = [];

  const header = rows[0]?.map((cell) => String(cell ?? "").toLowerCase()) ?? [];
  const categoryIndex = header.findIndex((h) => /category/.test(h));
  const itemIndex = header.findIndex((h) => /item|description|label/.test(h));
  const labelIndex = itemIndex >= 0 ? itemIndex : Math.max(0, categoryIndex);
  // Amount column: among money-named headers, prefer one whose DATA cells are
  // actually numeric: a *label* column named "Total Project Cost" or "Cost
  // Item" must never be mistaken for the dollar column. Fall back to the last
  // money-named header, then the first numeric column.
  const dataRows = rows.slice(1);
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
  if (amountIndex < 0) amountIndex = Math.max(1, header.findIndex((h) => /amount|cost|budget|total/.test(h)));

  rows.slice(1).forEach((row, i) => {
    const rowNumber = i + 2;
    const categoryLabel = categoryIndex >= 0 ? String(row[categoryIndex] ?? "").trim() : "";
    const itemLabel = String(row[labelIndex] ?? "").trim();
    const label = itemLabel || categoryLabel;
    const rawAmount = row[amountIndex];
    const amount = typeof rawAmount === "number" ? rawAmount : Number(String(rawAmount ?? "").replace(/[$,]/g, ""));
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
      sourceCellRef: `Sheet ${workbook.SheetNames[0]} row ${rowNumber}`,
      sourceText: [
        categoryLabel ? `Category=${categoryLabel}` : null,
        label ? `Line Item=${label}` : null,
        `Amount=$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(amount)}`,
      ].filter(Boolean).join(" | "),
    });
  });

  return { inserted, rejected };
}
