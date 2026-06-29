import type { MemoReport } from "../memo-report";
import type { ProvenanceReport } from "../engine/provenance";

export type ReportProvenanceManifest = {
  schema: "agir.provenance.manifest.v1";
  report_type: string;
  generated_at: string;
  verification_pass: boolean;
  token_count: number;
  orphan_count: number;
  content_signature: string;
};

function alphaSignature(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const encode = (n: number) => {
    let value = n >>> 0;
    let out = "";
    for (let i = 0; i < 7; i += 1) {
      out += alphabet[value % alphabet.length];
      value = Math.floor(value / alphabet.length);
    }
    return out;
  };
  return `${encode(h1)}-${encode(h2)}`;
}

export function buildReportProvenanceManifest(args: {
  reportType: string;
  report: MemoReport;
  provenance: ProvenanceReport;
  generatedAt: string;
}): ReportProvenanceManifest {
  const payload = JSON.stringify({
    report_type: args.reportType,
    generated_at: args.generatedAt,
    title: args.report.title,
    project_name: args.report.project_name,
    sections: args.report.sections,
    footnotes: args.report.footnotes,
    derived_values: args.report.derived_values,
    pass: args.provenance.pass,
    token_count: args.provenance.tokenCount,
    orphans: args.provenance.orphans.map((orphan) => orphan.raw),
  });
  return {
    schema: "agir.provenance.manifest.v1",
    report_type: args.reportType,
    generated_at: args.generatedAt,
    verification_pass: args.provenance.pass,
    token_count: args.provenance.tokenCount,
    orphan_count: args.provenance.orphans.length,
    content_signature: alphaSignature(payload),
  };
}

export function provenanceManifestText(manifest?: ReportProvenanceManifest | null): string {
  if (!manifest) return "";
  const status = manifest.verification_pass ? "verified" : "needs review";
  return `Provenance manifest ${status}. Signature ${manifest.content_signature}.`;
}
