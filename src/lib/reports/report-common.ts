// Shared deterministic derivations and helpers for every report builder.
// Reuses the memo report's formatting/sanitisation helpers so reports and the
// IC memo speak the same visual language. No number is invented here.

import { computeInvestmentVerdict } from "../verdict";
import { ENGINE_SCALAR_TO_TAXONOMY } from "../taxonomy-engine-map";
import { ASSUMPTION_BY_KEY } from "../assumption-taxonomy";
import { money, pct, x, bps, sanitizeSymbols, displaySourceLabel, type ReportStat } from "../memo-report";
import type { ReportData } from "./report-data.server";

import type { ReportDefinition } from "./report-definitions";

export type ReportStatus =
  | "ready" | "needs_underwriting" | "needs_memo" | "has_unresolved_errors" | "missing_project" | "missing_required_data";

// Pure readiness decision, shared by the server fn and unit tests.
export function computeReportStatus(
  def: ReportDefinition,
  ctx: { projectExists: boolean; baseOutputs: number; financialOutputs: number; reconErrors: number },
): { ready: boolean; status: ReportStatus; blocking_reasons: string[]; warnings: string[] } {
  const blocking_reasons: string[] = [];
  const warnings: string[] = [];
  if (!ctx.projectExists) {
    return { ready: false, status: "missing_project", blocking_reasons: ["No project found."], warnings: [] };
  }
  let status: ReportStatus = "ready";
  if (def.requiresUnderwriting && ctx.baseOutputs === 0) {
    status = "needs_underwriting";
    blocking_reasons.push("Run deterministic underwriting before generating this report.");
  } else if (def.requiresUnderwriting && ctx.financialOutputs === 0) {
    status = "missing_required_data";
    blocking_reasons.push("No financial outputs found. Run deterministic underwriting first.");
  } else {
    if (ctx.reconErrors > 0) {
      status = "has_unresolved_errors";
      warnings.push(`This report can be generated, but it will include ${ctx.reconErrors} unresolved reconciliation error(s).`);
    }
    if (!def.requiresUnderwriting && ctx.baseOutputs === 0) {
      warnings.push("Underwriting has not run; model outputs and cash flows will be empty.");
    }
  }
  return { ready: blocking_reasons.length === 0, status, blocking_reasons, warnings };
}

export const VERDICT_BANNER: Record<string, string> = {
  REJECT: "DOES NOT MEET INVESTMENT HURDLES: RETURN TO UNDERWRITING",
  RETURN_TO_UNDERWRITING: "DOES NOT MEET INVESTMENT HURDLES: RETURN TO UNDERWRITING",
  APPROVE_WITH_CONDITIONS: "MEETS INVESTMENT HURDLES WITH CONDITIONS",
  APPROVE: "MEETS INVESTMENT HURDLES: RECOMMEND PROCEED",
};

export function makeAccessors(data: ReportData) {
  const oRow = (s: string, k: string) => data.outputs.find((o) => o.scenario_key === s && o.metric_key === k);
  const oVal = (s: string, k: string): number | null => {
    const r = oRow(s, k);
    return r && r.value_numeric != null ? Number(r.value_numeric) : null;
  };
  const eRow = (k: string) => data.engineInputs.find((i) => i.key === k);
  const eVal = (k: string): number | null => {
    const r = eRow(k);
    return r && r.value_numeric != null ? Number(r.value_numeric) : null;
  };
  const aByKey = (k: string) => data.assumptions.find((a) => a.field_key === k);
  const aVal = (k: string): number | null => {
    const r = aByKey(k);
    return r && r.value_numeric != null ? Number(r.value_numeric) : null;
  };
  return { oRow, oVal, eRow, eVal, aByKey, aVal };
}

export type DerivedCore = ReturnType<typeof deriveCore>;

export function deriveCore(data: ReportData) {
  const { oVal, eVal, aVal } = makeAccessors(data);
  const tdc = oVal("base", "total_project_cost") ?? aVal("total_project_cost") ?? 0;
  const loan = aVal("debt_amount") ?? eVal("loan_amount") ?? 0;
  const committedEquity = aVal("equity_amount") ?? eVal("equity_amount") ?? 0;
  const requiredEquity = oVal("base", "equity_requirement") ?? tdc - loan;
  const fundingGap = requiredEquity - committedEquity;
  const noi = oVal("base", "stabilized_noi");
  const dscr = oVal("base", "dscr");
  const minDscr = aVal("min_dscr") ?? eVal("min_dscr");
  const exitCap = eVal("exit_cap_rate_pct") ?? aVal("exit_cap_rate");
  const ltc = oVal("base", "loan_to_cost");
  const lenderOcc = eVal("lender_stabilized_occupancy_pct") ?? aVal("lender_stabilized_occupancy");
  return { tdc, loan, committedEquity, requiredEquity, fundingGap, noi, dscr, minDscr, exitCap, ltc, lenderOcc };
}

export function reportVerdict(data: ReportData) {
  const { oVal } = makeAccessors(data);
  const errorFlags = data.flags.filter((f) => f.severity === "error" && !f.resolved);
  return computeInvestmentVerdict({
    equity_multiple: oVal("base", "equity_multiple") ?? 0,
    profit_margin: oVal("base", "profit_margin") ?? 0,
    development_spread: oVal("base", "development_spread") ?? 0,
    stress_dscr: oVal("combined", "dscr") ?? 0,
    stress_equity_multiple: oVal("combined", "equity_multiple") ?? 0,
    error_flag_count: errorFlags.length,
  });
}

// IRR status: "Not meaningful" on an equity wipeout / non-computable IRR (never
// a misleading 0.00%).
export function irrStatusText(data: ReportData): string {
  const { oRow, oVal } = makeAccessors(data);
  const row = oRow("base", "irr_estimate");
  const v = oVal("base", "irr_estimate");
  if (!row || v == null || !Number.isFinite(v) || /not meaningful/i.test(String(row.formula_text ?? ""))) {
    return "Not meaningful";
  }
  return pct(v);
}

export function generationLabel(generatedAt?: string): string {
  // Month + year only (no day token) so it never trips numeric provenance.
  const d = generatedAt ? new Date(generatedAt) : new Date();
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
}

// Short provenance label for body tables (full filenames stay in appendices).
export function assumptionSourceLabel(data: ReportData, a: Record<string, any> | undefined): string {
  if (!a) return "Approved assumption";
  const docName = a.documents?.name as string | undefined;
  if (docName) return displaySourceLabel(null, docName);
  const loc = a.source_location;
  if (loc && /\.(pdf|xlsx|xls|docx|csv)$/i.test(String(loc))) return displaySourceLabel(String(loc));
  return "Approved assumption";
}

// Default-accepted engine inputs -> taxonomy display labels.
export function defaultAcceptedFields(data: ReportData): string[] {
  return data.engineInputs
    .filter((i) => i.status === "default_accepted")
    .map((r) => ASSUMPTION_BY_KEY[ENGINE_SCALAR_TO_TAXONOMY[r.key] ?? ""]?.label ?? r.key)
    .filter(Boolean);
}

export function inputCounts(data: ReportData) {
  const approved = data.assumptions.filter((a) => a.status === "approved" || a.status === "modified").length;
  const calculated = data.assumptions.filter((a) => a.status === "calculated").length;
  const defaultAccepted = data.engineInputs.filter((i) => i.status === "default_accepted").length;
  return { approved, calculated, defaultAccepted };
}

// Standard deterministic disclaimer + inputs/defaults disclosure footnotes,
// shared by all reports. Returns { footnotes, derived } (derived numbers fed to
// the provenance verifier so the small counts are admitted).
export function disclosureFootnotes(data: ReportData): { footnotes: string[]; derived: number[] } {
  const counts = inputCounts(data);
  const names = defaultAcceptedFields(data);
  const errorCount = data.flags.filter((f) => f.severity === "error" && !f.resolved).length;
  const warningCount = data.flags.filter((f) => f.severity === "warning" && !f.resolved).length;
  return {
    derived: [counts.approved, counts.calculated, counts.defaultAccepted, errorCount, warningCount],
    footnotes: [
      "All figures were produced deterministically from approved, calculated, or explicitly default-accepted inputs. No AI-generated financial values were used.",
      `Inputs used: ${counts.approved} approved, ${counts.calculated} calculated, ${counts.defaultAccepted} default-accepted.`,
      names.length ? `Default-accepted inputs: ${names.join(", ")}.` : "Default-accepted inputs: none.",
      `Reconciliation exceptions: ${errorCount} error(s) and ${warningCount} warning(s) remain open.`,
    ],
  };
}

// Required-actions list, derived from flags/metrics (shared across reports).
export function requiredActions(data: ReportData, core: DerivedCore): string[] {
  const flags = data.flags;
  const occShortfalls = flags.filter((f) => String(f.check_key).startsWith("occupancy_vs_lender"));
  const sourcesError = flags.some((f) => f.check_key === "sources_vs_uses" && f.severity === "error");
  const equityMismatch = flags.some((f) => f.check_key === "equity_mismatch");
  const actions: string[] = [];
  if (Math.abs(core.fundingGap) > 1) actions.push("- Resolve the sources-and-uses funding gap.");
  if (sourcesError || equityMismatch || core.committedEquity < core.requiredEquity) {
    actions.push(`- Confirm whether the ${money(core.committedEquity)} committed equity is capped or whether additional sponsor/JV equity is available.`);
  }
  if (flags.some((f) => f.check_key === "budget_vs_stated_total")) actions.push("- Correct or remove any erroneous stated total project cost reconciliation input.");
  if (core.dscr != null && core.minDscr != null && core.dscr < core.minDscr) actions.push("- Cure the DSCR covenant breach or resize the senior debt.");
  if (occShortfalls.length) actions.push("- Resolve lender stabilization shortfalls for retail and office.");
  actions.push("- Re-run deterministic underwriting after corrections.");
  return actions;
}

// The deterministic Insight Layer read for this project, persisted by the
// underwriting run. Audience-adapted narrative + thesis + what-if levers, plus
// the `derived` numbers the prose uses (so the provenance verifier admits them).
// Null-safe: deals underwritten before the Insight Layer simply return null and
// the report falls back to its templated prose.
export type ReportInsight = { thesis: string; narrative: string; bullets: string[]; levers: any[]; interpretations: any[]; derived: number[]; recommendation: string | null };
export function insightFor(data: ReportData, audience: "ic" | "lender" | "investor" | "internal"): ReportInsight | null {
  const row = data.outputs.find((o) => o.metric_key === "insight" && o.scenario_key === "base");
  if (!row) return null;
  const i = (row.inputs ?? {}) as Record<string, any>;
  return {
    thesis: String(row.formula_text ?? ""),
    narrative: String(i.narratives?.[audience] ?? i.narratives?.ic ?? ""),
    bullets: Array.isArray(i.bullets) ? i.bullets : [],
    levers: Array.isArray(i.levers) ? i.levers : [],
    interpretations: Array.isArray(i.interpretations) ? i.interpretations : [],
    derived: Array.isArray(i.derivedValues) ? i.derivedValues.map(Number).filter((n: number) => Number.isFinite(n)) : [],
    recommendation: i.recommendation ? String(i.recommendation) : null,
  };
}

// Numbers a report may reference (for provenance), gathered from every
// deterministic source plus simple pure-function derivations.
export function reportAllowedValues(data: ReportData, core: DerivedCore, extra: number[] = []): number[] {
  const out: number[] = [];
  const push = (n: any) => { const v = Number(n); if (Number.isFinite(v)) out.push(v, -v); };
  data.assumptions.forEach((a) => push(a.value_numeric));
  data.engineInputs.forEach((i) => push(i.value_numeric));
  data.outputs.forEach((o) => push(o.value_numeric));
  data.cashFlows.forEach((c) => push(c.amount));
  data.budget.forEach((b) => push(b.amount));
  data.revenue.forEach((r) => { push(r.unit_count); push(r.avg_sf); push(r.market_rent_monthly); push(r.occupancy_pct); });
  for (const f of data.flags) {
    const e = f.expected == null ? null : Number(f.expected);
    const a = f.actual == null ? null : Number(f.actual);
    if (e != null) push(e);
    if (a != null) push(a);
    if (e != null && a != null) { push(e - a); push(a - e); if (a !== 0) push(e / a); if (e !== 0) push(a / e); }
    if (Array.isArray(f.conflict_values)) f.conflict_values.forEach((c: any) => push(c.value));
  }
  data.engineInputs.forEach((i) => { if (Array.isArray(i.conflict_values)) i.conflict_values.forEach((c: any) => push(c.value)); });
  // Fixed verdict thresholds.
  [1.5, 15, 100, 1.2, 1.0].forEach(push);
  extra.forEach(push);
  return out;
}

// Re-exports so builders import everything report-related from one module.
export { money, pct, x, bps, sanitizeSymbols, displaySourceLabel };
export type { ReportStat };
