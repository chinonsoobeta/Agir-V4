// Locale-aware display formatting for report/comparison cells. Keeps numbers as
// numbers in the data model and only formats at render time, so the same row can
// be exported (raw numeric cells) or displayed (localized strings).

import type { Formatters } from "../i18n";
import type { ReportCell, ReportColumnType } from "./portfolio-analytics";

export function formatReportCell(
  value: ReportCell,
  type: ReportColumnType,
  fmt: Formatters,
): string {
  if (value == null || value === "") return "Not available";
  if (typeof value !== "number") {
    if (type === "date") return fmt.date(value);
    return String(value);
  }
  switch (type) {
    case "currency":
      return fmt.compactCurrency(value);
    case "percent":
      return fmt.percent(value, 1);
    case "multiple":
      return fmt.multiple(value);
    case "integer":
      return fmt.number(value, { maximumFractionDigits: 0 });
    case "number":
      return fmt.number(value, { maximumFractionDigits: 2 });
    case "date":
      return fmt.date(value);
    default:
      return String(value);
  }
}

export function isRightAligned(type: ReportColumnType): boolean {
  return type !== "text";
}
