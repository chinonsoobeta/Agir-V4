// Client-side DOCX renderer for the Investment Committee Memorandum, mirroring
// the PDF layout (title block, summary stats, colored verdict banner, KPI grid,
// numbered bordered tables, footnotes) using the `docx` library. Produced
// entirely in the browser via Packer.toBlob; the library is dynamically
// imported so it stays out of the initial bundle.

import type { MemoReport, ReportTable } from "./memo-report";
import { provenanceManifestText } from "./reports/provenance-manifest";

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

const GOLD = "C99612";
const INK = "16181E";
const MUTED = "6E727E";
const HEADBG = "F3F4F7";

export async function downloadMemoDocx(report: MemoReport, filename: string) {
  const b64 = await renderMemoDocxBase64(report);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  triggerDownload(
    new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
    filename,
  );
}

// Pure render → base64 (works in browser and Node). Used by the download
// wrapper and by verification/server-side rendering.
export async function renderMemoDocxBase64(report: MemoReport): Promise<string> {
  const docx = await import("docx");
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    Table,
    TableRow,
    TableCell,
    WidthType,
    AlignmentType,
    BorderStyle,
    HeadingLevel,
  } = docx;

  const thinBorder = { style: BorderStyle.SINGLE, size: 4, color: "CED1DA" };
  const cellBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

  // RETURN_TO_UNDERWRITING reads red like REJECT (a negative outcome), not the
  // amber reserved for conditional approvals.
  const verdictNegative =
    report.verdict_code === "REJECT" || report.verdict_code === "RETURN_TO_UNDERWRITING";
  const verdictFill = verdictNegative
    ? "B02626"
    : report.verdict_code === "APPROVE"
      ? "1A6E40"
      : "C99612";

  const cell = (text: string, opts: { header?: boolean; first?: boolean; width?: number } = {}) =>
    new TableCell({
      width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
      shading: opts.header ? { fill: HEADBG } : undefined,
      borders: cellBorders,
      children: [
        new Paragraph({
          alignment:
            !opts.first && !opts.header && /^[(\-$]?[\d.,]/.test(text.trim())
              ? AlignmentType.RIGHT
              : AlignmentType.LEFT,
          children: [
            new TextRun({
              text: text ?? "",
              bold: opts.header,
              size: opts.header ? 15 : 17,
              color: opts.header ? MUTED : INK,
            }),
          ],
        }),
      ],
    });

  const makeTable = (table: ReportTable) => {
    const cols = table.columns.length;
    const firstW = 32;
    const restW = (100 - firstW) / Math.max(1, cols - 1);
    const widths = table.columns.map((_, i) => (i === 0 ? firstW : restW));
    const header = new TableRow({
      tableHeader: true,
      children: table.columns.map((c, i) =>
        cell(c, { header: true, first: i === 0, width: widths[i] }),
      ),
    });
    const body = table.rows.map(
      (r) =>
        new TableRow({
          children: r.map((c, i) => cell(String(c ?? ""), { first: i === 0, width: widths[i] })),
        }),
    );
    return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...body] });
  };

  const para = (runs: any[], opts: any = {}) => new Paragraph({ ...opts, children: runs });
  const spacer = () =>
    new Paragraph({ children: [new TextRun({ text: "" })], spacing: { after: 80 } });

  const children: any[] = [];

  // Title block
  children.push(para([new TextRun({ text: report.title, bold: true, size: 36, color: INK })]));
  children.push(
    para([new TextRun({ text: report.project_name, bold: true, size: 28, color: GOLD })]),
  );
  children.push(
    para(
      [
        new TextRun({
          text: `${report.subtitle}   ·   ${report.mode_label}`,
          size: 18,
          color: MUTED,
        }),
      ],
      { spacing: { after: 160 } },
    ),
  );

  // Summary stats (2-col)
  if (report.summary_stats.length) {
    children.push(
      makeTable({
        columns: ["Summary", "Value"],
        rows: report.summary_stats.map((s) => [s.label, s.value]),
      }),
    );
    children.push(spacer());
  }

  // Verdict banner
  children.push(
    new Paragraph({
      shading: { fill: verdictFill },
      spacing: { before: 80, after: 80 },
      children: [
        new TextRun({
          text: `  ${report.verdict_banner}  `,
          bold: true,
          size: 22,
          color: "FFFFFF",
        }),
      ],
    }),
  );
  if (report.verdict_narrative) {
    children.push(
      para([new TextRun({ text: report.verdict_narrative, size: 18, color: INK })], {
        spacing: { after: 160 },
      }),
    );
  }

  // KPI cards (2-col table)
  if (report.metric_cards.length) {
    children.push(
      para(
        [
          new TextRun({
            text: "KEY PERFORMANCE METRICS (BASE CASE)",
            bold: true,
            size: 18,
            color: INK,
          }),
        ],
        { shading: { fill: HEADBG }, spacing: { before: 120, after: 60 } },
      ),
    );
    children.push(
      makeTable({
        columns: ["Metric", "Value"],
        rows: report.metric_cards.map((c) => [c.label, c.value]),
      }),
    );
    children.push(spacer());
  }

  // Numbered sections
  report.sections.forEach((sec, idx) => {
    children.push(
      para(
        [
          new TextRun({
            text: `${idx + 1}. ${sec.heading.toUpperCase()}`,
            bold: true,
            size: 18,
            color: INK,
          }),
        ],
        {
          heading: HeadingLevel.HEADING_2,
          shading: { fill: HEADBG },
          spacing: { before: 160, after: 60 },
        },
      ),
    );
    if (sec.table) children.push(makeTable(sec.table));
    if (sec.body) children.push(para([new TextRun({ text: sec.body, size: 18, color: INK })]));
    if (sec.table?.note)
      children.push(
        para(
          [new TextRun({ text: `Note: ${sec.table.note}`, italics: true, size: 14, color: MUTED })],
          { spacing: { after: 80 } },
        ),
      );
  });

  // Footnotes
  if (report.footnotes.length) {
    children.push(spacer());
    report.footnotes.forEach((f) =>
      children.push(
        para([new TextRun({ text: f, size: 13, color: MUTED })], { spacing: { after: 40 } }),
      ),
    );
  }

  const manifest = provenanceManifestText(report.provenance_manifest);
  if (manifest) {
    children.push(
      para([new TextRun({ text: manifest, size: 13, bold: true, color: MUTED })], {
        spacing: { before: 80, after: 40 },
      }),
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        headers: undefined,
        children,
      },
    ],
  });

  return Packer.toBase64String(doc);
}
