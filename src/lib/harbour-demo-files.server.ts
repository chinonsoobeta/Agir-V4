// Server-only: render the synthetic Harbour demo documents (defined in
// harbour-demo-docs.ts) into real, downloadable file bytes: text-bearing PDFs
// via jsPDF and real spreadsheets via xlsx: so the extraction pipeline reads
// them exactly as it would real uploads. Deterministic: identical bytes-by-
// content every run (no timestamps embedded in the text layer).

import { HARBOUR_DEMO_DOCS, type DemoDoc } from "./harbour-demo-docs";

export async function renderDemoDocBytes(doc: DemoDoc): Promise<Uint8Array> {
  if (doc.kind === "pdf") {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF();
    pdf.setFontSize(16);
    pdf.text(doc.title, 14, 20);
    pdf.setFontSize(12);
    let y = 36;
    for (const line of doc.lines) {
      pdf.text(line, 14, y);
      y += 10;
    }
    return new Uint8Array(pdf.output("arraybuffer"));
  }
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet(doc.rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, doc.sheet);
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Uint8Array(out);
}

export type RenderedDemoFile = {
  name: string;
  storage_file: string;
  category: string;
  file_type: string;
  bytes: Uint8Array;
};

export async function buildHarbourDemoFiles(): Promise<RenderedDemoFile[]> {
  const out: RenderedDemoFile[] = [];
  for (const doc of HARBOUR_DEMO_DOCS) {
    out.push({
      name: doc.name,
      storage_file: doc.storage_file,
      category: doc.category,
      file_type: doc.file_type,
      bytes: await renderDemoDocBytes(doc),
    });
  }
  return out;
}
