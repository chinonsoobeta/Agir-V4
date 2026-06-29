import { describe, expect, it } from "vitest";
import { sha256Hex, stableJsonHash } from "@/lib/hash.server";
import { scanDocumentBuffer, UPLOAD_LIMITS } from "@/lib/upload-guards.server";
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
