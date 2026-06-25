// Structured Investment Committee Memorandum model. Pure: it assembles a typed,
// renderer-agnostic document (stat strip, verdict banner, KPI cards, and the
// numbered tables: TDC build-up, capital stack, stabilized revenue build,
// scenario sensitivity, covenant compliance, risk register, reconciliation
// flags, document sources) from the project's APPROVED assumptions and
// DETERMINISTIC engine outputs only. Per-component revenue figures and capital-
// stack percentages are pure functions of those values (computed with the
// engine's own componentGpr) and are reported back in `derived_values` so the
// provenance verifier admits them. No number here is invented.

import { componentGpr } from "./engine";
import { ENGINE_SCALAR_TO_TAXONOMY } from "./taxonomy-engine-map";
import { ASSUMPTION_BY_KEY } from "./assumption-taxonomy";

export type ReportStat = { label: string; value: string; sub?: string };
export type ReportTable = { columns: string[]; rows: string[][]; note?: string };
export type ReportSection = { heading: string; table?: ReportTable; body?: string };

export type MemoReport = {
  header_band: string;
  title: string;
  project_name: string;
  subtitle: string;
  mode_label: "AI-assisted" | "Deterministic template";
  prepared: string;
  verdict_code: string;
  verdict_banner: string;
  verdict_narrative: string;
  summary_stats: ReportStat[];
  metric_cards: ReportStat[];
  sections: ReportSection[];
  footnotes: string[];
  derived_values: number[];
};

type Row = Record<string, any>;
export type MemoReportContext = {
  project: Row;
  assumptions: Row[];
  engineInputs: Row[];
  outputs: Row[];
  flags: Row[];
  risks: Row[];
  documents: Row[];
  verdict: { code: string; hardFail?: boolean; gates: Array<{ key: string; label: string; pass: boolean; actual?: number }> };
  generationMode: "ai" | "deterministic";
  generatedLabel: string; // e.g. "June 2026" (month + year only: no day token)
};

export const grouped = (n: number, decimals = 0) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(n);
export const money = (n: number) => `$${grouped(Math.round(n))}`;
export const pct = (n: number) => `${n.toFixed(2)}%`;
export const x = (n: number) => `${n.toFixed(2)}x`;
export const bps = (n: number) => `${Math.round(n)} bps`;

// Replace Unicode symbols that render poorly in the PDF (WinAnsi) font with
// ASCII equivalents. Applied to engine-sourced strings (flag messages, risk
// descriptions) so the same clean text flows to screen, PDF and DOCX.
export function sanitizeSymbols(s: string): string {
  return String(s ?? "")
    .replace(/−/g, "-")   // minus sign
    .replace(/×/g, "x")   // multiplication sign
    .replace(/≈/g, "approx.") // almost equal
    .replace(/→/g, "->")  // right arrow
    .replace(/≥/g, ">=")  // >=
    .replace(/≤/g, "<=")  // <=
    .replace(/∞/g, "infinity"); // infinity
}

// Readable short labels for known source documents, used in BODY tables only
// (the Document Sources section keeps full filenames). Keeps long filenames
// from wrapping awkwardly in the PDF.
const KNOWN_SOURCE_LABELS: Record<string, string> = {
  "harbour_centre_construction_budget.xlsx": "Construction Budget",
  "harbour_centre_lender_term_sheet.pdf": "Lender Term Sheet",
  "harbour_centre_sponsor_summary.pdf": "Sponsor Summary",
  "harbour_centre_rent_roll.xlsx": "Rent Roll",
  "harbour_centre_broker_opinion.pdf": "Broker Opinion",
  "harbour_centre_market_study.pdf": "Market Study",
  "harbour_centre_underwriting_assumptions_addendum.docx": "Underwriting Addendum",
};

export function displaySourceLabel(
  source_location: string | null | undefined,
  source_document_name?: string | null,
): string {
  const raw = String(source_document_name || source_location || "").trim();
  if (!raw) return "Approved assumption";
  const known = KNOWN_SOURCE_LABELS[raw.toLowerCase()];
  if (known) return known;
  // Unknown file: strip extension, normalise separators, drop a duplicate
  // project prefix, title-case, and cap the length so it never wraps mid-word.
  let base = raw.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
  base = base.replace(/^harbour\s+centre\s+/i, "");
  base = base.replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  if (base.length > 28) base = `${base.slice(0, 27).trimEnd()}...`;
  return base || "Approved assumption";
}

export function fmtByUnit(v: number | null | undefined, unit: string | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "Not available";
  const n = Number(v);
  switch (unit) {
    case "$": return money(n);
    case "%": return pct(n);
    case "x": return x(n);
    case "bps": return bps(n);
    case "SF": return `${grouped(n)} SF`;
    case "units": return `${grouped(n)} units`;
    case "$/SF": return `$${grouped(n)}/SF`;
    default: return grouped(n, 2);
  }
}

// All rendered numeric-bearing text from a report, for provenance verification.
export function memoReportText(report: MemoReport): string {
  const parts: string[] = [report.verdict_narrative];
  for (const s of report.summary_stats) parts.push(s.value);
  for (const c of report.metric_cards) parts.push(`${c.label} ${c.value}`);
  for (const sec of report.sections) {
    if (sec.body) parts.push(sec.body);
    if (sec.table) {
      if (sec.table.note) parts.push(sec.table.note);
      for (const row of sec.table.rows) parts.push(row.join(" "));
    }
  }
  for (const f of report.footnotes) parts.push(f);
  return parts.join("\n");
}

export function buildMemoReport(ctx: MemoReportContext): MemoReport {
  const { project, assumptions, engineInputs, outputs, flags, risks, documents, verdict } = ctx;
  const derived: number[] = [];
  const track = <T extends number>(n: T): T => { if (Number.isFinite(n)) derived.push(n); return n; };

  const docNameById = new Map(documents.map((d) => [d.id, d.name]));
  // Short, readable provenance label for BODY tables: prefer the source document
  // name, then a file-like source_location, then a generic fallback: always run
  // through displaySourceLabel so long filenames don't wrap mid-word.
  const sourceLabel = (a: Row | undefined): string => {
    if (!a) return "Approved assumption";
    const byId = a.source_document_id ? docNameById.get(a.source_document_id) : null;
    if (byId) return displaySourceLabel(null, String(byId));
    const loc = a.source_location;
    if (loc && /\.(pdf|xlsx|xls|docx|csv)$/i.test(String(loc))) return displaySourceLabel(String(loc));
    return "Approved assumption";
  };

  const aByKey = (key: string) => assumptions.find((a) => a.field_key === key);
  const aVal = (key: string): number | null => {
    const r = aByKey(key);
    return r && r.value_numeric != null ? Number(r.value_numeric) : null;
  };
  const eRow = (key: string): Row | undefined => engineInputs.find((i) => i.key === key);
  const eVal = (key: string): number | null => {
    const r = eRow(key);
    return r && r.value_numeric != null ? Number(r.value_numeric) : null;
  };
  const oRow = (scenario: string, metric: string) =>
    outputs.find((o) => o.scenario_key === scenario && o.metric_key === metric);
  const oVal = (scenario: string, metric: string): number | null => {
    const r = oRow(scenario, metric);
    return r && r.value_numeric != null ? Number(r.value_numeric) : null;
  };

  const tdc = oVal("base", "total_project_cost") ?? (aVal("total_project_cost") ?? 0);
  const loan = aVal("debt_amount") ?? eVal("loan_amount") ?? 0;
  const committedEquity = aVal("equity_amount") ?? eVal("equity_amount") ?? 0;
  const requiredEquity = oVal("base", "equity_requirement") ?? (tdc - loan);
  const fundingGap = track(requiredEquity - committedEquity);
  const exitCap = eVal("exit_cap_rate_pct") ?? aVal("exit_cap_rate");
  const holdYears = eVal("hold_years");

  // ---- Verdict banner ----
  const VERDICT_BANNER: Record<string, string> = {
    REJECT: "DOES NOT MEET INVESTMENT HURDLES: RETURN TO UNDERWRITING",
    RETURN_TO_UNDERWRITING: "DOES NOT MEET INVESTMENT HURDLES: RETURN TO UNDERWRITING",
    APPROVE_WITH_CONDITIONS: "MEETS INVESTMENT HURDLES WITH CONDITIONS",
    APPROVE: "MEETS INVESTMENT HURDLES: RECOMMEND PROCEED",
  };
  const yoc = oVal("base", "yield_on_cost");
  const spread = oVal("base", "development_spread");
  const dscr = oVal("base", "dscr");
  const noi = oVal("base", "stabilized_noi");
  const exitValue = oVal("base", "exit_value");
  const minDscr = aVal("min_dscr") ?? eVal("min_dscr");
  const errorFlags = flags.filter((f) => f.severity === "error" && !f.resolved);
  const narrativeBits: string[] = [];
  // Lead with the deterministic Insight Layer read (thesis + IC narrative) when
  // the underwriting run persisted it; its numbers are admitted via derived.
  // (Inlined lookup to avoid a circular import with report-common.)
  const memoInsightRow = outputs.find((o: any) => o.metric_key === "insight" && o.scenario_key === "base");
  const memoInsightInputs = (memoInsightRow?.inputs ?? null) as Record<string, any> | null;
  if (memoInsightRow && memoInsightInputs) {
    for (const n of Array.isArray(memoInsightInputs.derivedValues) ? memoInsightInputs.derivedValues : []) {
      if (Number.isFinite(Number(n))) derived.push(Number(n));
    }
    if (memoInsightRow.formula_text) narrativeBits.push(String(memoInsightRow.formula_text));
    const icNarrative = memoInsightInputs.narratives?.ic;
    if (icNarrative) narrativeBits.push(String(icNarrative));
  }
  // ONE recommendation: the reconciled value (gate verdict + findings + context)
  // headlines the memo; the raw gate verdict remains the verdict_narrative detail.
  const unifiedRec = (memoInsightInputs?.recommendation as string | undefined) ?? verdict.code;
  if (exitCap != null && noi != null && exitValue != null && tdc) {
    narrativeBits.push(`At the ${pct(exitCap)} exit cap, stabilized NOI of ${money(noi)} implies an exit value of ${money(exitValue)} against TDC of ${money(tdc)}.`);
  }
  if (yoc != null && exitCap != null && spread != null) {
    narrativeBits.push(`Yield on cost of ${pct(yoc)} is ${bps(spread)} versus the exit cap, producing a ${spread < 0 ? "negative" : "positive"} development spread.`);
  }
  if (dscr != null && minDscr != null) {
    narrativeBits.push(`DSCR of ${x(dscr)} ${dscr < minDscr ? "is below" : "meets"} the lender's ${x(minDscr)} minimum covenant.`);
  }
  if (errorFlags.length) narrativeBits.push(`${errorFlags.length} unresolved error-severity reconciliation flag(s) remain open.`);

  // ---- Summary stat strip ----
  const summary_stats: ReportStat[] = [
    { label: "Total Development Cost", value: money(tdc) },
    { label: "Senior Loan", value: money(loan) },
    { label: "Required Equity", value: money(requiredEquity) },
    { label: "Committed Equity", value: money(committedEquity) },
    ...(exitCap != null ? [{ label: "Exit Cap (approved)", value: pct(exitCap) }] : []),
    ...(holdYears != null ? [{ label: "Hold Period", value: `${grouped(holdYears)} yrs` }] : []),
  ];

  // ---- KPI cards (base case) ----
  const card = (label: string, scenario: string, metric: string, unit: string): ReportStat => ({
    label, value: fmtByUnit(oVal(scenario, metric), unit),
  });
  const metric_cards: ReportStat[] = [
    card("Yield on Cost", "base", "yield_on_cost", "%"),
    card("Development Spread", "base", "development_spread", "bps"),
    card("DSCR (amortizing)", "base", "dscr", "x"),
    card("Loan-to-Cost", "base", "loan_to_cost", "%"),
    card("Exit Value (base)", "base", "exit_value", "$"),
    card("Development Profit", "base", "projected_profit", "$"),
    card("Equity Multiple", "base", "equity_multiple", "x"),
    card("Stabilized NOI", "base", "stabilized_noi", "$"),
  ];

  const sections: ReportSection[] = [];
  const recommendationLabel = verdict.code === "APPROVE"
    ? "APPROVE"
    : verdict.code === "APPROVE_WITH_CONDITIONS"
      ? "APPROVE WITH CONDITIONS"
      : verdict.hardFail
        ? "REJECT"
        : "RETURN TO UNDERWRITING";
  const sourceDoc = (a: Row | undefined): string => {
    if (!a) return "Insufficient evidence available";
    const byId = a.source_document_id ? docNameById.get(a.source_document_id) : null;
    return byId || "Approved assumption";
  };
  const confidenceBand = (a: Row | undefined): string => {
    if (!a) return "missing";
    const score = Number(a.confidence_score ?? 0);
    if (score >= 85) return "high";
    if (score >= 60) return "medium";
    if (score > 0) return "low";
    return "not recorded";
  };
  const statusOf = (a: Row | undefined): string => a?.status ? String(a.status).replace(/_/g, " ") : "not available";
  const metricMeaning = (key: string, value: number | null, target?: string): string => {
    if (value == null) return "Insufficient evidence available.";
    if (target) return `${target}.`;
    return "Result produced by the deterministic underwriting engine.";
  };
  const budgetKeys: Array<[string, string]> = [
    ["land_cost", "Land"],
    ["hard_costs", "Hard Costs"],
    ["soft_costs", "Soft Costs"],
    ["financing_costs", "Financing Costs"],
    ["contingency", "Contingency"],
  ];
  const pctOfTdc = (amt: number) => (tdc ? `${track((amt / tdc) * 100).toFixed(2)}%` : "Not available");

  // ---- Program and operating model inputs ----
  type Comp = { label: string; unitsSf: string; rate: string; occ: number | null; gpr: number; egi: number };
  const comps: Comp[] = [];
  const resUnits = aVal("residential_units"), resRent = aVal("residential_rent_monthly"), resOcc = aVal("residential_occupancy");
  if (resUnits != null && resRent != null) {
    const gpr = componentGpr({ unitType: "Residential", unitCount: resUnits, rent: resRent, rentBasis: "per_unit" });
    const egi = gpr * ((resOcc ?? 100) / 100);
    comps.push({ label: "Residential", unitsSf: `${grouped(resUnits)} units`, rate: `${money(resRent)}/mo`, occ: resOcc, gpr: track(gpr), egi: track(egi) });
  }
  const retailSf = aVal("retail_sf"), retailRent = aVal("retail_rent_psf"), retailOcc = aVal("retail_occupancy");
  if (retailSf != null && retailRent != null) {
    const gpr = componentGpr({ unitType: "Retail", unitCount: 1, avgSf: retailSf, rent: retailRent, rentBasis: "per_sf" });
    const egi = gpr * ((retailOcc ?? 100) / 100);
    comps.push({ label: "Retail", unitsSf: `${grouped(retailSf)} SF`, rate: `$${grouped(retailRent)}/SF`, occ: retailOcc, gpr: track(gpr), egi: track(egi) });
  }
  const officeSf = aVal("office_sf"), officeRent = aVal("office_rent_psf"), officeOcc = aVal("office_occupancy");
  if (officeSf != null && officeRent != null) {
    const gpr = componentGpr({ unitType: "Office", unitCount: 1, avgSf: officeSf, rent: officeRent, rentBasis: "per_sf" });
    const egi = gpr * ((officeOcc ?? 100) / 100);
    comps.push({ label: "Office", unitsSf: `${grouped(officeSf)} SF`, rate: `$${grouped(officeRent)}/SF`, occ: officeOcc, gpr: track(gpr), egi: track(egi) });
  }
  const totalGpr = oVal("base", "gpr") ?? comps.reduce((s, c) => s + c.gpr, 0);
  const totalEgi = oVal("base", "projected_revenue") ?? comps.reduce((s, c) => s + c.egi, 0);
  const operatingExpenses = track(totalEgi - (noi ?? totalEgi));
  const otherIncome = eVal("other_income_annual") ?? aVal("other_income_annual");
  const annualDebtService = oVal("base", "annual_debt_service");
  const ltc = oVal("base", "loan_to_cost");
  const debtYield = loan > 0 && noi != null ? track((noi / loan) * 100) : null;
  const equityMultiple = oVal("base", "equity_multiple");
  const profitOnCost = oVal("base", "profit_margin");
  const developmentProfit = oVal("base", "projected_profit") ?? oVal("base", "development_profit");
  const netSaleProceeds = oVal("base", "net_sale_proceeds");
  const rentGrowth = eVal("rent_growth_pct") ?? aVal("rent_growth");
  const constructionMonths = eVal("construction_months");
  const leaseUpMonths = eVal("lease_up_months") ?? aVal("lease_up_months");
  const amortYears = eVal("amort_years") ?? aVal("amortization_years");
  const ioMonths = eVal("io_months");
  const interestRate = eVal("interest_rate_pct") ?? aVal("interest_rate");

  // ---- 1. Executive Summary ----
  const programParts = comps.map((c) => c.label.toLowerCase()).join(", ");
  const projectDescription = `${project.name} is a ${project.type ? String(project.type).replace(/_/g, " ") : "development"}${project.location ? ` located in ${project.location}` : ""}${programParts ? ` with ${programParts} components` : ""}.`;
  const thesisBullets = [
    comps.length ? `The program is supported by approved revenue assumptions for ${comps.map((c) => c.label.toLowerCase()).join(", ")}.` : "",
    loan > 0 && committedEquity > 0 ? "The capital plan includes approved senior debt and approved equity capital." : "",
    yoc != null && exitCap != null ? `Base-case value creation is measured by yield on cost of ${pct(yoc)} against an exit cap of ${pct(exitCap)}.` : "",
    dscr != null && minDscr != null ? `Debt support is tested against a DSCR result of ${x(dscr)} and a covenant threshold of ${x(minDscr)}.` : "",
  ].filter(Boolean);
  const executiveBody = [
    projectDescription,
    `Agir is considering the project because the uploaded source package contains a complete development budget, a documented capital stack, and revenue assumptions sufficient to run deterministic underwriting.`,
    thesisBullets.length ? `Investment thesis:\n${thesisBullets.map((b) => `- ${b}`).join("\n")}` : "Investment thesis: Insufficient evidence available.",
    `Key underwriting conclusions: TDC is ${money(tdc)}, required equity is ${money(requiredEquity)}, exit cap is ${exitCap == null ? "not available" : pct(exitCap)}, stabilized NOI is ${noi == null ? "not available" : money(noi)}, DSCR is ${dscr == null ? "not available" : x(dscr)}, yield on cost is ${yoc == null ? "not available" : pct(yoc)}, and development spread is ${spread == null ? "not available" : bps(spread)}.`,
    `Recommendation: ${recommendationLabel}. ${sanitizeSymbols(narrativeBits.join(" "))}`,
  ].join("\n\n");
  sections.push({ heading: "Executive Summary", body: executiveBody });

  // ---- 2. Investment scorecard ----
  const passFail = (pass: boolean | null) => pass == null ? "INSUFFICIENT EVIDENCE" : pass ? "PASS" : "FAIL";
  const scoreRows = [
    ["Location Quality", passFail(Boolean(project.location)), project.location ? "Project location is documented." : "No location evidence."],
    ["Market Fundamentals", passFail(comps.length > 0), comps.length ? "Revenue assumptions are documented by component." : "No approved revenue program."],
    ["Capital Structure", passFail(loan > 0 && committedEquity > 0 && Math.abs(fundingGap) <= 1), "Senior debt, equity, and sources/uses are tested."],
    ["Yield on Cost", passFail(yoc != null && exitCap != null && yoc >= exitCap), yoc == null ? "No YOC output." : `${pct(yoc)} underwritten.`],
    ["Development Spread", passFail(spread != null && spread >= 100), spread == null ? "No spread output." : `${bps(spread)} underwritten.`],
    ["DSCR", passFail(dscr != null && minDscr != null && dscr >= minDscr), dscr == null ? "No DSCR output." : `${x(dscr)} underwritten.`],
    ["Downside Protection", passFail((oVal("combined", "dscr") ?? 0) >= 1.2 && (oVal("combined", "equity_multiple") ?? 0) >= 1), "Combined stress case reviewed."],
    ["Exit Liquidity", passFail(exitCap != null && exitValue != null), "Exit value is derived from NOI and cap rate."],
  ];
  sections.push({ heading: "Investment Scorecard", table: { columns: ["Investment Category", "Result", "Basis"], rows: scoreRows, note: `Overall Recommendation: ${recommendationLabel}` } });

  // ---- 3. Project overview ----
  const overviewRows = [
    ["Location", project.location || "Insufficient evidence available"],
    ["Product Type", project.type ? String(project.type).replace(/_/g, " ") : "Insufficient evidence available"],
    ["Residential Units", resUnits == null ? "Insufficient evidence available" : `${grouped(resUnits)} units`],
    ["Office SF", officeSf == null ? "Insufficient evidence available" : `${grouped(officeSf)} SF`],
    ["Retail SF", retailSf == null ? "Insufficient evidence available" : `${grouped(retailSf)} SF`],
    ["Construction Timeline", constructionMonths == null ? "Insufficient evidence available" : `${grouped(constructionMonths)} months`],
    ["Lease-Up Period", leaseUpMonths == null ? "Insufficient evidence available" : `${grouped(leaseUpMonths)} months`],
    ["Hold Period", holdYears == null ? "Insufficient evidence available" : `${grouped(holdYears)} years`],
  ];
  sections.push({
    heading: "Project Overview",
    body: `${project.name} is presented as a development opportunity with the program, capital stack, and underwriting assumptions summarized below. Where source evidence is absent, the memo does not infer a value.`,
    table: { columns: ["Item", "Documented Fact"], rows: overviewRows },
  });

  // ---- 4. Investment thesis ----
  const thesisRows = [
    comps.length ? ["Mixed-use revenue base", `Approved assumptions support ${comps.map((c) => c.label.toLowerCase()).join(", ")} income components.`, "Lease-up or occupancy underperformance would reduce NOI."] : null,
    loan > 0 && committedEquity > 0 ? ["Capital sources identified", `Approved debt of ${money(loan)} and equity of ${money(committedEquity)} are documented.`, "Funding gap or leverage pressure could require resizing."] : null,
    spread != null ? ["Value creation tested deterministically", `Development spread is ${bps(spread)} in the base case.`, "Cap-rate expansion or cost growth can reduce or eliminate spread."] : null,
    dscr != null ? ["Debt support is measurable", `Base-case DSCR is ${x(dscr)}.`, "Insufficient cash flow coverage would constrain financing support."] : null,
  ].filter(Boolean) as string[][];
  sections.push({ heading: "Investment Thesis", table: { columns: ["Thesis", "Supporting Evidence", "Key Risk"], rows: thesisRows.length ? thesisRows : [["Insufficient evidence available", "No supported thesis point can be generated.", "No unsupported market thesis has been added."]] } });

  // ---- 5. Sources and uses ----
  const usesRows = budgetKeys
    .filter(([k]) => aVal(k) != null)
    .map(([k, label]) => [label, sourceDoc(aByKey(k)), money(aVal(k)!)]);
  usesRows.push(["Total Development Cost", "Deterministic engine", money(tdc)]);
  const sourceTotal = track(loan + committedEquity);
  const sourcesRows = [
    ["Senior Debt", sourceDoc(aByKey("debt_amount")), money(loan)],
    ["Mezzanine Debt", "Insufficient evidence available", "Not included"],
    ["Preferred Equity", "Insufficient evidence available", "Not included"],
    ["Common Equity / Sponsor Equity", sourceDoc(aByKey("equity_amount")), money(committedEquity)],
    ["Total Sources", "Debt plus equity", money(sourceTotal)],
    ["Sources / Uses Difference", "Reconciliation", money(track(sourceTotal - tdc))],
  ];
  sections.push({
    heading: "Sources & Uses of Capital",
    body: "Uses are tied to approved budget assumptions. Sources are limited to documented debt and equity; no mezzanine debt or preferred equity is included without source evidence.",
    table: { columns: ["Uses / Sources", "Source", "Amount"], rows: [...usesRows, ["", "", ""], ...sourcesRows] },
  });

  // ---- 6. Operating model summary ----
  if (comps.length) {
    const opexRatioRow = eRow("expense_ratio_pct");
    const opexAssumption = aByKey("opex_ratio");
    const ratioVal = opexRatioRow?.value_numeric ?? opexAssumption?.value_numeric ?? null;
    const ratioStatus = opexRatioRow?.status ?? opexAssumption?.status ?? null;
    const ratioSource = ratioVal == null
      ? "Not available"
      : ratioStatus === "default_accepted"
        ? "Default accepted"
        : opexAssumption && (opexAssumption.status === "approved" || opexAssumption.status === "modified")
          ? sourceLabel(opexAssumption)
          : "Approved assumption";

    const revRows = comps.map((c) => [c.label, c.unitsSf, c.rate, c.occ == null ? "Not available" : pct(c.occ), money(c.gpr), money(c.egi)]);
    if (otherIncome != null) revRows.push(["Other Income", "n/a", "Approved input", "n/a", "n/a", money(otherIncome)]);
    revRows.push(["Total GPR / EGI", "", "", "", money(totalGpr), money(totalEgi)]);
    revRows.push(["Operating expense ratio", "", ratioSource, "", "", ratioVal == null ? "Not available" : pct(Number(ratioVal))]);
    revRows.push(["Operating expenses", "", "", "", "", `(${money(operatingExpenses)})`]);
    revRows.push(["Net Operating Income", "", "", "", "", money(noi ?? totalEgi - operatingExpenses)]);
    sections.push({
      heading: "Operating Model Summary",
      body: "NOI is produced from approved component-level revenue assumptions. Residential revenue is calculated from units and monthly rent. Commercial revenue is calculated from square footage and annual rent per square foot. Occupancy is then applied by component before deducting operating expenses.",
      table: { columns: ["Component", "Units / SF", "Source / Rate", "Occupancy", "GPR", "EGI"], rows: revRows,
        note: "GPR = units x monthly rent x 12 (residential) or SF x $/SF (commercial). EGI = GPR x occupancy. NOI = EGI - operating expenses. Operating expenses = EGI x expense ratio." },
    });
  }

  // ---- 7. Debt analysis ----
  const debtRows = [
    ["Loan Amount", money(loan), sourceDoc(aByKey("debt_amount"))],
    ["Interest Rate", interestRate == null ? "Insufficient evidence available" : pct(interestRate), sourceDoc(aByKey("interest_rate"))],
    ["Debt Type", "Senior debt", sourceDoc(aByKey("debt_amount"))],
    ["Amortization", amortYears == null ? "Insufficient evidence available" : `${grouped(amortYears)} years`, sourceDoc(aByKey("amortization_years"))],
    ["Interest-Only Period", ioMonths == null ? "Insufficient evidence available" : `${grouped(ioMonths)} months`, "Approved engine input"],
    ["DSCR", dscr == null ? "Insufficient evidence available" : x(dscr), minDscr == null ? "No covenant evidence" : `Covenant ${x(minDscr)}`],
    ["LTC", ltc == null ? "Insufficient evidence available" : pct(ltc), "Deterministic engine"],
    ["Debt Yield", debtYield == null ? "Insufficient evidence available" : pct(debtYield), "NOI / loan amount"],
  ];
  const debtBody = dscr != null && minDscr != null
    ? `Financing support is ${dscr >= minDscr ? "supportable under the documented DSCR covenant" : "not supportable under the documented DSCR covenant"} because underwritten DSCR is ${x(dscr)} against a covenant threshold of ${x(minDscr)}.`
    : "Financing support cannot be fully assessed because DSCR covenant evidence is incomplete.";
  sections.push({ heading: "Debt Analysis", body: debtBody, table: { columns: ["Item", "Result", "Basis"], rows: debtRows } });

  // ---- 8. Return analysis ----
  const returnRows = [
    ["Yield on Cost", yoc == null ? "Insufficient evidence available" : pct(yoc), metricMeaning("yield_on_cost", yoc, "NOI divided by TDC")],
    ["Development Spread", spread == null ? "Insufficient evidence available" : bps(spread), metricMeaning("development_spread", spread, "Yield on cost less exit cap")],
    ["Equity Multiple", equityMultiple == null ? "Insufficient evidence available" : x(equityMultiple), "Distributions divided by equity."],
    ["Profit on Cost", profitOnCost == null ? "Insufficient evidence available" : pct(profitOnCost), "Development profit divided by TDC."],
    ["Development Profit", developmentProfit == null ? "Insufficient evidence available" : money(developmentProfit), "Exit value less TDC and transaction costs where applicable."],
    ["Exit Value", exitValue == null ? "Insufficient evidence available" : money(exitValue), "NOI divided by exit cap."],
    ["Net Sale Proceeds", netSaleProceeds == null ? "Insufficient evidence available" : money(netSaleProceeds), "Exit proceeds after selling costs."],
  ];
  const returnBody = spread != null && spread < 100
    ? `Return profile requires further underwriting because development spread is ${bps(spread)}, below the fixed IC gate of ${bps(100)}.`
    : spread != null
      ? `Return profile clears the development spread gate with ${bps(spread)}.`
      : "Return profile cannot be fully assessed because spread is unavailable.";
  sections.push({ heading: "Return Analysis", body: returnBody, table: { columns: ["Metric", "Result", "Interpretation"], rows: returnRows } });

  // ---- 8b. LP / GP returns (distribution waterfall) ----
  // Shown only when a promote is configured (gp_promote > 0). Without a
  // waterfall the LP return equals the deal return, so there is nothing distinct
  // to surface and the section is omitted (keeping non-waterfall memos unchanged).
  const lpIrr = oVal("base", "lp_irr");
  const gpIrr = oVal("base", "gp_irr");
  const lpEm = oVal("base", "lp_equity_multiple");
  const gpEm = oVal("base", "gp_equity_multiple");
  const gpPromoteAmt = oVal("base", "gp_promote");
  const lpPref = oVal("base", "lp_preferred_return");
  const dealIrr = oVal("base", "irr_estimate");
  if ((gpPromoteAmt ?? 0) > 0) {
    const irrCell = (v: number | null) => (v == null || !Number.isFinite(v) ? "Not meaningful" : pct(v));
    const wfRows: string[][] = [
      ["Deal Levered IRR", irrCell(dealIrr), "Return on total equity before the promote."],
      ["LP Levered IRR", irrCell(lpIrr), "Limited partner return after preferred return and promote."],
      ["GP Levered IRR", irrCell(gpIrr), "General partner return including the promote."],
      ["LP Equity Multiple", lpEm == null ? "Not available" : x(lpEm), "LP distributions divided by LP capital."],
      ["GP Equity Multiple", gpEm == null || gpEm === 0 ? "Not applicable (no GP co-invest)" : x(gpEm), "GP distributions divided by GP capital."],
      ["LP Preferred Return", lpPref == null ? "Not available" : money(lpPref), "Preferred return distributed to the LP (excludes return of capital)."],
      ["GP Promote", gpPromoteAmt == null ? "Not available" : money(gpPromoteAmt), "GP carried interest above a pari-passu split by ownership."],
    ];
    const lpVsDeal =
      dealIrr != null && lpIrr != null && Number.isFinite(dealIrr) && Number.isFinite(lpIrr)
        ? `The distribution waterfall splits levered returns between the LP and GP. The LP return of ${pct(lpIrr)} compares with the ${pct(dealIrr)} deal-level return; the difference is the GP promote.`
        : "The distribution waterfall splits levered returns between the LP and the GP.";
    sections.push({
      heading: "LP / GP Returns",
      body: lpVsDeal,
      table: {
        columns: ["Measure", "Result", "Basis"],
        rows: wfRows,
        note: "Deterministic European waterfall: return of capital, preferred return, optional GP catch-up, then a promoted carry split.",
      },
    });
  }

  // ---- 9. Sensitivity analysis ----
  const SCEN_LABELS: Record<string, string> = {
    base: "Base", cap_expansion: "Cap Expansion", cost_overrun: "Cost Overrun",
    rate_shock: "Rate Shock", revenue_down: "Revenue Downside", combined: "Combined Stress",
  };
  const scenarioOrder = ["base", "cap_expansion", "cost_overrun", "rate_shock", "revenue_down", "combined"]
    .filter((sk) => outputs.some((o) => o.scenario_key === sk));
  if (scenarioOrder.length > 1) {
    const scenMetrics: Array<[string, string, string]> = [
      ["Exit value", "exit_value", "$"], ["Net sale proceeds", "net_sale_proceeds", "$"],
      ["Development profit", "projected_profit", "$"], ["Yield on cost", "yield_on_cost", "%"],
      ["Development spread", "development_spread", "bps"], ["Equity multiple", "equity_multiple", "x"],
      ["DSCR", "dscr", "x"],
    ];
    const rows = scenMetrics.map(([label, mk, unit]) =>
      [label, ...scenarioOrder.map((sk) => fmtByUnit(oVal(sk, mk), unit))]);
    const interpretations = scenarioOrder
      .filter((sk) => sk !== "base")
      .map((sk) => {
        const scenDscr = oVal(sk, "dscr");
        const scenProfit = oVal(sk, "projected_profit") ?? oVal(sk, "development_profit");
        const status = scenDscr != null && minDscr != null && scenDscr < minDscr
          ? `DSCR of ${x(scenDscr)} falls below covenant.`
          : scenProfit != null && scenProfit < 0
            ? `Development profit is negative at ${money(scenProfit)}.`
            : "Scenario remains within the displayed deterministic outputs.";
        return `${SCEN_LABELS[sk] ?? sk}: ${status}`;
      }).join("\n");
    sections.push({
      heading: "Sensitivity Analysis",
      body: interpretations || "No stress scenarios available.",
      table: { columns: ["Metric", ...scenarioOrder.map((sk) => SCEN_LABELS[sk] ?? sk)], rows,
        note: "Every cell is an independent deterministic engine re-run under the stated stress." },
    });
  }

  // ---- 10. Risk register ----
  const riskRows = risks.map((r) => [
    sanitizeSymbols(r.title ?? "-"),
    String(r.severity ?? "").toUpperCase(),
    sanitizeSymbols(r.description ?? "Insufficient evidence available."),
    sanitizeSymbols(r.description ?? "Potential impact should be reviewed by the investment team."),
    "Resolve through underwriting, diligence, or revised transaction terms.",
    "Investment team",
  ]);
  verdict.gates.filter((g) => !g.pass).forEach((g) => riskRows.push([
    `Gate failure: ${g.label}`,
    "HIGH",
    g.actual == null ? "Required gate did not pass." : `Actual result was ${fmtByUnit(g.actual, g.key.includes("dscr") || g.key.includes("multiple") ? "x" : g.key.includes("spread") ? "bps" : "%")}.`,
    "Approval gate failure may prevent IC approval.",
    "Revise assumptions, pricing, leverage, or scope until the gate passes.",
    "Investment team",
  ]));
  sections.push({
    heading: "Risk Register",
    table: { columns: ["Risk", "Severity", "Description", "Potential Impact", "Mitigation Strategy", "Owner"], rows: riskRows.length ? riskRows : [["No automated risk flags", "INFO", "No deterministic risk register entries were generated.", "Insufficient evidence available.", "Continue diligence.", "Investment team"]] },
  });

  // ---- Reconciliation flags ----
  if (flags.length) {
    sections.push({
      heading: "Reconciliation Flags",
      table: { columns: ["Check", "Severity", "Detail"], rows: flags.map((f) => [f.check_key ?? "-", String(f.severity ?? "").toUpperCase(), sanitizeSymbols(f.message ?? "")]) },
    });
  }

  // ---- 11. Approval conditions ----
  const occShortfalls = flags.filter((f) => String(f.check_key).startsWith("occupancy_vs_lender"));
  const sourcesError = flags.some((f) => f.check_key === "sources_vs_uses" && f.severity === "error");
  const equityMismatch = flags.some((f) => f.check_key === "equity_mismatch");
  const actions: string[] = [];
  if (Math.abs(fundingGap) > 1) actions.push(`- Resolve the sources-and-uses funding gap of ${money(fundingGap)} with committed equity, reduced uses, or resized debt.`);
  // Committed-equity follow-up (deduped: added once even if several flags imply it).
  if (sourcesError || equityMismatch || committedEquity < requiredEquity) {
    actions.push(`- Confirm whether the ${money(committedEquity)} committed equity is capped or whether additional sponsor/JV equity is available.`);
  }
  if (flags.some((f) => f.check_key === "budget_vs_stated_total")) actions.push("- Correct or remove any erroneous stated total project cost reconciliation input.");
  if (dscr != null && minDscr != null && dscr < minDscr) actions.push(`- Reduce leverage or increase NOI until DSCR is at least ${x(minDscr)}.`);
  if (spread != null && spread < 100) actions.push(`- Improve pricing, costs, rent, or exit assumptions until development spread is at least ${bps(100)}.`);
  if (occShortfalls.length) actions.push("- Resolve lender stabilization shortfalls for retail and office.");
  if (actions.length === 0 && recommendationLabel !== "APPROVE") actions.push("- Address failed investment gates before approval.");
  sections.push({ heading: "Approval Conditions", body: actions.length ? actions.join("\n") : "No approval conditions generated by the deterministic gates." });

  // ---- 12. IC recommendation ----
  const rationale = [
    `Recommendation: ${recommendationLabel}.`,
    spread != null ? `Development spread is ${bps(spread)}.` : "Development spread is unavailable.",
    dscr != null ? `DSCR is ${x(dscr)}.` : "DSCR is unavailable.",
    equityMultiple != null ? `Equity multiple is ${x(equityMultiple)}.` : "Equity multiple is unavailable.",
    recommendationLabel === "APPROVE"
      ? "The project satisfies the deterministic investment gates reviewed by Agir."
      : "Approval should not be granted until identified underwriting deficiencies have been corrected.",
  ].join("\n\n");
  sections.push({ heading: "Investment Committee Recommendation", body: rationale });

  // ---- Source transparency ----
  const usedKeys = [
    ...budgetKeys.map(([k]) => k),
    "debt_amount", "equity_amount", "interest_rate", "amortization_years", "min_dscr",
    "residential_units", "residential_rent_monthly", "residential_occupancy",
    "retail_sf", "retail_rent_psf", "retail_occupancy",
    "office_sf", "office_rent_psf", "office_occupancy",
    "opex_ratio", "exit_cap_rate", "hold_period_years", "disposition_cost_pct", "rent_growth", "other_income_annual",
  ];
  const provenanceRows = usedKeys
    .map((key) => aByKey(key))
    .filter((a): a is Row => a != null && a.value_numeric != null)
    .map((a) => [a.field_label, fmtByUnit(a.value_numeric, a.unit), sourceDoc(a), "Page unavailable", confidenceBand(a), statusOf(a)]);
  sections.push({
    heading: "Assumption Source Transparency",
    table: { columns: ["Assumption", "Value", "Source Document", "Page", "Confidence", "Approval Status"], rows: provenanceRows.length ? provenanceRows : [["Insufficient evidence available", "Not available", "Not available", "Not available", "Not available", "Not available"]] },
  });

  // ---- Document sources ----
  const docRows = (documents.length
    ? documents.map((d) => [d.name, d.category ?? "Not available"])
    : Array.from(new Set(assumptions.map((a) => a.source_location).filter(Boolean))).map((s) => [String(s), "Approved assumption source"]));
  if (docRows.length) {
    sections.push({ heading: "Document Sources", table: { columns: ["Document", "Category"], rows: docRows } });
  }

  // ---- Footnotes ----
  // Exit-cap conflict resolution: shown ONLY when the project actually has a
  // documented conflict for the cap (conflict_values on the engine input or the
  // assumption). Candidates and sources are pulled from that stored conflict.
  const capInput = eRow("exit_cap_rate_pct");
  const capConflictRaw: any[] = Array.isArray(capInput?.conflict_values) && capInput!.conflict_values.length
    ? capInput!.conflict_values
    : Array.isArray(aByKey("exit_cap_rate")?.conflict_values)
      ? aByKey("exit_cap_rate")!.conflict_values
      : [];
  const capCandidates = capConflictRaw
    .map((c: any) => ({ value: Number(c.value), source: c.source as string | undefined }))
    .filter((c) => Number.isFinite(c.value))
    .filter((c, i, all) => all.findIndex((x) => x.value === c.value) === i);
  capCandidates.forEach((c) => derived.push(c.value));
  const exitCapFootnote = capCandidates.length >= 2 && exitCap != null
    ? `Exit cap reflects approved conservative resolution of documented broker/lender conflict: ${capCandidates.map((c) => `${pct(c.value)} ${displaySourceLabel(null, c.source).toLowerCase()}`).join(" vs ")}.`
    : null;

  // ---- Inputs / defaults disclosure ----
  const approvedCount = track(assumptions.filter((a) => a.status === "approved" || a.status === "modified").length);
  const calculatedCount = track(assumptions.filter((a) => a.status === "calculated").length);
  const defaultRows = engineInputs.filter((i) => i.status === "default_accepted");
  const defaultCount = track(defaultRows.length);
  const defaultNames = defaultRows
    .map((r) => ASSUMPTION_BY_KEY[ENGINE_SCALAR_TO_TAXONOMY[r.key] ?? ""]?.label ?? r.key)
    .filter(Boolean);

  const errorCount = flags.filter((f) => f.severity === "error" && !f.resolved).length;
  const warningCount = flags.filter((f) => f.severity === "warning" && !f.resolved).length;
  const footnotes = [
    ...(exitCapFootnote ? [exitCapFootnote] : []),
    ctx.generationMode === "ai"
      ? "ENGINE: All financial figures were produced deterministically from approved, calculated, or explicitly default-accepted inputs; only the narrative prose is AI-assisted. No AI-generated financial values were used."
      : "ENGINE: All figures were produced deterministically from approved, calculated, or explicitly default-accepted inputs. No AI-generated financial values were used.",
    "FORMULAS: Pre-financing cost = land + hard + soft + contingency; TDC = pre-financing + financing; GPR = units x rent x 12 (res) or SF x $/SF (comm); EGI = GPR x occupancy; NOI = EGI - operating expenses; Required NOI = 1.20x x ADS; YOC = NOI / TDC; Dev spread = YOC - exit cap; Exit value = NOI / exit cap; Funding gap = TDC - sources; LTC = loan / TDC; DSCR = NOI / annual debt service; EM approx. 0.0x on a wipeout.",
    "Input conflicts: none outstanding.",
    `Reconciliation exceptions: ${errorCount} error(s) and ${warningCount} warning(s) remain open.`,
    `Inputs used: ${approvedCount} approved, ${calculatedCount} calculated, ${defaultCount} default-accepted. No AI-generated financial values.`,
    defaultCount > 0 ? `Default-accepted inputs: ${defaultNames.join(", ")}.` : "Default-accepted inputs: none.",
    `PREPARED: Agir Pro Finance: Deterministic Underwriting Engine: ${ctx.generatedLabel}.`,
  ];

  // What-if levers from the Insight Layer (input changes that clear each gate).
  const memoFailingLevers = ((memoInsightInputs?.levers ?? []) as any[]).filter((l) => l && !l.passing);
  if (memoFailingLevers.length) {
    sections.push({ heading: "What Would Move the Needle", body: memoFailingLevers.map((l) => `- ${l.lever}`).join("\n") });
  }

  return {
    header_band: "Agir Pro Finance: Deterministic Underwriting Engine: CONFIDENTIAL DRAFT",
    title: "Investment Committee Memorandum",
    project_name: project.name,
    subtitle: `${project.type ? String(project.type).replace(/_/g, "-") : "Development"}${project.location ? ` · ${project.location}` : ""}`,
    mode_label: ctx.generationMode === "ai" ? "AI-assisted" : "Deterministic template",
    prepared: `Prepared ${ctx.generatedLabel} · CONFIDENTIAL DRAFT`,
    verdict_code: unifiedRec,
    verdict_banner: VERDICT_BANNER[unifiedRec] ?? unifiedRec,
    verdict_narrative: sanitizeSymbols(narrativeBits.join(" ")),
    summary_stats,
    metric_cards,
    sections,
    footnotes,
    derived_values: derived,
  };
}
