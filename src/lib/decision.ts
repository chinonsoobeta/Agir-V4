// Decision layer — the institutional scoring + findings surface.
//
// Every page in Agir answers "what decision should be made?" rather than
// "what numbers exist?". This module turns the deterministic engine outputs
// (financial_outputs rows) and the approved assumption set into the two scores
// the platform is organised around — the Investment Score and the Confidence
// Score — plus a risk rating and a findings report. It is framework-free so it
// can run on the client (deal page, committee) or the server (copilot context).

import { generateFindings, type FindingsReport, type FindingsRecommendation } from "./findings";

export type OutputRow = {
  scenario_key: string;
  metric_key: string;
  metric_label?: string | null;
  value_numeric: number | string | null;
  unit?: string | null;
  formula_text?: string | null;
  inputs?: any;
};

export type AssumptionRow = {
  field_key: string;
  field_label?: string | null;
  category?: string | null;
  value_numeric?: number | string | null;
  value_text?: string | null;
  unit?: string | null;
  status?: string | null;
  source_document_id?: string | null;
  source_text?: string | null;
  source_location?: string | null;
  confidence_score?: number | null;
  conflict_values?: any;
};

export type RiskRating = "Low" | "Moderate" | "High" | "Critical";

export type ScoreComponent = { label: string; score: number; weight: number; detail: string };

export type DecisionRecommendation =
  | "APPROVE"
  | "APPROVE_WITH_CONDITIONS"
  | "RETURN_TO_UNDERWRITING"
  | "REJECT";

export const RECOMMENDATION_LABEL: Record<DecisionRecommendation, string> = {
  APPROVE: "Approve",
  APPROVE_WITH_CONDITIONS: "Approve with Conditions",
  RETURN_TO_UNDERWRITING: "Return to Underwriting",
  REJECT: "Reject",
};

// Tone is used consistently across the UI: green = approval, red = material
// risk / rejection, amber = conditions, neutral for everything informational.
export const RECOMMENDATION_TONE: Record<DecisionRecommendation, "approve" | "condition" | "return" | "reject"> = {
  APPROVE: "approve",
  APPROVE_WITH_CONDITIONS: "condition",
  RETURN_TO_UNDERWRITING: "return",
  REJECT: "reject",
};

// ---------- The unified, context-aware recommendation ----------
// Two lenses produce a recommendation: the gate verdict (computeInvestmentVerdict
// — return/stress hurdles + hard-fail) and the findings engine (severity of
// prioritized findings). They can legitimately disagree (e.g. a deal that clears
// every finding but trips a stress gate). This reconciler folds them — plus the
// contextual interpretation — into ONE recommendation every surface shows.
// Policy: conservative. A hard fail is terminal (REJECT). Otherwise take the more
// cautious of the two lenses, and let a below-norm CONTEXTUAL read escalate an
// otherwise-clean approve to "with conditions" (context tightens, never loosens).
const REC_RANK: Record<string, number> = {
  APPROVE: 0,
  APPROVE_WITH_CONDITIONS: 1,
  RETURN_TO_UNDERWRITING: 2,
  REJECT: 2, // a non-hard-fail REJECT is a returnable "no"
};

export function reconcileRecommendation(args: {
  verdictCode?: string | null;
  hardFail?: boolean;
  findingsRec?: string | null;
  weakContext?: boolean;
}): { code: DecisionRecommendation; rationale: string } {
  if (args.hardFail) {
    return { code: "REJECT", rationale: "Hard fail (equity wipeout or an unresolved error-severity reconciliation flag) overrides the gate and findings lenses." };
  }
  const vr = REC_RANK[args.verdictCode ?? "APPROVE"] ?? 0;
  const fr = REC_RANK[args.findingsRec ?? "APPROVE"] ?? 0;
  let rank = Math.max(vr, fr);
  let ctxEscalated = false;
  if (rank === 0 && args.weakContext) {
    rank = 1;
    ctxEscalated = true;
  }
  const code: DecisionRecommendation = rank === 0 ? "APPROVE" : rank === 1 ? "APPROVE_WITH_CONDITIONS" : "RETURN_TO_UNDERWRITING";
  const lens = ctxEscalated
    ? "context-aware interpretation flags a below-norm metric the fixed gates cleared"
    : vr > fr
      ? "the gate set (return/stress hurdles) is the binding lens"
      : fr > vr
        ? "the prioritized findings are the binding lens"
        : "the gate and findings lenses agree";
  return {
    code,
    rationale: `Reconciled from the gate verdict (${args.verdictCode ?? "n/a"}) and the findings recommendation (${args.findingsRec ?? "n/a"}) — ${lens}.`,
  };
}

const PRESENT_STATUSES = new Set(["extracted", "approved", "modified", "default_accepted", "calculated"]);
const APPROVED_STATUSES = new Set(["approved", "modified", "default_accepted", "calculated"]);

function n(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function clamp(x: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, x));
}

// Linear interpolation of a value into a 0-100 sub-score between a floor and ceiling.
function band(value: number | null, floor: number, ceil: number): number | null {
  if (value == null) return null;
  if (ceil === floor) return value >= ceil ? 100 : 0;
  return clamp(((value - floor) / (ceil - floor)) * 100);
}

export type NormalizedOutputs = {
  hasUnderwriting: boolean;
  base: Record<string, number>;
  scenarios: Record<string, Record<string, number>>;
  worstStress: Record<string, number>;
  verdict: FindingsRecommendation | null;
  riskScore: number | null;
};

export function normalizeOutputs(rows: OutputRow[]): NormalizedOutputs {
  const scenarios: Record<string, Record<string, number>> = {};
  let verdict: FindingsRecommendation | null = null;
  let riskScore: number | null = null;

  for (const r of rows) {
    if (r.metric_key === "verdict") {
      const code = r.inputs?.code ?? r.formula_text;
      if (code === "APPROVE" || code === "APPROVE_WITH_CONDITIONS" || code === "REJECT") verdict = code;
      continue;
    }
    if (r.metric_key === "risk_score") {
      riskScore = n(r.value_numeric);
      continue;
    }
    const v = n(r.value_numeric);
    if (v == null) continue;
    (scenarios[r.scenario_key] ||= {})[r.metric_key] = v;
  }

  const base = scenarios.base ?? {};
  // The worst stress case = the scenario whose DSCR / equity multiple holds up
  // least. We take the minimum across all non-base scenarios per metric.
  const worstStress: Record<string, number> = {};
  for (const [key, metrics] of Object.entries(scenarios)) {
    if (key === "base") continue;
    for (const [mk, mv] of Object.entries(metrics)) {
      worstStress[mk] = worstStress[mk] == null ? mv : Math.min(worstStress[mk], mv);
    }
  }

  return { hasUnderwriting: rows.length > 0, base, scenarios, worstStress, verdict, riskScore };
}

// ---------- Confidence Score ----------
// 0-100, "how much do we trust the inputs behind this decision?"
export function computeConfidenceScore(assumptions: AssumptionRow[]): { score: number; components: ScoreComponent[] } {
  const present = assumptions.filter((a) => PRESENT_STATUSES.has(a.status ?? ""));
  const approved = assumptions.filter((a) => APPROVED_STATUSES.has(a.status ?? ""));
  const conflicting = assumptions.filter((a) => a.status === "conflicting");
  const missing = assumptions.filter((a) => a.status === "missing");
  const total = assumptions.length || 1;

  // Extraction confidence — mean confidence of present assumptions.
  const extractionConf = present.length
    ? present.reduce((s, a) => s + (Number(a.confidence_score) || 0), 0) / present.length
    : 0;

  // Approved coverage — share of the register that is analyst-blessed.
  const approvedRatio = (approved.length / total) * 100;

  // Conflict resolution — every unresolved conflict is a sharp penalty.
  const conflictScore = clamp(100 - conflicting.length * 25);

  // Completeness — penalty for missing assumptions.
  const completeness = clamp(100 - (missing.length / total) * 100 * 1.2);

  // Source quality — share of present assumptions traceable to a document.
  const sourced = present.filter((a) => a.source_document_id || a.source_text);
  const sourceQuality = present.length ? (sourced.length / present.length) * 100 : 0;

  const components: ScoreComponent[] = [
    { label: "Extraction confidence", score: clamp(extractionConf), weight: 0.3, detail: `${Math.round(extractionConf)}% mean across ${present.length} present` },
    { label: "Approved coverage", score: clamp(approvedRatio), weight: 0.25, detail: `${approved.length} of ${total} approved` },
    { label: "Conflict resolution", score: conflictScore, weight: 0.2, detail: conflicting.length ? `${conflicting.length} unresolved` : "no conflicts" },
    { label: "Completeness", score: completeness, weight: 0.15, detail: `${missing.length} missing` },
    { label: "Source quality", score: clamp(sourceQuality), weight: 0.1, detail: `${sourced.length}/${present.length} documented` },
  ];

  const score = Math.round(components.reduce((s, c) => s + c.score * c.weight, 0));
  return { score: assumptions.length ? score : 0, components };
}

// ---------- Investment Score ----------
// 0-100, the primary score the platform is organised around — NOT IRR, NOT DSCR.
export function computeInvestmentScore(
  norm: NormalizedOutputs,
  confidenceScore: number,
): { score: number | null; components: ScoreComponent[] } {
  if (!norm.hasUnderwriting || Object.keys(norm.base).length === 0) {
    return { score: null, components: [] };
  }
  const b = norm.base;

  // Returns — blend equity multiple, profit margin, levered IRR.
  const emScore = band(b.equity_multiple, 1.0, 2.2);
  const marginScore = band(b.profit_margin, 0, 25);
  const irrScore = band(b.irr_estimate, 6, 22);
  const returns = avg([emScore, marginScore, irrScore]);

  // Risk — invert the engine risk score (higher risk score = worse).
  const riskScore = norm.riskScore == null ? null : clamp(100 - norm.riskScore);

  // Debt support — DSCR.
  const debt = band(b.dscr, 1.0, 1.6);

  // Sensitivity — does the deal survive the worst stress run?
  const sens = avg([band(norm.worstStress.dscr, 1.0, 1.4), band(norm.worstStress.equity_multiple, 0.8, 1.4)]);

  // Data quality / confidence feeds directly.
  const components: ScoreComponent[] = [
    { label: "Returns", score: returns ?? 0, weight: 0.3, detail: fmtReturns(b) },
    { label: "Risk profile", score: riskScore ?? 50, weight: 0.2, detail: norm.riskScore == null ? "n/a" : `engine risk ${Math.round(norm.riskScore)}` },
    { label: "Debt support", score: debt ?? 0, weight: 0.15, detail: b.dscr ? `DSCR ${b.dscr.toFixed(2)}x` : "n/a" },
    { label: "Sensitivity", score: sens ?? 0, weight: 0.2, detail: norm.worstStress.dscr ? `stress DSCR ${norm.worstStress.dscr.toFixed(2)}x` : "n/a" },
    { label: "Confidence & data", score: confidenceScore, weight: 0.15, detail: `${confidenceScore}/100 confidence` },
  ];

  const score = Math.round(components.reduce((s, c) => s + c.score * c.weight, 0));
  return { score, components };
}

function fmtReturns(b: Record<string, number>) {
  const parts: string[] = [];
  if (b.equity_multiple) parts.push(`${b.equity_multiple.toFixed(2)}x EM`);
  if (b.profit_margin) parts.push(`${b.profit_margin.toFixed(1)}% margin`);
  if (b.irr_estimate) parts.push(`${b.irr_estimate.toFixed(1)}% IRR`);
  return parts.join(" · ") || "n/a";
}

function avg(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

export function riskRatingFrom(norm: NormalizedOutputs, investmentScore: number | null): RiskRating {
  // An equity wipeout or rejection is always Critical.
  if (norm.verdict === "REJECT") return "Critical";
  const rs = norm.riskScore;
  if (rs != null) {
    if (rs >= 70) return "Critical";
    if (rs >= 45) return "High";
    if (rs >= 25) return "Moderate";
    return "Low";
  }
  if (investmentScore == null) return "Moderate";
  if (investmentScore >= 75) return "Low";
  if (investmentScore >= 55) return "Moderate";
  if (investmentScore >= 35) return "High";
  return "Critical";
}

export const RISK_TONE: Record<RiskRating, "approve" | "condition" | "return" | "reject"> = {
  Low: "approve",
  Moderate: "condition",
  High: "return",
  Critical: "reject",
};

// ---------- The unified decision summary ----------
// The deterministic Insight Layer read, surfaced on the decision/findings tab.
export type DecisionInsight = { thesis: string; interpretations: any[]; levers: any[]; context: any };

export type DecisionSummary = {
  hasUnderwriting: boolean;
  recommendation: DecisionRecommendation;
  recommendationLabel: string;
  investmentScore: number | null;
  confidenceScore: number;
  riskRating: RiskRating;
  investmentComponents: ScoreComponent[];
  confidenceComponents: ScoreComponent[];
  findings: FindingsReport | null;
  insight: DecisionInsight | null;
  norm: NormalizedOutputs;
};

export function buildDecision(outputs: OutputRow[], assumptions: AssumptionRow[]): DecisionSummary {
  const norm = normalizeOutputs(outputs);
  const { score: confidenceScore, components: confidenceComponents } = computeConfidenceScore(assumptions);
  const { score: investmentScore, components: investmentComponents } = computeInvestmentScore(norm, confidenceScore);

  let findings: FindingsReport | null = null;
  let recommendation: DecisionRecommendation;
  if (norm.hasUnderwriting && Object.keys(norm.base).length > 0) {
    try {
      findings = generateFindings(outputs as any, assumptions as any);
      recommendation = findings.recommendation;
    } catch {
      recommendation = mapVerdict(norm.verdict);
    }
  } else {
    recommendation = "RETURN_TO_UNDERWRITING";
  }

  const insightRow = outputs.find((o: any) => o.metric_key === "insight" && o.scenario_key === "base");
  const insight: DecisionInsight | null = insightRow
    ? {
        thesis: String((insightRow as any).formula_text ?? ""),
        interpretations: (insightRow as any).inputs?.interpretations ?? [],
        levers: (insightRow as any).inputs?.levers ?? [],
        context: (insightRow as any).inputs?.context ?? null,
      }
    : null;

  // ONE recommendation: prefer the reconciled value the run already persisted
  // (single source of truth); otherwise fold the gate verdict + findings +
  // contextual read together here. Keeps the deal header, Decision tab, Analysis
  // thesis and memo from ever disagreeing.
  if (norm.hasUnderwriting && Object.keys(norm.base).length > 0) {
    const persisted = (insightRow as any)?.inputs?.recommendation as DecisionRecommendation | undefined;
    if (persisted) {
      recommendation = persisted;
    } else {
      const verdictRow = outputs.find((o: any) => o.metric_key === "verdict" && o.scenario_key === "base");
      recommendation = reconcileRecommendation({
        verdictCode: (verdictRow as any)?.inputs?.code ?? null,
        hardFail: Boolean((verdictRow as any)?.inputs?.hardFail),
        findingsRec: findings?.recommendation ?? null,
        weakContext: (insight?.interpretations ?? []).some((i: any) => i.band === "weak" || i.band === "critical"),
      }).code;
    }
  }

  return {
    hasUnderwriting: norm.hasUnderwriting && Object.keys(norm.base).length > 0,
    recommendation,
    recommendationLabel: RECOMMENDATION_LABEL[recommendation],
    investmentScore,
    confidenceScore,
    riskRating: riskRatingFrom(norm, investmentScore),
    investmentComponents,
    confidenceComponents,
    findings,
    insight,
    norm,
  };
}

function mapVerdict(v: FindingsRecommendation | null): DecisionRecommendation {
  if (v === "APPROVE") return "APPROVE";
  if (v === "APPROVE_WITH_CONDITIONS") return "APPROVE_WITH_CONDITIONS";
  if (v === "REJECT") return "REJECT";
  return "RETURN_TO_UNDERWRITING";
}

// Stage of a deal in the IC pipeline, derived from project status + analysis state.
export type PipelineStage =
  | "Screening"
  | "Document Review"
  | "Underwriting"
  | "Investment Committee"
  | "Approved"
  | "Rejected";

export const PIPELINE_STAGES: PipelineStage[] = [
  "Screening",
  "Document Review",
  "Underwriting",
  "Investment Committee",
  "Approved",
  "Rejected",
];

export function pipelineStageFor(opts: {
  status?: string | null;
  docCount: number;
  hasUnderwriting: boolean;
  decisions: { decision: string }[];
}): PipelineStage {
  const last = opts.decisions[0]?.decision;
  if (last === "reject") return "Rejected";
  if (last === "approve" || last === "approve_with_conditions") return "Approved";
  if (opts.status === "approved" || opts.status === "active" || opts.status === "completed") return "Approved";
  if (opts.status === "cancelled") return "Rejected";
  if (opts.hasUnderwriting) return "Investment Committee";
  if (opts.docCount > 0) return "Document Review";
  if (opts.status === "underwriting") return "Underwriting";
  return "Screening";
}
