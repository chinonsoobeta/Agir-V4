// Internal Team Report: operational report for analysts/PMs. Assumption
// register, defaults, reconciliation, risks, model outputs, documents, audit
// trail, and action items. Each section maps to an XLSX tab. Can be generated
// before underwriting (with missing-data disclosures).

import { fmtByUnit, type MemoReport, type ReportSection } from "../memo-report";
import type { ReportData } from "./report-data.server";
import {
  makeAccessors,
  deriveCore,
  reportVerdict,
  requiredActions,
  disclosureFootnotes,
  assumptionSourceLabel,
  money,
  x,
  sanitizeSymbols,
} from "./report-common";

const SCEN_LABELS: Record<string, string> = {
  base: "Base",
  cap_expansion: "Cap Expansion",
  cost_overrun: "Cost Overrun",
  rate_shock: "Rate Shock",
  revenue_down: "Revenue Downside",
  combined: "Combined Stress",
};
const fmtDate = (s: unknown) =>
  s ? new Date(String(s)).toISOString().slice(0, 10) : "Not available";

export function buildInternalTeamReport(
  data: ReportData,
  opts: { generatedLabel: string },
): MemoReport {
  const { oVal } = makeAccessors(data);
  const core = deriveCore(data);
  const verdict = reportVerdict(data);
  const derived: number[] = [];
  const trackAll = (ns: unknown[]) =>
    ns.forEach((n) => {
      const v = Number(n);
      if (Number.isFinite(v)) derived.push(v);
    });

  const sections: ReportSection[] = [];

  // 1. Summary: project + workflow status.
  const statusCount = (st: string) => data.assumptions.filter((a) => a.status === st).length;
  const counts = {
    documents: data.documents.length,
    assumptions: data.assumptions.length,
    approved: statusCount("approved"),
    extracted: statusCount("extracted"),
    missing: statusCount("missing"),
    conflicting: statusCount("conflicting"),
    calculated: statusCount("calculated"),
    modified: statusCount("modified"),
    needsReview: statusCount("needs_review"),
    defaults: data.engineInputs.filter((i) => i.status === "default_accepted").length,
    outputs: data.outputs.length,
    decisions: data.decisions.length,
    memos: data.memos.length,
  };
  trackAll(Object.values(counts));
  sections.push({
    heading: "Summary",
    table: {
      columns: ["Field", "Value"],
      rows: [
        ["Project", String(data.project?.name ?? "Not available")],
        ["Status", String(data.project?.status ?? "Not available")],
        ["Documents", String(counts.documents)],
        ["Assumptions", String(counts.assumptions)],
        ["Underwriting", counts.outputs > 0 ? "Generated" : "Not started"],
        ["Memo", counts.memos > 0 ? "Generated" : "Not started"],
        ["IC decision", counts.decisions > 0 ? "Recorded" : "None"],
        ["Verdict", verdict.code],
      ],
    },
  });

  // 2. Assumption register summary (status counts).
  sections.push({
    heading: "Assumption Register",
    table: {
      columns: ["Status", "Count"],
      rows: [
        ["Approved", String(counts.approved)],
        ["Modified", String(counts.modified)],
        ["Calculated", String(counts.calculated)],
        ["Extracted", String(counts.extracted)],
        ["Conflicting", String(counts.conflicting)],
        ["Missing", String(counts.missing)],
        ["Needs review", String(counts.needsReview)],
        ["Default-accepted (engine)", String(counts.defaults)],
      ],
    },
  });

  // 3. Assumption detail.
  trackAll(data.assumptions.map((a) => a.confidence_score));
  sections.push({
    heading: "Assumptions",
    table: {
      columns: ["Field", "Category", "Value", "Status", "Confidence", "Source"],
      rows: data.assumptions.map((a) => [
        String(a.field_label ?? a.field_key ?? "Not available"),
        String(a.category ?? "Not available"),
        a.value_numeric != null
          ? fmtByUnit(Number(a.value_numeric), a.unit)
          : String(a.value_text ?? "Not available"),
        String(a.status ?? "Not available"),
        `${a.confidence_score ?? 0}% ${a.confidence_band ?? ""}`.trim(),
        assumptionSourceLabel(data, a),
      ]),
    },
  });

  // 4. Defaults used.
  const defaultRows = data.engineInputs.filter((i) => i.status === "default_accepted");
  if (defaultRows.length) {
    trackAll(defaultRows.map((d) => d.value_numeric));
    sections.push({
      heading: "Defaults",
      table: {
        columns: ["Field", "Value", "Source", "Accepted at"],
        rows: defaultRows.map((d) => [
          String(d.key),
          d.value_numeric == null ? "Not available" : String(d.value_numeric),
          "Default accepted",
          fmtDate(d.approved_at),
        ]),
      },
    });
  } else {
    sections.push({ heading: "Defaults", body: "No default-accepted inputs." });
  }

  // 5. Reconciliation flags.
  sections.push({
    heading: "Reconciliation Flags",
    table: {
      columns: ["Check", "Severity", "Detail", "Expected", "Actual", "Resolved"],
      rows: data.flags.length
        ? data.flags.map((f) => [
            String(f.check_key ?? "-"),
            String(f.severity ?? "").toUpperCase(),
            sanitizeSymbols(f.message ?? ""),
            f.expected == null ? "Not available" : String(f.expected),
            f.actual == null ? "Not available" : String(f.actual),
            f.resolved ? "yes" : "no",
          ])
        : [
            [
              "Not available",
              "Not available",
              "No reconciliation flags.",
              "Not available",
              "Not available",
              "Not available",
            ],
          ],
    },
  });

  // 6. Risk register.
  sections.push({
    heading: "Risks",
    table: {
      columns: ["Severity", "Type", "Title", "Description"],
      rows: data.risks.length
        ? data.risks.map((r) => [
            String(r.severity ?? "").toUpperCase(),
            String(r.risk_type ?? "Not available"),
            String(r.title ?? "Not available"),
            sanitizeSymbols(r.description ?? ""),
          ])
        : [["Not available", "Not available", "No risks recorded.", "Not available"]],
    },
  });

  // 7. Model outputs (base + stress headline metrics).
  const scenarioOrder = [
    "base",
    "cap_expansion",
    "cost_overrun",
    "rate_shock",
    "revenue_down",
    "combined",
  ].filter((sk) => data.outputs.some((o) => o.scenario_key === sk));
  if (scenarioOrder.length) {
    const metrics: Array<[string, string]> = [
      ["NOI", "stabilized_noi"],
      ["Exit value", "exit_value"],
      ["Development profit", "projected_profit"],
      ["DSCR", "dscr"],
      ["Equity multiple", "equity_multiple"],
      ["Yield on cost", "yield_on_cost"],
    ];
    sections.push({
      heading: "Financial Outputs",
      table: {
        columns: ["Metric", ...scenarioOrder.map((s) => SCEN_LABELS[s] ?? s)],
        rows: metrics.map(([label, key]) => [
          label,
          ...scenarioOrder.map((sk) => {
            const v = oVal(sk, key);
            return v == null
              ? "Not available"
              : key === "dscr" || key === "equity_multiple"
                ? x(v)
                : key === "yield_on_cost"
                  ? `${v.toFixed(2)}%`
                  : money(v);
          }),
        ]),
      },
    });
  } else {
    sections.push({
      heading: "Financial Outputs",
      body: "No financial outputs. Run deterministic underwriting first.",
    });
  }

  // 8. Cash flows.
  if (data.cashFlows.length) {
    const cf = [...data.cashFlows].sort(
      (a, b) =>
        a.period_year - b.period_year ||
        String(a.scenario_key).localeCompare(String(b.scenario_key)),
    );
    sections.push({
      heading: "Cash Flows",
      table: {
        columns: ["Scenario", "Year", "Line", "Amount"],
        rows: cf
          .slice(0, 200)
          .map((c) => [
            String(c.scenario_key ?? "Not available"),
            String(c.period_year ?? "Not available"),
            String(c.line_key ?? "Not available"),
            c.amount == null ? "Not available" : money(Number(c.amount)),
          ]),
      },
    });
  }

  // 9. Documents.
  sections.push({
    heading: "Documents",
    table: {
      columns: ["Document", "Category", "Status", "Uploaded"],
      rows: data.documents.length
        ? data.documents.map((d) => [
            String(d.name ?? "Not available"),
            String(d.category ?? "Not available"),
            String(d.status ?? "Not available"),
            fmtDate(d.upload_date),
          ])
        : [["Not available", "Not available", "No documents.", "Not available"]],
    },
  });

  // 10. Audit log.
  sections.push({
    heading: "Audit Log",
    table: {
      columns: ["Time", "Action", "Entity"],
      rows: data.auditLogs
        .slice(0, 60)
        .map((a) => [
          fmtDate(a.created_at),
          String(a.action ?? "Not available"),
          String(a.entity_type ?? "Not available"),
        ]),
    },
  });

  // 11. Action items (operational).
  const actionItems = [
    ...data.flags
      .filter((f) => f.severity === "error" && !f.resolved)
      .map((f) => `- Resolve reconciliation error: ${f.check_key}.`),
    ...(counts.extracted > 0 ? ["- Review extracted assumptions that are not yet approved."] : []),
    ...(counts.missing > 0 ? ["- Enter or default the missing required assumptions."] : []),
    ...(counts.conflicting > 0 ? ["- Resolve conflicting assumptions."] : []),
    ...requiredActions(data, core),
    ...(counts.memos === 0 ? ["- Generate the investment memo."] : []),
    ...(counts.decisions === 0 ? ["- Record the IC decision."] : []),
  ];
  sections.push({ heading: "Action Items", body: actionItems.join("\n") });

  const disc = disclosureFootnotes(data);
  derived.push(...disc.derived);

  return {
    header_band: "Agir Pro Finance: Deterministic Underwriting Engine: INTERNAL",
    title: "Internal Team Report",
    project_name: data.project?.name ?? "Project",
    subtitle: `${data.project?.type ? String(data.project.type).replace(/_/g, " ") : "Development"}${data.project?.location ? ` · ${data.project.location}` : ""}`,
    mode_label: "Deterministic template",
    prepared: `Prepared ${opts.generatedLabel} · INTERNAL`,
    verdict_code: verdict.code,
    verdict_banner: `Workflow verdict: ${verdict.code}`,
    verdict_narrative: "",
    summary_stats: [],
    metric_cards: [],
    sections,
    footnotes: disc.footnotes,
    derived_values: derived,
  };
}
