import { REPORT_DEFINITIONS, type ReportFormat, type ReportType } from "./report-definitions";

export type ReportArtifactSurface = {
  label: string;
  reportType: ReportType;
  format: ReportFormat;
};

export type MemoArtifactSurface = {
  label: string;
  reportType: null;
  format: "pdf" | "docx";
};

export const REPORT_ARTIFACT_SURFACES: ReportArtifactSurface[] = REPORT_DEFINITIONS.flatMap((def) =>
  def.supportedFormats.map((format) => ({
    label: `${def.type}:${format}`,
    reportType: def.type,
    format,
  })),
);

export const MEMO_ARTIFACT_SURFACES: MemoArtifactSurface[] = [
  { label: "memo:pdf", reportType: null, format: "pdf" },
  { label: "memo:docx", reportType: null, format: "docx" },
];

export const ALL_NUMERIC_PROVENANCE_SURFACES = [
  ...MEMO_ARTIFACT_SURFACES,
  ...REPORT_ARTIFACT_SURFACES,
] as const;
