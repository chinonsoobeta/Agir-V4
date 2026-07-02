// Safety guards for the document upload / extraction path: per-user quotas, a
// hard size cap, a max-pages guard, and a structural file-safety scan that runs
// BEFORE any parsing. The scan is deliberately a single choke point so an
// external AV engine (ClamAV / a cloud scanning API) can be dropped in by
// implementing one function; today it performs deterministic structural
// validation (magic-byte / signature checks, empty-file and oversize rejection)
// which catches the common malformed / disguised-file cases without a network
// dependency.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const UPLOAD_LIMITS = {
  // Authoritative per-file size cap (also enforced client-side for UX).
  maxFileBytes: 75 * 1024 * 1024, // 75 MB
  // Rolling 24h per-user quotas.
  maxFilesPerDay: 200,
  maxBytesPerDay: 2 * 1024 * 1024 * 1024, // 2 GB/day
  // Hard page ceiling for the synchronous analysis path. Beyond this the file
  // is accepted but full extraction is refused with a graceful message rather
  // than risking a timeout / partial parse.
  maxDocumentPages: 1000,
} as const;

export type ScanResult = { ok: boolean; detail: string };

const SIGNATURES: Record<string, (b: Uint8Array) => boolean> = {
  pdf: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46, // %PDF
  png: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  // OOXML (xlsx/docx) are zip containers: "PK\x03\x04".
  zip: (b) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07),
  // Legacy OLE compound file (xls/doc): D0 CF 11 E0.
  ole: (b) => b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0,
};

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : "";
}

/**
 * Structural safety scan run before parsing. Rejects empty files, oversize
 * files, and files whose bytes do not match the claimed extension (the classic
 * "rename a payload to .pdf" case). Text formats (csv/txt) are checked for an
 * excess of NUL bytes that would indicate a binary payload in disguise.
 */
export function scanDocumentBuffer(name: string, buf: ArrayBuffer): ScanResult {
  const bytes = new Uint8Array(buf);
  if (bytes.length === 0) return { ok: false, detail: "File is empty." };
  if (bytes.length > UPLOAD_LIMITS.maxFileBytes) {
    return {
      ok: false,
      detail: `File exceeds the ${Math.round(UPLOAD_LIMITS.maxFileBytes / (1024 * 1024))} MB limit.`,
    };
  }
  const ext = extOf(name);
  const head = bytes.subarray(0, 8);
  const expect = (fn: (b: Uint8Array) => boolean, label: string): ScanResult =>
    fn(head)
      ? { ok: true, detail: "clean" }
      : { ok: false, detail: `File does not look like a valid ${label} (signature mismatch).` };

  switch (ext) {
    case "pdf":
      return expect(SIGNATURES.pdf, "PDF");
    case "png":
      return expect(SIGNATURES.png, "PNG");
    case "jpg":
    case "jpeg":
      return expect(SIGNATURES.jpg, "JPEG");
    case "xlsx":
    case "docx":
      return expect(SIGNATURES.zip, "Office (xlsx/docx)");
    case "xls":
    case "doc":
      return SIGNATURES.ole(head) || SIGNATURES.zip(head)
        ? { ok: true, detail: "clean" }
        : { ok: false, detail: "File does not look like a valid Office document." };
    case "csv":
    case "txt": {
      // A handful of NULs in the first 4KB strongly implies a binary payload.
      const sample = bytes.subarray(0, 4096);
      let nul = 0;
      for (const b of sample) if (b === 0) nul++;
      return nul > 2
        ? { ok: false, detail: "Text file contains binary data; refusing to parse." }
        : { ok: true, detail: "clean" };
    }
    default:
      return { ok: false, detail: `Unsupported file type: .${ext || "(none)"}` };
  }
}

export type FullScanResult = ScanResult & { engine: "structural" | "external" };

/**
 * Parse an external scanner's 200 body into a verdict. Recognizes, in order:
 *   - { clean: boolean, detail? }                (this app's native contract)
 *   - { Status/status: "OK" | "FOUND" | ... }    (ClamAV REST bridges, e.g.
 *     ajilaag/clamav-rest report infections as 200 {"Status":"FOUND"})
 *   - { infected/isInfected/is_infected: bool }  (clamscan-style JSON APIs,
 *     often with a viruses: [] list)
 *   - plain text containing the clamd "... FOUND" verdict line
 * Anything unrecognized is treated as clean ONLY if it carries no infection
 * marker -- every known "infected" spelling above hard-rejects. Returning
 * `null` means "no verdict in the body" (clean by HTTP 200 semantics).
 */
export function parseExternalScanVerdict(
  text: string,
): { infected: boolean; detail: string } | null {
  if (!text) return null;
  let json: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object") json = parsed as Record<string, unknown>;
  } catch {
    // clamd/clamdscan text output: "stream: Eicar-Test-Signature FOUND"
    if (/\bFOUND\b/.test(text)) return { infected: true, detail: text.slice(0, 500) };
    return null;
  }
  if (json == null) return null;
  const detailOf = (fallback: string) => {
    const d = json?.detail ?? json?.Description ?? json?.description ?? json?.viruses;
    return (typeof d === "string" ? d : Array.isArray(d) ? d.join(", ") : "") || fallback;
  };
  if (typeof json.clean === "boolean") {
    return { infected: !json.clean, detail: detailOf("Flagged by scanner") };
  }
  const status = json.Status ?? json.status;
  if (typeof status === "string") {
    return status.trim().toUpperCase() === "OK"
      ? { infected: false, detail: "clean" }
      : { infected: true, detail: detailOf(`scanner status ${status}`) };
  }
  const infected = json.infected ?? json.isInfected ?? json.is_infected;
  if (typeof infected === "boolean") {
    return { infected, detail: detailOf(infected ? "Flagged by scanner" : "clean") };
  }
  return null;
}

/**
 * Full pre-parse safety scan. Always runs the deterministic structural check
 * first (cheap, no network). When DOCUMENT_SCAN_URL is configured, the bytes are
 * additionally submitted to an external anti-virus / content-scanning service
 * (a ClamAV REST bridge or a cloud scan API) and a verdict of "infected"
 * hard-rejects the file. This is the single seam to plug a real AV engine into:
 * the rest of the pipeline calls only this function.
 *
 * Contract for the external endpoint:
 *   - Request: POST raw bytes (content-type application/octet-stream,
 *     x-file-name header). Set DOCUMENT_SCAN_FORMAT=multipart for bridges that
 *     expect a multipart form upload (field name "file"), e.g. clamav-rest.
 *   - HTTP 4xx/5xx            -> infected/unsafe (body text becomes the detail;
 *     clamav-rest reports infections as HTTP 406)
 *   - HTTP 200                -> clean, UNLESS the body carries an infection
 *     verdict (see parseExternalScanVerdict: {clean:false}, {Status:"FOUND"},
 *     {infected:true}, or a clamd "... FOUND" text line all hard-reject)
 * A network/timeout error fails CLOSED (rejects) so an unreachable scanner can
 * never silently wave a file through. Set DOCUMENT_SCAN_FAIL_OPEN=1 to override
 * (e.g. during a scanner outage) -- it is logged on the document's scan_detail.
 */
export async function scanDocument(name: string, buf: ArrayBuffer): Promise<FullScanResult> {
  const structural = scanDocumentBuffer(name, buf);
  if (!structural.ok) return { ...structural, engine: "structural" };

  const url = process.env.DOCUMENT_SCAN_URL?.trim();
  if (!url) return { ...structural, engine: "structural" };

  const failOpen = process.env.DOCUMENT_SCAN_FAIL_OPEN === "1";
  const multipart = process.env.DOCUMENT_SCAN_FORMAT?.trim().toLowerCase() === "multipart";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let res: Response;
    try {
      let body: BodyInit;
      let headers: Record<string, string>;
      if (multipart) {
        const form = new FormData();
        form.append("file", new Blob([buf], { type: "application/octet-stream" }), name);
        body = form; // fetch sets the multipart boundary header itself
        headers = { "x-file-name": name };
      } else {
        body = buf;
        headers = { "content-type": "application/octet-stream", "x-file-name": name };
      }
      res = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (res.ok) {
      // A 200 may still carry a structured verdict.
      const text = await res.text().catch(() => "");
      const verdict = parseExternalScanVerdict(text);
      if (verdict?.infected) {
        return { ok: false, detail: verdict.detail, engine: "external" };
      }
      return { ok: true, detail: "clean (external scan)", engine: "external" };
    }
    const detail = (await res.text().catch(() => "")) || `scanner rejected (HTTP ${res.status})`;
    return { ok: false, detail: detail.slice(0, 500), engine: "external" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (failOpen) {
      return {
        ok: true,
        detail: `external scan unavailable (${message}); allowed by DOCUMENT_SCAN_FAIL_OPEN`,
        engine: "structural",
      };
    }
    return { ok: false, detail: `Safety scan unavailable: ${message}`, engine: "external" };
  }
}

/**
 * Rolling 24h per-user upload quota. Throws a user-facing Error if accepting a
 * file of `incomingBytes` would breach the file-count or byte quota.
 */
export async function enforceUploadQuota(
  ctx: { supabase: SupabaseClient<Database>; userId: string },
  incomingBytes: number,
): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await ctx.supabase
    .from("documents")
    .select("size_bytes, upload_date")
    .eq("owner_id", ctx.userId)
    .gte("upload_date", since);
  if (error) return; // never block uploads on a quota read failure
  const rows = (data ?? []) as { size_bytes: number | null }[];
  if (rows.length >= UPLOAD_LIMITS.maxFilesPerDay) {
    throw new Error(
      `Daily upload limit reached (${UPLOAD_LIMITS.maxFilesPerDay} files / 24h). Try again later or contact your administrator.`,
    );
  }
  const used = rows.reduce((s, r) => s + (r.size_bytes ?? 0), 0);
  if (used + incomingBytes > UPLOAD_LIMITS.maxBytesPerDay) {
    throw new Error(
      `Daily upload size quota reached (${Math.round(UPLOAD_LIMITS.maxBytesPerDay / (1024 * 1024 * 1024))} GB / 24h).`,
    );
  }
}
