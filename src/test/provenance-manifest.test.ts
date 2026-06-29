import { describe, expect, test } from "vitest";
import { buildMemoReport, memoReportText, type MemoReport } from "@/lib/memo-report";
import {
  buildReportProvenanceManifest,
  provenanceManifestText,
} from "@/lib/reports/provenance-manifest";
import { verifyNumericProvenance } from "@/lib/engine";

function report(): MemoReport {
  return buildMemoReport({
    project: { id: "p1", name: "Manifest Deal", location: "Austin", type: "mixed_use" },
    assumptions: [],
    engineInputs: [],
    outputs: [],
    flags: [],
    risks: [],
    documents: [],
    verdict: { code: "APPROVE", gates: [] },
    generationMode: "deterministic",
    generatedLabel: "June 2026",
  });
}

describe("signed provenance manifests", () => {
  test("manifest text is stable, renderable, and numeric-provenance neutral", () => {
    const r = report();
    const provenance = verifyNumericProvenance(memoReportText(r), []);
    const manifest = buildReportProvenanceManifest({
      reportType: "investor_report",
      report: r,
      provenance,
      generatedAt: "2026-06-01T00:00:00.000Z",
    });
    r.provenance_manifest = manifest;

    expect(manifest.content_signature).toMatch(/^[A-Z-]+$/);
    expect(provenanceManifestText(manifest)).toContain("Signature");
    expect(verifyNumericProvenance(provenanceManifestText(manifest), []).orphans).toEqual([]);
  });
});
