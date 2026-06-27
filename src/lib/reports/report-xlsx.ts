// Client-side XLSX renderer for reports. Each report section becomes its own
// worksheet tab (table -> header + rows; prose -> single column), preceded by a
// Summary tab. Uses the project's `xlsx` dependency. Dynamically imported so it
// stays out of the initial bundle.

import type { MemoReport } from "../memo-report";

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

// Excel sheet names: <=31 chars, no : \ / ? * [ ], unique.
function sheetName(used: Set<string>, raw: string): string {
  const base =
    raw
      .replace(/[:\\/?*[\]]/g, " ")
      .trim()
      .slice(0, 28) || "Sheet";
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    name = `${base.slice(0, 26)} ${n++}`;
  }
  used.add(name.toLowerCase());
  return name;
}

export function buildReportWorkbook(XLSX: any, report: MemoReport) {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();

  // Summary tab: title, project, verdict, stats, KPI cards.
  const summaryAoa: any[][] = [
    [report.title],
    [report.project_name],
    [report.subtitle ?? ""],
    [report.prepared ?? ""],
    [],
    ["Verdict", report.verdict_code],
    [report.verdict_banner],
    [],
    ...report.summary_stats.map((s) => [s.label, s.value]),
    ...(report.metric_cards.length ? [[], ["Key metrics"]] : []),
    ...report.metric_cards.map((c) => [c.label, c.value]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryAoa), sheetName(used, "Summary"));

  for (const sec of report.sections) {
    let aoa: any[][];
    if (sec.table) {
      aoa = [sec.table.columns, ...sec.table.rows];
      if (sec.table.note) aoa.push([], [`Note: ${sec.table.note}`]);
    } else {
      aoa = [
        [sec.heading],
        ...String(sec.body ?? "")
          .split("\n")
          .map((line) => [line]),
      ];
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName(used, sec.heading));
  }

  // Disclosure tab.
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(report.footnotes.map((f) => [f])),
    sheetName(used, "Disclosure"),
  );
  return wb;
}

export async function renderReportXlsxArrayBuffer(report: MemoReport): Promise<ArrayBuffer> {
  const XLSX = await import("xlsx");
  const wb = buildReportWorkbook(XLSX, report);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

export async function downloadReportXlsx(report: MemoReport, filename: string) {
  const ab = await renderReportXlsxArrayBuffer(report);
  triggerDownload(
    new Blob([ab], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    filename,
  );
}
