import { f, metric } from "../findings-rules";
import type { Finding, FindingsRecommendation, NormalizedFindingsInput } from "../findings-types";

export function rootCauseFindings(input: NormalizedFindingsInput, findings: Finding[]): Finding[] {
  const dscrWeak = findings.some((x) => x.id === "debt.weak_dscr");
  const spreadWeak = findings.some((x) => x.id === "returns.thin_spread");
  const equityWeak = findings.some((x) => x.id === "returns.low_equity_multiple");
  const noi = metric(input.base, "stabilized_noi");
  const tdc = metric(input.base, "total_project_cost");
  const loan = input.input?.loanAmount ?? null;

  if (dscrWeak && spreadWeak && equityWeak) {
    return [
      f(
        "root_cause.noi_cost_leverage",
        "recommendation",
        "critical",
        "Insufficient NOI Relative to Cost Basis and Leverage",
        [
          ...(noi == null ? [] : [`NOI ${noi}`]),
          ...(tdc == null ? [] : [`TDC ${tdc}`]),
          ...(loan == null ? [] : [`Loan amount ${loan}`]),
          "Weak DSCR",
          "Thin development spread",
          "Low equity multiple",
        ],
        {
          ...(noi == null ? {} : { noi }),
          ...(tdc == null ? {} : { total_project_cost: tdc }),
          ...(loan == null ? {} : { loan_amount: loan }),
        },
        "Operating income is insufficient relative to project cost and debt load, which causes debt coverage, spread, and equity-return findings to fail together.",
        "underwriting",
        "Increase NOI, reduce leverage, lower cost basis, or improve exit economics before approval.",
      ),
    ];
  }
  return [];
}

export function approvalConditionFindings(findings: Finding[]): Finding[] {
  const out: Finding[] = [];
  if (findings.some((x) => x.id === "debt.weak_dscr")) {
    out.push(
      f(
        "condition.reduce_leverage",
        "approval_condition",
        "high",
        "Reduce Leverage",
        ["DSCR below threshold"],
        {},
        "Debt service coverage must pass before approval.",
        "underwriting",
        "Reduce leverage until DSCR exceeds 1.20x.",
      ),
    );
    out.push(
      f(
        "condition.increase_noi",
        "approval_condition",
        "high",
        "Increase NOI",
        ["DSCR below threshold"],
        {},
        "Operating income must be sufficient to support proposed debt.",
        "underwriting",
        "Increase NOI until DSCR exceeds 1.20x.",
      ),
    );
  }
  if (findings.some((x) => x.id === "returns.thin_spread")) {
    out.push(
      f(
        "condition.increase_spread",
        "approval_condition",
        "high",
        "Increase Development Spread",
        ["Development spread below threshold"],
        {},
        "The project needs a wider yield-on-cost premium over the exit cap.",
        "underwriting",
        "Increase development spread to at least 100 bps.",
      ),
    );
  }
  if (findings.some((x) => x.id.startsWith("scenario.") && x.category === "risk")) {
    out.push(
      f(
        "condition.improve_stress_resilience",
        "approval_condition",
        "medium",
        "Improve Stress Resilience",
        ["Negative profit under at least one stress scenario"],
        {},
        "The deal should withstand key downside scenarios before approval.",
        "scenario",
        "Improve stress resilience so downside scenarios do not produce negative development profit.",
      ),
    );
  }
  return out;
}

export function recommendationFromFindings(
  findings: Finding[],
  conditions: Finding[],
): { recommendation: FindingsRecommendation; finding: Finding } {
  const hasCritical = findings.some((x) => x.severity === "critical");
  const hasHighWeaknessOrRisk = findings.some(
    (x) => x.severity === "high" && (x.category === "weakness" || x.category === "risk"),
  );
  const hasConditions = conditions.length > 0;
  const recommendation: FindingsRecommendation = hasCritical
    ? "RETURN_TO_UNDERWRITING"
    : hasHighWeaknessOrRisk
      ? "RETURN_TO_UNDERWRITING"
      : hasConditions
        ? "APPROVE_WITH_CONDITIONS"
        : "APPROVE";
  return {
    recommendation,
    finding: f(
      "recommendation.primary",
      "recommendation",
      recommendation === "APPROVE"
        ? "low"
        : recommendation === "APPROVE_WITH_CONDITIONS"
          ? "medium"
          : "high",
      `Recommendation: ${recommendation}`,
      findings
        .filter((x) => x.severity === "critical" || x.severity === "high")
        .map((x) => x.title),
      {
        critical_findings: findings.filter((x) => x.severity === "critical").length,
        high_findings: findings.filter((x) => x.severity === "high").length,
      },
      "Recommendation is determined from prioritized findings rather than raw metrics alone.",
      "underwriting",
    ),
  };
}
