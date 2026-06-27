// Registry of stakeholder reports. Pure metadata: no data access: so it can
// be imported by both the server (readiness/build) and the client (cards/UI).

export type ReportType =
  | "investor_report"
  | "lender_package"
  | "executive_summary"
  | "internal_team_report";

export type ReportFormat = "pdf" | "docx" | "xlsx";

export type ReportDefinition = {
  type: ReportType;
  title: string;
  description: string;
  supportedFormats: ReportFormat[];
  // Data the report depends on. Used by readiness checks.
  requiredData: string[];
  stakeholder: "investor" | "lender" | "executive" | "internal";
  // Internal Team Report can be generated before underwriting (with disclosures).
  requiresUnderwriting: boolean;
};

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  {
    type: "investor_report",
    title: "Investor Report",
    description:
      "Project summary, financial metrics, and scenario results for equity investors and the IC.",
    supportedFormats: ["pdf", "docx", "xlsx"],
    requiredData: ["project", "financial_outputs"],
    stakeholder: "investor",
    requiresUnderwriting: true,
  },
  {
    type: "lender_package",
    title: "Lender Package",
    description:
      "Debt-focused package: DSCR covenant, loan schedule, sources & uses, and lender conditions.",
    supportedFormats: ["pdf", "docx", "xlsx"],
    requiredData: ["project", "financial_outputs", "debt_metrics"],
    stakeholder: "lender",
    requiresUnderwriting: true,
  },
  {
    type: "executive_summary",
    title: "Executive Summary",
    description: "One- to two-page recommendation, key metrics, top risks, and required actions.",
    supportedFormats: ["pdf", "docx"],
    requiredData: ["project", "financial_outputs"],
    stakeholder: "executive",
    requiresUnderwriting: true,
  },
  {
    type: "internal_team_report",
    title: "Internal Team Report",
    description:
      "Operational report: assumption register, defaults, reconciliation, audit trail, and action items.",
    supportedFormats: ["pdf", "xlsx"],
    requiredData: ["project"],
    stakeholder: "internal",
    requiresUnderwriting: false,
  },
];

export const REPORT_BY_TYPE: Record<ReportType, ReportDefinition> = Object.fromEntries(
  REPORT_DEFINITIONS.map((d) => [d.type, d]),
) as Record<ReportType, ReportDefinition>;

export const REPORT_TYPES = REPORT_DEFINITIONS.map((d) => d.type);
