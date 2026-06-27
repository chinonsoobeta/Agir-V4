// Client-side PDF renderer for the Investment Committee Memorandum. Lays the
// structured MemoReport out to resemble the institutional reference: header/
// footer band, title block, summary stat strip, colored verdict banner, KPI
// card grid, bordered numbered tables, and engine/formula footnotes. jsPDF is
// dynamically imported so it never weighs down the initial bundle.

import type { MemoReport, ReportTable } from "./memo-report";

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

const INK: [number, number, number] = [22, 24, 30];
const MUTED: [number, number, number] = [110, 114, 126];
const LINE: [number, number, number] = [206, 209, 218];
const HEADBG: [number, number, number] = [243, 244, 247];
const BAND: [number, number, number] = [21, 25, 34];
const GOLD: [number, number, number] = [202, 150, 18];
const REJECT: [number, number, number] = [176, 38, 38];
const OK: [number, number, number] = [26, 110, 64];

export async function downloadMemoPdf(report: MemoReport, filename: string) {
  const ab = await renderMemoPdfArrayBuffer(report);
  triggerDownload(new Blob([ab], { type: "application/pdf" }), filename);
}

// Pure render → bytes (works in browser and Node). Used by the download wrapper
// and by verification/server-side rendering.
export async function renderMemoPdfArrayBuffer(report: MemoReport): Promise<ArrayBuffer> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 42;
  const contentW = W - 2 * M;
  let y = M;
  let page = 1;

  // RETURN_TO_UNDERWRITING is a negative outcome and must read red, like REJECT --
  // not the amber (GOLD) reserved for conditional approvals.
  const isNegative = report.verdict_code === "REJECT" || report.verdict_code === "RETURN_TO_UNDERWRITING";
  const verdictColor = isNegative ? REJECT : report.verdict_code === "APPROVE" ? OK : GOLD;

  const footer = () => {
    doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...MUTED);
    doc.text(`${report.header_band}: Page ${page}`, M, H - 22);
  };
  const ensure = (space: number) => {
    if (y + space > H - 40) { footer(); doc.addPage(); page += 1; y = M; }
  };

  // ---- Header band ----
  doc.setFillColor(...BAND);
  doc.rect(0, 0, W, 26, "F");
  doc.setTextColor(245, 246, 250).setFont("helvetica", "bold").setFontSize(8);
  doc.text("AGIR.PRO  ·  INVESTMENT COMMITTEE MEMORANDUM", M, 17);
  doc.setFont("helvetica", "normal");
  doc.text(report.prepared.toUpperCase(), W - M, 17, { align: "right" });
  y = 50;

  // ---- Title block ----
  doc.setTextColor(...INK).setFont("helvetica", "bold").setFontSize(20);
  doc.text(report.title, M, y);
  y += 22;
  doc.setFontSize(15).setTextColor(...GOLD);
  doc.text(report.project_name, M, y);
  y += 16;
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...MUTED);
  doc.text(`${report.subtitle}   ·   ${report.mode_label}`, M, y);
  y += 16;

  // ---- Summary stat strip ----
  const stats = report.summary_stats;
  if (stats.length) {
    const perRow = 3;
    const cellW = contentW / perRow;
    const cellH = 34;
    stats.forEach((s, i) => {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      if (col === 0) ensure(cellH);
      const cx = M + col * cellW;
      const cy = y + row * cellH;
      doc.setDrawColor(...LINE).setLineWidth(0.5).rect(cx, cy, cellW, cellH);
      doc.setFont("helvetica", "normal").setFontSize(6.5).setTextColor(...MUTED);
      doc.text(s.label.toUpperCase(), cx + 6, cy + 12);
      doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...INK);
      doc.text(s.value, cx + 6, cy + 26);
    });
    y += Math.ceil(stats.length / perRow) * cellH + 12;
  }

  // ---- Verdict banner ----
  ensure(40);
  doc.setFillColor(...verdictColor);
  doc.rect(M, y, contentW, 24, "F");
  doc.setTextColor(255, 255, 255).setFont("helvetica", "bold").setFontSize(11);
  doc.text(report.verdict_banner, M + 8, y + 16);
  y += 32;
  if (report.verdict_narrative) {
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...INK);
    const lines = doc.splitTextToSize(report.verdict_narrative, contentW);
    ensure(lines.length * 11 + 6);
    doc.text(lines, M, y);
    y += lines.length * 11 + 8;
  }

  // ---- KPI cards ----
  const cards = report.metric_cards;
  if (cards.length) {
    sectionHeading("Key Performance Metrics (Base Case)");
    const perRow = 4;
    const cellW = contentW / perRow;
    const cellH = 40;
    cards.forEach((c, i) => {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      if (col === 0) ensure(cellH);
      const cx = M + col * cellW;
      const cy = y + row * cellH;
      doc.setDrawColor(...LINE).setLineWidth(0.5).rect(cx, cy, cellW, cellH);
      doc.setFont("helvetica", "normal").setFontSize(6.5).setTextColor(...MUTED);
      doc.text(c.label.toUpperCase(), cx + 6, cy + 13);
      doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(...INK);
      doc.text(c.value, cx + 6, cy + 30);
    });
    y += Math.ceil(cards.length / perRow) * cellH + 12;
  }

  // ---- Numbered sections ----
  report.sections.forEach((sec, idx) => {
    sectionHeading(`${idx + 1}. ${sec.heading}`);
    if (sec.table) drawTable(sec.table);
    if (sec.body) {
      doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...INK);
      const lines = doc.splitTextToSize(sec.body, contentW);
      ensure(lines.length * 11);
      doc.text(lines, M, y);
      y += lines.length * 11 + 8;
    }
  });

  // ---- Footnotes ----
  if (report.footnotes.length) {
    ensure(20);
    doc.setDrawColor(...LINE).setLineWidth(0.5).line(M, y, W - M, y);
    y += 10;
    report.footnotes.forEach((f) => {
      doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...MUTED);
      const lines = doc.splitTextToSize(f, contentW);
      ensure(lines.length * 9 + 4);
      doc.text(lines, M, y);
      y += lines.length * 9 + 4;
    });
  }

  footer();
  return doc.output("arraybuffer");

  // ---- helpers ----
  function sectionHeading(text: string) {
    ensure(24);
    doc.setFillColor(...HEADBG);
    doc.rect(M, y, contentW, 18, "F");
    doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(...INK);
    doc.text(text.toUpperCase(), M + 6, y + 12.5);
    y += 24;
  }

  function drawTable(table: ReportTable) {
    const cols = table.columns.length;
    // First column wider for labels.
    const weights = table.columns.map((_, i) => (i === 0 ? 1.8 : 1));
    const totalW = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / totalW) * contentW);
    const pad = 4;
    const lh = cols > 4 ? 8.5 : 9.5;
    // Denser tables (revenue build, scenario analysis) use a smaller font so
    // short source labels and figures stay on one line.
    const bodyFont = cols > 4 ? 7 : 8;
    const headFont = cols > 4 ? 6.8 : 7.5;

    const drawRow = (cells: string[], opts: { header?: boolean }) => {
      const wrapped = cells.map((c, i) =>
        doc.splitTextToSize(String(c ?? ""), widths[i] - 2 * pad));
      const rowH = Math.max(...wrapped.map((w) => w.length)) * lh + 2 * pad;
      ensure(rowH);
      let cx = M;
      if (opts.header) { doc.setFillColor(...HEADBG); doc.rect(M, y, contentW, rowH, "F"); }
      doc.setDrawColor(...LINE).setLineWidth(0.4);
      cells.forEach((_, i) => {
        doc.rect(cx, y, widths[i], rowH);
        doc.setFont("helvetica", opts.header ? "bold" : "normal").setFontSize(opts.header ? headFont : bodyFont);
        doc.setTextColor(...(opts.header ? MUTED : INK));
        // Right-align numeric-looking non-first columns.
        const txt = wrapped[i];
        const isNum = i > 0 && /^[\(\-$]?[\d.,]/.test(String(cells[i]).trim());
        if (isNum) doc.text(txt, cx + widths[i] - pad, y + pad + lh - 2, { align: "right" });
        else doc.text(txt, cx + pad, y + pad + lh - 2);
        cx += widths[i];
      });
      y += rowH;
    };

    drawRow(table.columns, { header: true });
    table.rows.forEach((r) => drawRow(r, {}));
    if (table.note) {
      doc.setFont("helvetica", "italic").setFontSize(6.8).setTextColor(...MUTED);
      const lines = doc.splitTextToSize(`Note: ${table.note}`, contentW);
      ensure(lines.length * 8 + 4);
      doc.text(lines, M, y + 8);
      y += lines.length * 8 + 10;
    } else {
      y += 8;
    }
  }
}
