// Dispatcher: build the normalized report document (MemoReport shape) for a
// given report type from loaded ReportData. Pure and deterministic.

import type { MemoReport } from "../memo-report";
import type { ReportData } from "./report-data.server";
import type { ReportType } from "./report-definitions";
import { buildInvestorReport } from "./build-investor-report";
import { buildLenderPackage } from "./build-lender-package";
import { buildExecutiveSummary } from "./build-executive-summary";
import { buildInternalTeamReport } from "./build-internal-team-report";

export function buildReport(
  reportType: ReportType,
  data: ReportData,
  opts: { generatedLabel: string },
): MemoReport {
  switch (reportType) {
    case "investor_report":
      return buildInvestorReport(data, opts);
    case "lender_package":
      return buildLenderPackage(data, opts);
    case "executive_summary":
      return buildExecutiveSummary(data, opts);
    case "internal_team_report":
      return buildInternalTeamReport(data, opts);
    default:
      throw new Error(`Unknown report type: ${reportType}`);
  }
}
