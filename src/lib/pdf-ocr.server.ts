// OCR fallback for scanned / image-only PDFs (Workstream 2A).
//
// This is a deterministic BOUNDARY, not a value source: OCR only recovers raw
// TEXT from a PDF whose embedded text layer is empty. The existing regex
// candidate extractor and deterministic alias mapper still produce every number;
// OCR never invents or maps a value. Recovered text is flagged low-confidence so
// the UI can warn "recovered via OCR, please verify."
//
// tesseract.js and a canvas raster backend are OPTIONAL runtime dependencies.
// They are loaded through a dynamic import the bundler does not statically
// resolve (a variable specifier + @vite-ignore), so the production build never
// fails when they are absent: the runner simply degrades to empty text and the
// PDF is reported as "no extractable text" exactly as today. Install
// `tesseract.js` (and `@napi-rs/canvas` for server-side rasterization) to
// activate real OCR. The boundary is injectable so tests exercise the
// empty-text-layer -> OCR -> candidates path without the heavy dependencies.
import { readServerConfig } from "./config.server";

export type OcrResult = {
  text: string;
  confidence: number;
  pagesProcessed?: number;
  totalPages?: number;
  truncated?: boolean;
};
export type OcrRunner = (buf: ArrayBuffer) => Promise<OcrResult>;

// Minimal structural shapes describing only the members we actually call on the
// optional `unpdf` and `tesseract.js` runtime dependencies.
type UnpdfModule = {
  getDocumentProxy?: (data: Uint8Array) => Promise<{ numPages?: number } | null>;
  renderPageAsImage?: (
    data: Uint8Array,
    page: number,
    opts: { canvas: () => Promise<unknown>; scale: number },
  ) => Promise<Uint8Array | ArrayBuffer | null>;
};

type TesseractWorker = {
  recognize: (input: Buffer) => Promise<{ data?: { text?: string; confidence?: number } }>;
  terminate: () => Promise<unknown>;
};

type TesseractModule = {
  createWorker?: (lang: string) => Promise<TesseractWorker>;
};

// Optional dynamic import: never throws, returns null when the module is not
// installed. The variable specifier + @vite-ignore keep it out of the bundle.
async function optionalImport<T = unknown>(spec: string): Promise<T | null> {
  try {
    const moduleSpecifier = `${spec}`;
    return (await import(/* @vite-ignore */ moduleSpecifier)) as T;
  } catch {
    return null;
  }
}

// Cap pages so a large scanned PDF cannot make extraction hang. OCR is ~1–2s
// per page (tesseract), so a 500–1000 page *scanned* document cannot be OCR'd
// inside a single request - embedded-text PDFs have no such limit and now scan
// in full (see EXTRACTION_TEXT_SCAN_CHAR_LIMIT). When this cap truncates a
// scanned doc the caller surfaces a "first N of M pages" warning rather than
// failing silently. Override via env for batch/background contexts.
function resolveMaxOcrPages(): number {
  return readServerConfig().maxOcrPages;
}
export const MAX_OCR_PAGES = resolveMaxOcrPages();

export const defaultOcrRunner: OcrRunner = async (buf) => {
  const unpdf = await optionalImport<UnpdfModule>("unpdf");
  if (!unpdf?.renderPageAsImage || !unpdf?.getDocumentProxy) return { text: "", confidence: 0 };

  let pageCount = 1;
  let sourcePageCount = 1;
  try {
    const pdf = await unpdf.getDocumentProxy(new Uint8Array(buf));
    const totalPages = Number(pdf?.numPages ?? 1) || 1;
    pageCount = Math.min(MAX_OCR_PAGES, totalPages);
    sourcePageCount = totalPages;
  } catch {
    return { text: "", confidence: 0 };
  }

  const tesseract = await optionalImport<TesseractModule>("tesseract.js");
  if (!tesseract?.createWorker) return { text: "", confidence: 0 };

  let worker: TesseractWorker;
  try {
    worker = await tesseract.createWorker("eng");
  } catch {
    return { text: "", confidence: 0 };
  }

  const texts: string[] = [];
  const confidences: number[] = [];
  try {
    for (let page = 1; page <= pageCount; page++) {
      let image: unknown = null;
      try {
        image = await unpdf.renderPageAsImage(new Uint8Array(buf), page, {
          canvas: () => optionalImport("@napi-rs/canvas"),
          scale: 2,
        });
      } catch {
        image = null;
      }
      if (!image) continue;
      const input =
        image instanceof Uint8Array ? Buffer.from(image) : Buffer.from(image as ArrayBuffer);
      const { data } = await worker.recognize(input);
      if (data?.text) texts.push(String(data.text));
      if (typeof data?.confidence === "number") confidences.push(data.confidence);
    }
  } catch {
    /* fall through to whatever was recovered */
  } finally {
    try {
      await worker.terminate();
    } catch {
      /* ignore */
    }
  }

  const confidence = confidences.length
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : 0;
  return {
    text: texts.join("\n").trim(),
    confidence,
    pagesProcessed: pageCount,
    totalPages: sourcePageCount,
    truncated: sourcePageCount > pageCount,
  };
};
