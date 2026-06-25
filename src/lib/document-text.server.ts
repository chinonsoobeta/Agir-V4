// Server-only helpers for parsing uploaded documents into plain text.
// Used by analyzeDocument and the assumption extraction engine. Every branch
// logs the resulting text length so the extraction debug trace and server logs
// can pinpoint a parsing failure (storage vs. parse vs. empty document).

import { detectMoneyScale } from "./money-scale";
import { fillMergedCells } from "./parsers/xlsx-utils";
import { defaultOcrRunner, type OcrRunner } from "./pdf-ocr.server";

function log(name: string, kind: string, length: number, note = "") {
  console.log(`[document-text] ${kind} "${name}" -> ${length} chars${note ? ` (${note})` : ""}`);
}

// A PDF text layer with fewer than this many non-whitespace characters is
// treated as "empty / near-empty" (a scanned or image-only PDF) and triggers
// the OCR fallback.
const MIN_EMBEDDED_TEXT_CHARS = 16;

export type PdfTextMeta = {
  text: string;
  recoveredViaOcr: boolean;
  // Tesseract mean confidence (0-100) when OCR ran, else null.
  ocrConfidence: number | null;
  embeddedChars: number;
};

// PDF text extraction with an OCR fallback. Reads the embedded text layer first;
// when it is empty / near-empty (a scanned or image-only PDF) it runs OCR and
// uses the recovered text, recording that OCR was used and its confidence so the
// UI can flag the document for verification. The OCR runner is injectable for
// testing.
export async function pdfBufferToTextWithMeta(
  buf: ArrayBuffer,
  opts: { ocr?: OcrRunner } = {},
): Promise<PdfTextMeta> {
  let embedded = "";
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    embedded = Array.isArray(text) ? text.join("\n") : String(text ?? "");
  } catch {
    embedded = "";
  }
  const embeddedChars = embedded.replace(/\s/g, "").length;
  if (embeddedChars >= MIN_EMBEDDED_TEXT_CHARS) {
    return { text: embedded, recoveredViaOcr: false, ocrConfidence: null, embeddedChars };
  }

  // Empty / near-empty text layer: attempt OCR.
  const runner = opts.ocr ?? defaultOcrRunner;
  try {
    const ocr = await runner(buf);
    if (ocr.text.trim()) {
      return { text: ocr.text, recoveredViaOcr: true, ocrConfidence: ocr.confidence, embeddedChars };
    }
  } catch (error) {
    console.warn(`[document-text] OCR fallback failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { text: embedded, recoveredViaOcr: false, ocrConfidence: null, embeddedChars };
}

export async function pdfBufferToText(buf: ArrayBuffer): Promise<string> {
  return (await pdfBufferToTextWithMeta(buf)).text;
}

// Spreadsheets are emitted with sheet names and per-row labels preserved so the
// candidate extractor keeps each value's financial context, e.g.:
//   Sheet Construction Budget row 4: Land acquisition | $34,500,000
export async function xlsxBufferToText(buf: ArrayBuffer): Promise<string> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
  const out: string[] = [];
  for (const name of wb.SheetNames) {
    out.push(`# Sheet: ${name}`);
    const ws = wb.Sheets[name];
    // 2C. Propagate merged-range values so a merged label/amount is emitted on
    // every spanned row instead of being silently dropped.
    fillMergedCells(ws);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
    const headers = (rows[0] ?? []).map((cell) => String(cell ?? "").trim());
    // A "$ in thousands / millions" declaration in the sheet name or a caption
    // row applies to every money cell; a column header can override it per
    // column. Honoring it stops a raw 34,500 from being read as $34.5k.
    const sheetScale = detectMoneyScale([name, ...rows.slice(0, 3).flat().map((c) => String(c ?? ""))].join(" "));
    // Apply the sheet scale only to columns that are clearly money columns (by
    // header), so a percent / count / SF column is never rescaled even when the
    // sheet declares a dollar scale. An explicit per-column scale always wins.
    const columnScales = headers.map((h) => {
      const colScale = detectMoneyScale(h);
      if (colScale !== 1) return colScale;
      const isMoneyColumn =
        /amount|budget|cost|price|value|loan|equity|debt|proceeds|income|revenue|noi|opex|expense|tdc|total|contingency|financing|acquisition|capital|reserve|fee|\$/i.test(
          h,
        );
      return isMoneyColumn ? sheetScale : 1;
    });
    rows.forEach((row, index) => {
      const cells = row
        .map((cell, columnIndex) => formatSpreadsheetCell(cell, headers[columnIndex], row, columnScales[columnIndex] ?? sheetScale))
        .filter(Boolean)
        .join(" | ");
      out.push(`Sheet ${name} row ${index + 1}: ${cells}`);
    });
  }
  return out.join("\n");
}

function formatSpreadsheetCell(cell: unknown, header: string | undefined, row: unknown[], scale = 1): string {
  if (cell == null) return "";
  const label = String(header ?? "").trim();
  const prefix = label ? `${label}=` : "";
  if (typeof cell !== "number" || !isFinite(cell)) return `${prefix}${String(cell).trim()}`;

  const rowLabel = row
    .slice(0, 2)
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");
  const financialContext = [label.toLowerCase(), rowLabel].join(" ");
  const looksLikePercent = /\b(occupancy|occupanc|occ\.?|percent|pct|%)\b/.test(financialContext) && Math.abs(cell) <= 1;

  const looksLikeMoney =
    /\b(amount|budget|cost|price|value|loan|equity|debt|proceeds|income|revenue|rent|noi|opex|expense|tdc|total|contingency|financing|acquisition|land|soft|hard|capital|reserve|fee)\b/.test(
      financialContext,
    );

  // Apply a declared "in thousands / millions" scale to money cells only, so a
  // percent or count column is never rescaled.
  const value = looksLikeMoney && scale !== 1 ? cell * scale : cell;
  const formatted = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
  if (looksLikePercent) return `${prefix}${(cell * 100).toFixed(2)}%`;
  return `${prefix}${looksLikeMoney ? `$${formatted}` : formatted}`;
}

// Best-effort DOCX text extraction using only Node built-ins. A .docx is a ZIP
// archive; we locate word/document.xml via the central directory, inflate it,
// and strip the WordprocessingML tags. Returns "" on any failure rather than
// throwing, so a single bad document never breaks extraction.
export async function docxBufferToText(buf: ArrayBuffer): Promise<string> {
  try {
    const zlib = await import("node:zlib");
    const bytes = Buffer.from(buf);
    // Find End Of Central Directory record (signature 0x06054b50), scanning back.
    let eocd = -1;
    for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 65536; i--) {
      if (bytes.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return "";
    const cdOffset = bytes.readUInt32LE(eocd + 16);
    const cdCount = bytes.readUInt16LE(eocd + 10);

    let ptr = cdOffset;
    for (let n = 0; n < cdCount; n++) {
      if (bytes.readUInt32LE(ptr) !== 0x02014b50) break;
      const method = bytes.readUInt16LE(ptr + 10);
      const compSize = bytes.readUInt32LE(ptr + 20);
      const nameLen = bytes.readUInt16LE(ptr + 28);
      const extraLen = bytes.readUInt16LE(ptr + 30);
      const commentLen = bytes.readUInt16LE(ptr + 32);
      const localOffset = bytes.readUInt32LE(ptr + 42);
      const name = bytes.toString("utf8", ptr + 46, ptr + 46 + nameLen);

      if (name === "word/document.xml") {
        // Parse the local header to find where the data starts.
        if (bytes.readUInt32LE(localOffset) !== 0x04034b50) return "";
        const lNameLen = bytes.readUInt16LE(localOffset + 26);
        const lExtraLen = bytes.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + lNameLen + lExtraLen;
        const comp = bytes.subarray(dataStart, dataStart + compSize);
        const xml = method === 0 ? comp : zlib.inflateRawSync(comp);
        // Insert separators at run/cell/row/paragraph boundaries BEFORE stripping
        // tags. Without this, adjacent text runs concatenate with no whitespace
        // (e.g. "$162,500,000Preferred Equity"), which both glues labels to the
        // next value and truncates numbers at internal commas during extraction.
        const text = String(xml)
          .replace(/<\/w:t>/g, " ")
          .replace(/<w:tab\b[^>]*\/?>/g, "\t")
          .replace(/<w:br\b[^>]*\/?>/g, "\n")
          .replace(/<\/w:tc>/g, "\t")
          .replace(/<\/w:tr>/g, "\n")
          .replace(/<\/w:p>/g, "\n")
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
          .replace(/[ \t]{2,}/g, " ")
          .replace(/[ \t]+\n/g, "\n")
          .trim();
        return text;
      }
      ptr += 46 + nameLen + extraLen + commentLen;
    }
    return "";
  } catch (error) {
    console.warn(`[document-text] docx parse failed: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  }
}

export type ExtractedText = {
  text: string;
  // True when a scanned / image-only PDF was recovered via OCR.
  recoveredViaOcr: boolean;
  // Tesseract mean confidence (0-100) when OCR ran, else null.
  ocrConfidence: number | null;
};

// Extract text from any supported document, returning OCR metadata alongside it
// so the per-document debug trace can flag OCR-recovered (low-confidence) text.
export async function extractFileTextWithMeta(
  name: string,
  fileType: string | null | undefined,
  buf: ArrayBuffer,
  opts: { ocr?: OcrRunner } = {},
): Promise<ExtractedText> {
  const lower = name.toLowerCase();
  const type = (fileType ?? "").toLowerCase();
  const plain = (text: string): ExtractedText => ({ text, recoveredViaOcr: false, ocrConfidence: null });
  try {
    if (lower.endsWith(".pdf") || type.includes("pdf")) {
      const meta = await pdfBufferToTextWithMeta(buf, opts);
      log(name, "pdf", meta.text.length, meta.recoveredViaOcr ? `recovered via OCR, confidence ${Math.round(meta.ocrConfidence ?? 0)}%` : "");
      return { text: meta.text, recoveredViaOcr: meta.recoveredViaOcr, ocrConfidence: meta.ocrConfidence };
    }
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || type.includes("sheet") || type.includes("excel")) {
      const text = await xlsxBufferToText(buf);
      log(name, "xlsx", text.length);
      return plain(text);
    }
    if (lower.endsWith(".docx") || type.includes("wordprocessingml")) {
      const text = await docxBufferToText(buf);
      log(name, "docx", text.length, text ? "" : "no text recovered");
      return plain(text);
    }
    if (lower.endsWith(".csv") || lower.endsWith(".tsv") || type.includes("csv")) {
      const text = new TextDecoder().decode(buf);
      log(name, "csv", text.length);
      return plain(text);
    }
    // .txt and any other text-like payload.
    const text = new TextDecoder().decode(buf);
    log(name, "text", text.length);
    return plain(text);
  } catch (error) {
    console.warn(`[document-text] extractFileText failed for "${name}" (${type}): ${error instanceof Error ? error.message : String(error)}`);
    return plain("");
  }
}

export async function extractFileText(name: string, fileType: string | null | undefined, buf: ArrayBuffer): Promise<string> {
  return (await extractFileTextWithMeta(name, fileType, buf)).text;
}
