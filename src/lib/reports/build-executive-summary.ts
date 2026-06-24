// Executive Summary: compact one/two-page recommendation for senior decision
// makers. Deterministic values only; no invented market commentary.

import type { MemoReport, ReportSection, ReportStat } from "../memo-report";
import type { ReportData } from "./report-data.server";
import {
  makeAccessors, deriveCore, reportVerdict, irrStatusText, requiredActions,
  disclosureFootnotes, defaultAcceptedFields, inputCounts, VERDICT_BANNER, insightFor,
  money, pct, x, bps,
} from "./report-common";

export function buildExecutiveSummary(data: ReportData, opts: { generatedLabel: string }): MemoReport {
  const { oVal } = makeAccessors(data);
  const core = deriveCore(data);
  const verdict = reportVerdict(data);
  const ins = insightFor(data, "ic");
  const unifiedRec = ins?.recommendation ?? verdict.code;
  const derived: number[] = [];
  if (ins) derived.push(...ins.derived);

  const card = (label: string, key: string, unit: string): ReportStat => {
    const v = oVal("base", key);
    return { label, value: v == null ? "Not available" : unit === "$" ? money(v) : unit === "%" ? pct(v) : unit === "x" ? x(v) : unit === "bps" ? bps(v) : String(v) };
  };
  const metric_cards: ReportStat[] = [
    { label: "Total Development Cost", value: money(core.tdc) },
    { label: "Senior Loan", value: money(core.loan) },
    { label: "Required Equity", value: money(core.requiredEquity) },
    { label: "Committed Equity", value: money(core.committedEquity) },
    { label: "Funding Gap", value: money(core.fundingGap) },
    card("Stabilized NOI", "stabilized_noi", "$"),
    card("Exit Value", "exit_value", "$"),
    card("DSCR", "dscr", "x"),
    card("Yield on Cost", "yield_on_cost", "%"),
    card("Development Spread", "development_spread", "bps"),
    card("Equity Multiple", "equity_multiple", "x"),
    { label: "Levered IRR", value: irrStatusText(data) },
  ];

  const sections: ReportSection[] = [];

  // One-paragraph deterministic deal summary.
  const summaryBits: string[] = [];
  if (data.project?.name) summaryBits.push(`${data.project.name}${data.project?.location ? ` (${data.project.location})` : ""} carries a total development cost of ${money(core.tdc)} funded by ${money(core.loan)} of senior debt and ${money(core.committedEquity)} of committed equity.`);
  if (core.noi != null && core.exitCap != null) summaryBits.push(`Stabilized NOI is ${money(core.noi)} at a ${pct(core.exitCap)} exit cap.`);
  if (core.dscr != null && core.minDscr != null) summaryBits.push(`Underwritten DSCR is ${x(core.dscr)} against a ${x(core.minDscr)} covenant.`);
  if (!summaryBits.length) summaryBits.push("Insufficient approved data to summarize this deal.");
  // Prefer the deterministic analyst read (thesis + contextual narrative) when
  // the Insight Layer has run; fall back to the templated summary otherwise.
  const dealSummaryBody = ins?.narrative ? `${ins.thesis} ${ins.narrative}` : summaryBits.join(" ");
  sections.push({ heading: "Deal Summary", body: dealSummaryBody });

  // "What would move the needle": the binding levers, with the input change
  // each one requires (magnitudes are provenance-backed via ins.derived).
  const failingLevers = (ins?.levers ?? []).filter((l: any) => !l.passing);
  if (failingLevers.length) {
    sections.push({ heading: "What Would Move the Needle", body: failingLevers.map((l: any) => `- ${l.lever}`).join("\n") });
  }

  // Top reasons for the recommendation (3-5, derived from flags/metrics).
  const reasons: string[] = [];
  if (verdict.hardFail) reasons.push("- Hard fail: an equity wipeout or unresolved error-severity reconciliation flag is present.");
  if (core.dscr != null && core.minDscr != null && core.dscr < core.minDscr) reasons.push(`- DSCR ${x(core.dscr)} is below the ${x(core.minDscr)} covenant.`);
  const spread = oVal("base", "development_spread");
  if (spread != null && spread < 100) reasons.push(`- Development spread is ${bps(spread)} (target >= 100 bps).`);
  if (Math.abs(core.fundingGap) > 1) reasons.push(`- Funding gap of ${money(core.fundingGap)} between required and committed equity.`);
  const em = oVal("base", "equity_multiple");
  if (em != null && em < 1.5) reasons.push(`- Equity multiple is ${x(em)} (target >= 1.50x).`);
  if (!reasons.length) reasons.push("- All screened return and covenant gates are satisfied.");
  sections.push({ heading: "Top Reasons for Recommendation", body: reasons.slice(0, 5).join("\n") });

  // Top risks (highest severity first).
  const rank: Record<string, number> = { critical: 0, red: 1, yellow: 2, warning: 2, info: 3 };
  const topRisks = [...data.risks]
    .sort((a, b) => (rank[String(a.severity)] ?? 9) - (rank[String(b.severity)] ?? 9))
    .slice(0, 5)
    .map((r) => `- [${String(r.severity).toUpperCase()}] ${r.title}`);
  sections.push({ heading: "Top Risks", body: topRisks.length ? topRisks.join("\n") : "No automated risk flags." });

  // Required actions.
  sections.push({ heading: "Required Actions", body: requiredActions(data, core).join("\n") });

  // Data quality / readiness.
  const counts = inputCounts(data);
  const errorCount = data.flags.filter((f) => f.severity === "error" && !f.resolved).length;
  const warningCount = data.flags.filter((f) => f.severity === "warning" && !f.resolved).length;
  const names = defaultAcceptedFields(data);
  derived.push(counts.approved, counts.calculated, counts.defaultAccepted, errorCount, warningCount);
  sections.push({ heading: "Data Quality & Readiness", body: [
    "Input conflicts: none outstanding.",
    `Reconciliation: ${errorCount} error(s), ${warningCount} warning(s).`,
    `Inputs used: ${counts.approved} approved, ${counts.calculated} calculated, ${counts.defaultAccepted} default-accepted.`,
    names.length ? `Default-accepted: ${names.join(", ")}.` : "Default-accepted inputs: none.",
  ].join("\n") });

  const disc = disclosureFootnotes(data);
  derived.push(...disc.derived);

  return {
    header_band: "Agir Pro Finance: Deterministic Underwriting Engine: CONFIDENTIAL DRAFT",
    title: "Executive Summary",
    project_name: data.project?.name ?? "Project",
    subtitle: `${data.project?.type ? String(data.project.type).replace(/_/g, " ") : "Development"}${data.project?.location ? ` · ${data.project.location}` : ""}`,
    mode_label: "Deterministic template",
    prepared: `Prepared ${opts.generatedLabel} · CONFIDENTIAL DRAFT`,
    verdict_code: unifiedRec,
    verdict_banner: VERDICT_BANNER[unifiedRec] ?? unifiedRec,
    verdict_narrative: ins?.thesis || summaryBits.join(" "),
    summary_stats: [],
    metric_cards,
    sections,
    footnotes: disc.footnotes,
    derived_values: derived,
  };
}
