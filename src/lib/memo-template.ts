// Deterministic memo template: produces an investor memo with ZERO AI
// involvement. Every figure is lifted verbatim from an approved/default_accepted/
// calculated assumption, a deterministic engine output (preferring its
// formula_text), a reconciliation flag, or the deterministic verdict. It never
// computes or invents a number of its own, so the output passes the same
// numeric-provenance verifier the AI path uses.

import type {
  ProjectRow,
  AssumptionRow,
  EngineInputRow,
  OutputRow,
  CashFlowRow,
  FlagRow,
  RiskRow,
} from "./reports/report-data.server";

export type DeterministicMemoContext = {
  project: ProjectRow;
  assumptions: AssumptionRow[];
  engineInputs: EngineInputRow[];
  outputs: OutputRow[];
  cashFlows: CashFlowRow[];
  flags: FlagRow[];
  risks: RiskRow[];
  errorFlags: FlagRow[];
  verdict: {
    code: string;
    hardFail?: boolean;
    gates: Array<{ key: string; label: string; pass: boolean; actual?: number }>;
  };
};

const grouped = (n: number, decimals = 0) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals }).format(n);

function fmtByUnit(value: number | null | undefined, unit: string | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "Not available";
  const n = Number(value);
  switch (unit) {
    case "$":
      return `$${grouped(n)}`;
    case "%":
      return `${grouped(n, 2)}%`;
    case "x":
      return `${n.toFixed(2)}x`;
    case "bps":
      return `${grouped(n)} bps`;
    case "SF":
      return `${grouped(n)} SF`;
    case "units":
      return `${grouped(n)} units`;
    case "$/SF":
      return `$${grouped(n)} per SF`;
    default:
      return grouped(n, 2);
  }
}

const bullet = (lines: string[]) => lines.filter(Boolean).join("\n");

export function buildDeterministicMemo(ctx: DeterministicMemoContext): Record<string, string> {
  const { project, assumptions, outputs, flags, risks, errorFlags, verdict } = ctx;

  const baseMetric = (key: string) =>
    outputs.find((o) => o.scenario_key === "base" && o.metric_key === key);
  // Render a metric by its FINAL value (always an allowed engine output). We
  // intentionally do NOT echo formula_text here: a formula can quote derived
  // intermediates (e.g. component GPRs) that are not standalone allowed values,
  // which would (correctly) trip the provenance verifier. Final values always
  // trace cleanly.
  const metricLine = (o: OutputRow | undefined) =>
    o ? `• ${o.metric_label}: ${fmtByUnit(o.value_numeric, o.unit)}` : "";
  const assumptionByKey = (key: string) => assumptions.find((a) => a.field_key === key);
  const assumptionLine = (a: AssumptionRow | undefined) =>
    a ? `• ${a.field_label}: ${fmtByUnit(a.value_numeric, a.unit)}` : "";

  // ---- Executive Summary ----
  const headlineKeys = [
    "total_project_cost",
    "equity_requirement",
    "yield_on_cost",
    "development_spread",
    "irr_estimate",
    "equity_multiple",
    "dscr",
  ];
  const headline = headlineKeys.map(baseMetric).filter(Boolean) as OutputRow[];
  const executive_summary = bullet([
    `${project.name} is a ${project.type ?? "development"} project${project.location ? ` in ${project.location}` : ""}.`,
    `Deterministic underwriting verdict: ${verdict.code}.`,
    headline.length ? "Headline results:" : "",
    ...headline.map(metricLine),
    errorFlags.length
      ? `${errorFlags.length} unresolved error-severity reconciliation flag(s) require attention.`
      : "",
    "This memo was generated from the deterministic engine without an AI provider.",
  ]);

  // ---- Project Description ----
  const program: string[] = [];
  const resUnits = assumptionByKey("residential_units");
  const retailSf = assumptionByKey("retail_sf");
  const officeSf = assumptionByKey("office_sf");
  if (resUnits?.value_numeric != null)
    program.push(`${fmtByUnit(resUnits.value_numeric, "units")} residential`);
  if (retailSf?.value_numeric != null)
    program.push(`${fmtByUnit(retailSf.value_numeric, "SF")} retail`);
  if (officeSf?.value_numeric != null)
    program.push(`${fmtByUnit(officeSf.value_numeric, "SF")} office`);
  const project_description = bullet([
    `${project.name}: ${project.type ?? "development"}${project.location ? `, ${project.location}` : ""}. Status: ${project.status ?? "n/a"}.`,
    program.length ? `Program: ${program.join(", ")}.` : "",
  ]);

  // ---- Sources & Uses ----
  const uses = ["land_cost", "hard_costs", "soft_costs", "financing_costs", "contingency"]
    .map((k) => assumptionLine(assumptionByKey(k)))
    .filter(Boolean);
  const tdc = baseMetric("total_project_cost") ?? assumptionByKey("total_project_cost");
  const sources_and_uses = bullet([
    "USES:",
    ...uses,
    tdc ? `• Total Project Cost: ${fmtByUnit(tdc.value_numeric, "$")}` : "",
    "SOURCES:",
    assumptionLine(assumptionByKey("debt_amount")),
    assumptionLine(assumptionByKey("equity_amount")),
  ]);

  // ---- Approved Assumptions ----
  const approved_assumptions =
    bullet(
      assumptions.map(
        (a) => `• ${a.field_label}: ${fmtByUnit(a.value_numeric, a.unit)} [${a.status}]`,
      ),
    ) || "No approved assumptions on record.";

  // ---- Financial Highlights ----
  const base = outputs.filter(
    (o) => o.scenario_key === "base" && o.metric_key !== "verdict" && o.metric_key !== "risk_score",
  );
  const financial_highlights = bullet(base.map(metricLine)) || "Insufficient approved data.";

  // ---- Scenario / Stress Summary ----
  // Labels carry no numeric deltas: the stress parameters are not engine
  // outputs and would not trace through provenance.
  const SCEN_LABELS: Record<string, string> = {
    base: "Base Case",
    cap_expansion: "Cap Expansion",
    cost_overrun: "Cost Overrun",
    rate_shock: "Rate Shock",
    revenue_down: "Revenue Downside",
    combined: "Combined Stress",
  };
  const scenarioOrder = [
    "base",
    "cap_expansion",
    "cost_overrun",
    "rate_shock",
    "revenue_down",
    "combined",
  ];
  const stressKeys = ["dscr", "equity_multiple", "exit_value", "yield_on_cost"];
  const scenario_stress_summary =
    bullet(
      scenarioOrder
        .filter((sk) => outputs.some((o) => o.scenario_key === sk))
        .map((sk) => {
          const parts = stressKeys
            .map((mk) => outputs.find((o) => o.scenario_key === sk && o.metric_key === mk))
            .filter(Boolean)
            .map((o) => `${o!.metric_label} ${fmtByUnit(o!.value_numeric, o!.unit)}`);
          return `• ${SCEN_LABELS[sk] ?? sk}: ${parts.join(" · ")}`;
        }),
    ) || "No scenario outputs.";

  // ---- Key Risks (risk register titles + verdict gate failures) ----
  const gateFailures = verdict.gates
    .filter((g) => !g.pass)
    .map(
      (g) =>
        `• Gate not met: ${g.label} (actual ${g.actual == null ? "n/a" : Number(g.actual).toFixed(2)})`,
    );
  const key_risks =
    bullet([...risks.map((r) => `• [${r.severity}] ${r.title}`), ...gateFailures]) ||
    "No automated risk flags.";

  // ---- Reconciliation Flags ----
  const reconciliation_flags_summary = flags.length
    ? bullet(flags.map((f) => `• [${f.severity}] ${f.check_key}: ${f.message}`))
    : "No reconciliation flags raised.";

  // ---- Investment Committee Recommendation ----
  const passCount = verdict.gates.filter((g) => g.pass).length;
  const profit = baseMetric("projected_profit") ?? baseMetric("development_profit");
  const investment_committee_recommendation = bullet([
    `Recommendation: ${verdict.code}.`,
    `Gate summary: ${passCount} of ${verdict.gates.length} underwriting gates pass.`,
    verdict.code === "REJECT" && profit
      ? `Projected development profit is stated plainly: ${fmtByUnit(profit.value_numeric, profit.unit)}.`
      : "",
    errorFlags.length
      ? `${errorFlags.length} unresolved error-severity reconciliation flag(s) factored into the verdict.`
      : "",
  ]);

  // ---- Sources and Assumptions ----
  const docs = Array.from(new Set(assumptions.map((a) => a.source_location).filter(Boolean)));
  const sources_and_assumptions = bullet([
    "Generated deterministically from approved assumptions and the deterministic underwriting engine. No values were produced by a language model.",
    "Every figure traces to an approved / default-accepted / calculated assumption or a deterministic engine output.",
    docs.length ? `Source documents: ${docs.join(", ")}.` : "",
  ]);

  return {
    executive_summary,
    project_description,
    sources_and_uses,
    approved_assumptions,
    financial_highlights,
    scenario_stress_summary,
    key_risks,
    reconciliation_flags_summary,
    investment_committee_recommendation,
    sources_and_assumptions,
  };
}
