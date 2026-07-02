import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256Hex, stableJsonHash } from "@/lib/hash.server";
import {
  parseExternalScanVerdict,
  scanDocument,
  scanDocumentBuffer,
  UPLOAD_LIMITS,
} from "@/lib/upload-guards.server";
import { isMaterialOverrideField, MATERIAL_OVERRIDE_KEYS } from "@/lib/dual-control";

function buf(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}
const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]; // %PDF-1.7
const ZIP_HEADER = [0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0];
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0];

describe("stableJsonHash", () => {
  it("is independent of object key order", () => {
    expect(stableJsonHash({ a: 1, b: 2 })).toBe(stableJsonHash({ b: 2, a: 1 }));
  });
  it("is order-sensitive for arrays and distinguishes different content", () => {
    expect(stableJsonHash([1, 2])).not.toBe(stableJsonHash([2, 1]));
    expect(stableJsonHash({ x: 1 })).not.toBe(stableJsonHash({ x: 2 }));
  });
  it("hashes nested structures deterministically", () => {
    const a = stableJsonHash({ outer: { inner: [1, { k: "v" }] } });
    const b = stableJsonHash({ outer: { inner: [1, { k: "v" }] } });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("sha256Hex", () => {
  it("produces a stable 64-hex digest", () => {
    expect(sha256Hex(buf(PDF_HEADER))).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256Hex(buf([1, 2, 3]))).toBe(sha256Hex(new Uint8Array([1, 2, 3])));
  });
});

describe("scanDocumentBuffer", () => {
  it("accepts a real PDF/PNG/zip-based office file", () => {
    expect(scanDocumentBuffer("a.pdf", buf(PDF_HEADER)).ok).toBe(true);
    expect(scanDocumentBuffer("a.png", buf(PNG_HEADER)).ok).toBe(true);
    expect(scanDocumentBuffer("a.xlsx", buf(ZIP_HEADER)).ok).toBe(true);
  });
  it("rejects a payload disguised with a mismatched extension", () => {
    // PNG bytes renamed to .pdf must be rejected by the signature check.
    const r = scanDocumentBuffer("evil.pdf", buf(PNG_HEADER));
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/signature mismatch/i);
  });
  it("rejects empty and oversize files", () => {
    expect(scanDocumentBuffer("a.pdf", new ArrayBuffer(0)).ok).toBe(false);
    const huge = new ArrayBuffer(UPLOAD_LIMITS.maxFileBytes + 1);
    new Uint8Array(huge).set(PDF_HEADER);
    expect(scanDocumentBuffer("a.pdf", huge).ok).toBe(false);
  });
  it("rejects binary content disguised as a text/csv file", () => {
    expect(scanDocumentBuffer("a.csv", buf([0, 0, 0, 65, 66])).ok).toBe(false);
    expect(scanDocumentBuffer("a.csv", buf([97, 44, 98, 44, 99])).ok).toBe(true); // "a,b,c"
  });
  it("rejects unsupported extensions", () => {
    expect(scanDocumentBuffer("a.exe", buf([1, 2, 3, 4])).ok).toBe(false);
  });
});

describe("scanDocument (async, AV-capable)", () => {
  it("uses the structural engine when no external scanner is configured", async () => {
    delete process.env.DOCUMENT_SCAN_URL;
    const ok = await scanDocument("a.pdf", buf(PDF_HEADER));
    expect(ok.ok).toBe(true);
    expect(ok.engine).toBe("structural");
  });
  it("rejects a disguised file before any network call", async () => {
    delete process.env.DOCUMENT_SCAN_URL;
    const bad = await scanDocument("evil.pdf", buf(PNG_HEADER));
    expect(bad.ok).toBe(false);
    expect(bad.engine).toBe("structural");
  });
});

describe("parseExternalScanVerdict (scanner response shapes)", () => {
  it("honors the native {clean} contract", () => {
    expect(parseExternalScanVerdict('{"clean":false,"detail":"Eicar"}')).toEqual({
      infected: true,
      detail: "Eicar",
    });
    expect(parseExternalScanVerdict('{"clean":true}')!.infected).toBe(false);
  });
  it("treats ClamAV-REST Status FOUND as infected and Status OK as clean", () => {
    const found = parseExternalScanVerdict(
      '{"Status":"FOUND","Description":"Eicar-Test-Signature"}',
    );
    expect(found).toEqual({ infected: true, detail: "Eicar-Test-Signature" });
    expect(parseExternalScanVerdict('{"Status":"OK"}')!.infected).toBe(false);
  });
  it("treats clamscan-style infected flags and virus lists as infected", () => {
    const r = parseExternalScanVerdict('{"isInfected":true,"viruses":["Eicar-Test-Signature"]}');
    expect(r).toEqual({ infected: true, detail: "Eicar-Test-Signature" });
    expect(parseExternalScanVerdict('{"infected":false}')!.infected).toBe(false);
  });
  it("treats a clamd text FOUND line as infected and other text as no-verdict", () => {
    expect(parseExternalScanVerdict("stream: Eicar-Test-Signature FOUND")!.infected).toBe(true);
    expect(parseExternalScanVerdict("scan completed")).toBeNull();
    expect(parseExternalScanVerdict("")).toBeNull();
  });
});

describe("scanDocument external AV integration (mocked scanner)", () => {
  afterEach(() => {
    delete process.env.DOCUMENT_SCAN_URL;
    delete process.env.DOCUMENT_SCAN_FORMAT;
    delete process.env.DOCUMENT_SCAN_FAIL_OPEN;
    vi.unstubAllGlobals();
  });

  it("rejects when a 200 body carries a ClamAV-REST FOUND verdict", async () => {
    process.env.DOCUMENT_SCAN_URL = "https://scanner.internal/scan";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"Status":"FOUND","Description":"Eicar"}', { status: 200 })),
    );
    const r = await scanDocument("a.pdf", buf(PDF_HEADER));
    expect(r.ok).toBe(false);
    expect(r.engine).toBe("external");
    expect(r.detail).toMatch(/eicar/i);
  });

  it("rejects on a 4xx scanner verdict (clamav-rest returns 406 on detection)", async () => {
    process.env.DOCUMENT_SCAN_URL = "https://scanner.internal/scan";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"Status":"FOUND"}', { status: 406 })),
    );
    const r = await scanDocument("a.pdf", buf(PDF_HEADER));
    expect(r.ok).toBe(false);
    expect(r.engine).toBe("external");
  });

  it("passes a clean 200 and records the external engine", async () => {
    process.env.DOCUMENT_SCAN_URL = "https://scanner.internal/scan";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"Status":"OK"}', { status: 200 })),
    );
    const r = await scanDocument("a.pdf", buf(PDF_HEADER));
    expect(r.ok).toBe(true);
    expect(r.engine).toBe("external");
  });

  it("sends multipart form data when DOCUMENT_SCAN_FORMAT=multipart", async () => {
    process.env.DOCUMENT_SCAN_URL = "https://scanner.internal/scan";
    process.env.DOCUMENT_SCAN_FORMAT = "multipart";
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('{"Status":"OK"}', { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await scanDocument("a.pdf", buf(PDF_HEADER));
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.body).toBeInstanceOf(FormData);
    const file = (init?.body as FormData).get("file");
    expect(file).toBeInstanceOf(Blob);
  });

  it("fails CLOSED on a scanner outage, and open only with the explicit flag", async () => {
    process.env.DOCUMENT_SCAN_URL = "https://scanner.internal/scan";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    );
    const closed = await scanDocument("a.pdf", buf(PDF_HEADER));
    expect(closed.ok).toBe(false);
    expect(closed.detail).toMatch(/unavailable/i);

    process.env.DOCUMENT_SCAN_FAIL_OPEN = "1";
    const open = await scanDocument("a.pdf", buf(PDF_HEADER));
    expect(open.ok).toBe(true);
    expect(open.detail).toMatch(/allowed by DOCUMENT_SCAN_FAIL_OPEN/);
  });
});

describe("dual-control material fields", () => {
  it("flags debt / cap / equity fields as material", () => {
    expect(isMaterialOverrideField("debt_amount")).toBe(true);
    expect(isMaterialOverrideField("exit_cap_rate")).toBe(true);
    expect(isMaterialOverrideField("equity_amount")).toBe(true);
    expect(isMaterialOverrideField("interest_rate")).toBe(true);
  });
  it("does not flag immaterial / cosmetic fields", () => {
    expect(isMaterialOverrideField("anchor_tenant_name")).toBe(false);
    expect(isMaterialOverrideField("sponsor_track_record")).toBe(false);
    expect(isMaterialOverrideField(null)).toBe(false);
    expect(isMaterialOverrideField(undefined)).toBe(false);
  });
  it("the material set is non-empty and stable", () => {
    expect(MATERIAL_OVERRIDE_KEYS.size).toBeGreaterThan(10);
  });
});
