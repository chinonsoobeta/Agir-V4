import type { EngineOutput } from "../engine";
import { capitalStackFindings } from "./modules/capital-stack";
import { debtFindings } from "./modules/debt";
import { industrialFindings } from "./modules/industrial";
import { operationsFindings } from "./modules/operations";
import { reconciliationFindings } from "./modules/reconciliation";
import { approvalConditionFindings, recommendationFromFindings, rootCauseFindings } from "./modules/recommendation";
import { returnFindings } from "./modules/returns";
import { scenarioFindings } from "./modules/scenarios";
import { sortFindings } from "./findings-rules";
import type {
  Finding,
  FindingsReport,
  GenerateFindingsInput,
  NormalizedFindingsInput,
  NormalizedMetricSet,
  PersistedOutputRow,
  ScenarioOutput,
} from "./findings-types";

function metricsFromEngineOutput(output: EngineOutput): NormalizedMetricSet {
  return Object.fromEntries(output.metrics
    .filter((m) => Number.isFinite(m.value))
    .map((m) => [m.key, Number(m.value)]));
}

function metricsFromRows(rows: PersistedOutputRow[], scenario: string): NormalizedMetricSet {
  return Object.fromEntries(rows
    .filter((r) => r.scenario_key === scenario && r.value_numeric != null)
    .map((r) => [r.metric_key, Number(r.value_numeric)])
    .filter(([, value]) => Number.isFinite(value)));
}

function isPersistedRows(value: unknown): value is PersistedOutputRow[] {
  return Array.isArray(value) && (value.length === 0 || "metric_key" in (value[0] as any));
}

function normalize(input: GenerateFindingsInput): NormalizedFindingsInput {
  if (isPersistedRows(input.underwriting)) {
    const rows = input.underwriting;
    const scenarios: Record<string, NormalizedMetricSet> = {};
    for (const key of Array.from(new Set(rows.map((r) => r.scenario_key)))) {
      scenarios[key] = metricsFromRows(rows, key);
    }
    if (isPersistedRows(input.scenarios)) {
      for (const key of Array.from(new Set(input.scenarios.map((r) => r.scenario_key)))) {
        scenarios[key] = metricsFromRows(input.scenarios, key);
      }
    }
    return {
      base: metricsFromRows(rows, "base"),
      scenarios,
      assumptions: input.assumptions ?? [],
      input: input.input,
      risks: input.risks ?? [],
      reconciliation: input.reconciliation ?? [],
    };
  }

  const scenarios: Record<string, NormalizedMetricSet> = { base: metricsFromEngineOutput(input.underwriting) };
  for (const scenario of (input.scenarios ?? []) as ScenarioOutput[]) {
    scenarios[scenario.key] = metricsFromEngineOutput(scenario.output);
  }
  return {
    base: metricsFromEngineOutput(input.underwriting),
    scenarios,
    assumptions: input.assumptions ?? [],
    input: input.input,
    risks: input.risks ?? [],
    reconciliation: input.reconciliation ?? [],
  };
}

function byCategory(findings: Finding[], category: Finding["category"]) {
  return sortFindings(findings.filter((finding) => finding.category === category));
}

export function generateFindings(
  underwriting: GenerateFindingsInput["underwriting"],
  assumptions: GenerateFindingsInput["assumptions"] = [],
  scenarios: GenerateFindingsInput["scenarios"] = [],
  extra: Omit<GenerateFindingsInput, "underwriting" | "assumptions" | "scenarios"> = {},
): FindingsReport {
  const normalized = normalize({ underwriting, assumptions, scenarios, ...extra });
  const scenarioResult = scenarioFindings(normalized);
  const initial = sortFindings([
    ...operationsFindings(normalized),
    ...capitalStackFindings(normalized),
    ...debtFindings(normalized),
    ...returnFindings(normalized),
    ...industrialFindings(normalized),
    ...scenarioResult.findings,
    ...reconciliationFindings(normalized),
  ]);
  const rootCauses = rootCauseFindings(normalized, initial);
  const withRootCauses = sortFindings([...initial, ...rootCauses]);
  const approvalConditions = approvalConditionFindings(withRootCauses);
  const recommendation = recommendationFromFindings(withRootCauses, approvalConditions);
  const allFindings = sortFindings([...withRootCauses, ...approvalConditions, recommendation.finding]);

  return {
    strengths: byCategory(allFindings, "strength"),
    weaknesses: byCategory(allFindings, "weakness"),
    risks: byCategory(allFindings, "risk"),
    opportunities: byCategory(allFindings, "opportunity"),
    covenants: byCategory(allFindings, "covenant"),
    approvalConditions: byCategory(allFindings, "approval_condition"),
    rootCauseFindings: sortFindings(rootCauses),
    criticalFindings: sortFindings(allFindings.filter((x) => x.severity === "critical")),
    highPriorityFindings: sortFindings(allFindings.filter((x) => x.severity === "high")),
    informationalFindings: sortFindings(allFindings.filter((x) => x.severity === "medium" || x.severity === "low")),
    primaryDrivers: scenarioResult.primaryDrivers,
    downsideDrivers: scenarioResult.downsideDrivers,
    recommendationFindings: byCategory(allFindings, "recommendation"),
    recommendation: recommendation.recommendation,
  };
}

export type { Finding, FindingsReport, Driver, GenerateFindingsInput } from "./findings-types";
