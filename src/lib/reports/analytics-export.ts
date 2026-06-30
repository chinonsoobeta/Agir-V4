// Export helpers for analytics reports and the comparison grid.
//
// CSV is pure (numbers stay raw so a spreadsheet imports them as numbers). XLSX
// uses the project's `xlsx` dependency with real numeric cells + number formats
// (never a screenshot or pre-formatted strings). PDF uses jspdf. Both heavy
// libraries are dynamically imported so they stay out of the initial bundle.

import type {
  AnalyticsReport,
  ReportColumn,
  ReportColumnType,
  ReportCell,
} from "./portfolio-analytics";

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const isNumeric = (t: ReportColumnType) =>
  t === "integer" || t === "number" || t === "currency" || t === "percent" || t === "multiple";

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Pure CSV. Numeric cells emit raw numbers; a title + "data as of" preface the table. */
export function reportToCsv(report: AnalyticsReport, title: string, asOf: string): string {
  const lines: string[] = [];
  lines.push(csvEscape(title));
  lines.push(`Data as of,${csvEscape(asOf)}`);
  lines.push("");
  lines.push(report.columns.map((c) => csvEscape(c.label)).join(","));
  for (const row of report.rows) {
    lines.push(
      report.columns
        .map((c) => {
          const v = row.cells[c.key];
          if (v == null || v === "") return "";
          return isNumeric(c.type) && typeof v === "number" ? String(v) : csvEscape(String(v));
        })
        .join(","),
    );
  }
  if (report.summary.length) {
    lines.push("");
    lines.push("Summary");
    for (const s of report.summary) {
      const v = typeof s.value === "number" ? String(s.value) : csvEscape(String(s.value ?? ""));
      lines.push(`${csvEscape(s.label)},${v}`);
    }
  }
  return lines.join("\n");
}

const NUM_FORMAT: Record<ReportColumnType, string | undefined> = {
  text: undefined,
  date: undefined,
  integer: "#,##0",
  number: "#,##0.00",
  currency: "$#,##0",
  percent: '0.0"%"', // values are already in percent units; literal % avoids Excel ×100
  multiple: '0.00"x"',
};

function cellValue(v: ReportCell, type: ReportColumnType) {
  if (v == null || v === "") return { t: "s", v: "" };
  if (isNumeric(type) && typeof v === "number") {
    const fmt = NUM_FORMAT[type];
    return fmt ? { t: "n", v, z: fmt } : { t: "n", v };
  }
  return { t: "s", v: String(v) };
}

export async function downloadReportXlsx(
  report: AnalyticsReport,
  title: string,
  asOf: string,
  filename: string,
) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  // Data sheet built cell-by-cell so numbers are genuine numeric cells.
  const header = report.columns.map((c) => c.label);
  const aoa: (string | number)[][] = [[title], [`Data as of: ${asOf}`], [], header];
  const dataStartRow = aoa.length; // 0-based row index of first data row
  for (const row of report.rows) aoa.push(report.columns.map((c) => row.cells[c.key] ?? ""));
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Apply numeric cell types + formats to the data region.
  report.rows.forEach((row, ri) => {
    report.columns.forEach((col: ReportColumn, ci) => {
      const addr = XLSX.utils.encode_cell({ r: dataStartRow + ri, c: ci });
      ws[addr] = cellValue(row.cells[col.key] ?? "", col.type);
    });
  });
  ws["!cols"] = report.columns.map((c) => ({ wch: Math.max(12, c.label.length + 2) }));
  XLSX.utils.book_append_sheet(wb, ws, "Data");

  if (report.summary.length) {
    const sAoa: (string | number)[][] = [["Summary"], []];
    const sStart = sAoa.length;
    for (const s of report.summary) sAoa.push([s.label, s.value ?? ""]);
    const sws = XLSX.utils.aoa_to_sheet(sAoa);
    report.summary.forEach((s, ri) => {
      sws[XLSX.utils.encode_cell({ r: sStart + ri, c: 1 })] = cellValue(s.value, s.type);
    });
    sws["!cols"] = [{ wch: 32 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, sws, "Summary");
  }

  const ab = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  triggerDownload(
    new Blob([ab], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    filename,
  );
}

/** Display formatting for PDF cells (locale-light; keeps export self-contained). */
function fmtForPdf(v: ReportCell, type: ReportColumnType): string {
  if (v == null || v === "") return "Not available";
  if (typeof v !== "number") return String(v);
  switch (type) {
    case "currency":
      return v >= 1_000_000
        ? `$${(v / 1_000_000).toFixed(1)}M`
        : `$${Math.round(v).toLocaleString()}`;
    case "percent":
      return `${v.toFixed(1)}%`;
    case "multiple":
      return `${v.toFixed(2)}x`;
    case "integer":
      return String(Math.round(v));
    default:
      return String(v);
  }
}

export async function downloadReportPdf(
  report: AnalyticsReport,
  title: string,
  asOf: string,
  filename: string,
) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 36;
  let y = margin;

  doc.setFontSize(15);
  doc.text(title, margin, y);
  y += 16;
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Data as of ${asOf}  ·  ${report.formula}`, margin, y, { maxWidth: pageW - margin * 2 });
  doc.setTextColor(0);
  y += 22;

  const cols = report.columns;
  const usableW = pageW - margin * 2;
  const colW = usableW / cols.length;

  const drawHeader = () => {
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    cols.forEach((c, i) => doc.text(c.label, margin + i * colW, y, { maxWidth: colW - 4 }));
    doc.setFont("helvetica", "normal");
    y += 6;
    doc.setDrawColor(200);
    doc.line(margin, y, pageW - margin, y);
    y += 10;
  };
  drawHeader();

  doc.setFontSize(8);
  for (const row of report.rows) {
    if (y > pageH - margin) {
      doc.addPage();
      y = margin;
      drawHeader();
    }
    cols.forEach((c, i) =>
      doc.text(fmtForPdf(row.cells[c.key] ?? "", c.type), margin + i * colW, y, {
        maxWidth: colW - 4,
      }),
    );
    y += 14;
  }

  doc.save(filename);
}
