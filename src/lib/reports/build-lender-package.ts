// Lender Package: debt-focused review package. Covenant compliance, debt
// service, stress-case debt metrics, reconciliation flags, lender risk summary,
// and auto-generated lender conditions. Deterministic; no invented numbers.

import type { MemoReport, ReportSection, ReportStat } from "../memo-report";
import type { ReportData } from "./report-data.server";
import {
  makeAccessors, deriveCore, reportVerdict, disclosureFootnotes, requiredActions,
  money, pct, x, bps, sanitizeSymbols,
} from "./report-common";

const SCEN_LABELS: Record<string, string> = {
  base: "Base", cap_expansion: "Cap Expansion", cost_overrun: "Cost Overrun",
  rate_shock: "Rate Shock", revenue_down: "Revenue Downside", combined: "Combined Stress",
};

export function buildLenderPackage(data: ReportData, opts: { generatedLabel: string }): MemoReport {
  const { oVal, eVal, aVal } = makeAccessors(data);
  const core = deriveCore(data);
  const verdict = reportVerdict(data);
  const derived: number[] = [];
  const track = (n: number) => { if (Number.isFinite(n)) derived.push(n); return n; };

  const scenarioOrder = ["base", "cap_expansion", "cost_overrun", "rate_shock", "revenue_down", "combined"]
    .filter((sk) => data.outputs.some((o) => o.scenario_key === sk));

  const sections: ReportSection[] = [];

  // 1. Loan summary
  const interest = aVal("interest_rate") ?? eVal("interest_rate_pct");
  const amort = aVal("amortization_years") ?? eVal("amort_years");
  const io = eVal("io_months");
  const hold = eVal("hold_years");
  const loanSummary: string[][] = [
    ["Senior loan amount", money(core.loan)],
    ["Loan-to-cost", core.ltc == null ? "Not available" : pct(core.ltc)],
    ["Interest rate", interest == null ? "Not available" : pct(interest)],
    ["Amortization", amort == null ? "Not available" : `${amort} years`],
    ...(io != null && io > 0 ? [["Interest-only period", `${io} months`]] : []),
    ["Minimum DSCR covenant", core.minDscr == null ? "Not available" : x(core.minDscr)],
    ["Stabilization requirement", core.lenderOcc == null ? "Not available" : pct(core.lenderOcc)],
    ["Exit cap", core.exitCap == null ? "Not available" : pct(core.exitCap)],
    ["Hold period", hold == null ? "Not available" : `${hold} years`],
    ["Loan payoff at exit", oVal("base", "loan_payoff_at_exit") == null ? "Not available" : money(oVal("base", "loan_payoff_at_exit")!)],
  ];
  sections.push({ heading: "Loan Summary", table: { columns: ["Term", "Value"], rows: loanSummary } });

  // 2. Sources & uses
  const su: string[][] = [
    ["USES", ""],
    ["Total Development Cost", money(core.tdc)],
    ["SOURCES", ""],
    ["Senior debt", money(core.loan)],
    ["Committed equity", money(core.committedEquity)],
    ...(Math.abs(core.fundingGap) > 1 ? [["Funding gap (uncommitted)", money(core.fundingGap)]] : []),
    ["Required equity", money(core.requiredEquity)],
  ];
  sections.push({ heading: "Sources & Uses", table: { columns: ["Item", "Amount"], rows: su,
    note: "Required equity = TDC less senior debt. Funding gap = required equity less committed equity." } });

  // 3. Covenant compliance
  const ads = oVal("base", "annual_debt_service");
  const requiredNoi = core.minDscr != null && ads != null ? track(core.minDscr * ads) : null;
  const cov: string[][] = [];
  if (core.minDscr != null && core.dscr != null) {
    cov.push(["Minimum DSCR", `Required ${x(core.minDscr)}`, x(core.dscr), core.dscr >= core.minDscr ? "PASS" : "BREACH"]);
  }
  if (requiredNoi != null && core.noi != null) {
    cov.push(["Required vs actual NOI", `Required ${money(requiredNoi)}`, money(core.noi), core.noi >= requiredNoi ? "PASS" : "SHORT"]);
  }
  if (core.ltc != null) cov.push(["Loan-to-cost", `Loan ${money(core.loan)} / TDC ${money(core.tdc)}`, pct(core.ltc), "INFO"]);
  for (const r of data.revenue) {
    const occ = r.occupancy_pct == null ? null : Number(r.occupancy_pct);
    if (occ != null && core.lenderOcc != null) {
      cov.push([`Occupancy: ${r.unit_type}`, `Requirement ${pct(core.lenderOcc)}`, pct(occ), occ >= core.lenderOcc ? "PASS" : "BELOW"]);
    }
  }
  if (cov.length) sections.push({ heading: "Covenant Compliance", table: { columns: ["Covenant", "Basis", "Underwritten", "Status"], rows: cov } });

  // 4. Debt service
  const ioDscrRow = data.outputs.find((o) => o.scenario_key === "base" && o.metric_key === "interest_only_dscr");
  const debt: string[][] = [
    ["Annual debt service", ads == null ? "Not available" : money(ads)],
    ...(ioDscrRow ? [["Interest-only DSCR (secondary)", x(Number(ioDscrRow.value_numeric ?? 0))]] : []),
    ["Loan payoff at exit", oVal("base", "loan_payoff_at_exit") == null ? "Not available" : money(oVal("base", "loan_payoff_at_exit")!)],
  ];
  sections.push({ heading: "Debt Service", table: { columns: ["Metric", "Value"], rows: debt } });

  // 5. Stress-case debt metrics
  if (scenarioOrder.length > 1) {
    const metrics: Array<[string, string]> = [
      ["NOI", "stabilized_noi"], ["Annual debt service", "annual_debt_service"], ["DSCR", "dscr"],
      ["Net sale proceeds", "net_sale_proceeds"], ["Loan payoff", "loan_payoff_at_exit"],
    ];
    const rows = metrics.map(([label, key]) =>
      [label, ...scenarioOrder.map((sk) => {
        const v = oVal(sk, key);
        return v == null ? "Not available" : key === "dscr" ? x(v) : money(v);
      })]);
    // Debt shortfall row (pure function: payoff - net proceeds, when positive).
    rows.push(["Debt shortfall", ...scenarioOrder.map((sk) => {
      const payoff = oVal(sk, "loan_payoff_at_exit");
      const proceeds = oVal(sk, "net_sale_proceeds");
      if (payoff == null || proceeds == null) return "Not available";
      const short = track(payoff - proceeds);
      return short > 0 ? money(short) : "none";
    })]);
    sections.push({ heading: "Stress-Case Debt Metrics", table: { columns: ["Metric", ...scenarioOrder.map((s) => SCEN_LABELS[s] ?? s)], rows } });
  }

  // 6. Reconciliation flags
  if (data.flags.length) {
    sections.push({ heading: "Reconciliation Flags", table: {
      columns: ["Check", "Severity", "Detail"],
      rows: data.flags.map((f) => [f.check_key ?? "-", String(f.severity ?? "").toUpperCase(), sanitizeSymbols(f.message ?? "")]),
    } });
  }

  // 7. Lender risk summary (qualitative, derived from flags/metrics: no numbers)
  const riskBullets: string[] = [];
  if (core.dscr != null && core.minDscr != null && core.dscr < core.minDscr) riskBullets.push("- Credit risk: underwritten DSCR is below the covenant minimum.");
  if (Math.abs(core.fundingGap) > 1) riskBullets.push("- Funding gap risk: committed equity is short of required equity.");
  if (data.flags.some((f) => String(f.check_key).startsWith("occupancy_vs_lender"))) riskBullets.push("- Stabilization risk: one or more components are below the lender occupancy requirement.");
  riskBullets.push("- Exit/refinance risk: takeout depends on the exit cap and stabilized NOI shown above.");
  sections.push({ heading: "Lender Risk Summary", body: riskBullets.join("\n") });

  // 8. Required conditions
  sections.push({ heading: "Required Conditions", body: requiredActions(data, core).join("\n") });

  // Headline stats + verdict + lender-readiness banner.
  const summary_stats: ReportStat[] = [
    { label: "Requested Senior Loan", value: money(core.loan) },
    { label: "Loan-to-Cost", value: core.ltc == null ? "Not available" : pct(core.ltc) },
    { label: "Underwritten DSCR", value: core.dscr == null ? "Not available" : x(core.dscr) },
    { label: "Min DSCR Covenant", value: core.minDscr == null ? "Not available" : x(core.minDscr) },
    { label: "Stabilized NOI", value: core.noi == null ? "Not available" : money(core.noi) },
    { label: "Funding Gap", value: money(core.fundingGap) },
  ];
  const notReady = (core.dscr != null && core.minDscr != null && core.dscr < core.minDscr) || Math.abs(core.fundingGap) > 1;
  const banner = notReady
    ? "Credit package is not lender-ready until listed conditions are resolved."
    : "Credit package meets the screened lender criteria shown.";

  const disc = disclosureFootnotes(data);
  derived.push(...disc.derived);

  return {
    header_band: "Agir Pro Finance: Deterministic Underwriting Engine: CONFIDENTIAL DRAFT",
    title: "Lender Package",
    project_name: data.project?.name ?? "Project",
    subtitle: `${data.project?.type ? String(data.project.type).replace(/_/g, " ") : "Development"}${data.project?.location ? ` · ${data.project.location}` : ""}`,
    mode_label: "Deterministic template",
    prepared: `Prepared ${opts.generatedLabel} · CONFIDENTIAL DRAFT`,
    verdict_code: verdict.code,
    verdict_banner: banner,
    verdict_narrative: banner,
    summary_stats,
    metric_cards: [],
    sections,
    footnotes: disc.footnotes,
    derived_values: derived,
  };
}
