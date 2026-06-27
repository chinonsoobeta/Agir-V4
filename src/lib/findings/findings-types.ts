import type { EngineOutput, UnderwritingInput } from "../engine";
import type { ReconciliationFlag, RiskEntry } from "../engine/reconciliation";

export type FindingCategory =
  | "strength"
  | "weakness"
  | "risk"
  | "opportunity"
  | "covenant"
  | "recommendation"
  | "approval_condition";

export type FindingSeverity = "critical" | "high" | "medium" | "low";
export type FindingSource = "underwriting" | "scenario" | "assumption" | "reconciliation";
export type FindingsRecommendation =
  | "APPROVE"
  | "APPROVE_WITH_CONDITIONS"
  | "RETURN_TO_UNDERWRITING"
  | "REJECT";

export interface Finding {
  id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  evidence: string[];
  metrics: Record<string, number>;
  rationale: string;
  recommendation?: string;
  source: FindingSource;
}

export interface Driver {
  rank: number;
  name: string;
  impact: number;
  rationale: string;
}

export interface FindingsReport {
  strengths: Finding[];
  weaknesses: Finding[];
  risks: Finding[];
  opportunities: Finding[];
  covenants: Finding[];
  approvalConditions: Finding[];
  rootCauseFindings: Finding[];
  criticalFindings: Finding[];
  highPriorityFindings: Finding[];
  informationalFindings: Finding[];
  primaryDrivers: Driver[];
  downsideDrivers: Driver[];
  recommendationFindings: Finding[];
  recommendation: FindingsRecommendation;
}

export type ScenarioOutput = {
  key: string;
  label?: string;
  output: EngineOutput;
};

export type PersistedOutputRow = {
  scenario_key: string;
  metric_key: string;
  metric_label?: string | null;
  value_numeric: number | string | null;
  unit?: string | null;
};

export type AssumptionRow = {
  field_key: string;
  field_label?: string | null;
  value_numeric?: number | string | null;
  value_text?: string | null;
  unit?: string | null;
  status?: string | null;
  source_document_id?: string | null;
  source_text?: string | null;
  source_location?: string | null;
  confidence_score?: number | null;
};

export type GenerateFindingsInput = {
  underwriting: EngineOutput | PersistedOutputRow[];
  assumptions?: AssumptionRow[];
  scenarios?: ScenarioOutput[] | PersistedOutputRow[];
  input?: UnderwritingInput;
  risks?: RiskEntry[];
  reconciliation?: ReconciliationFlag[];
};

export type NormalizedMetricSet = Record<string, number>;

export type NormalizedFindingsInput = {
  base: NormalizedMetricSet;
  scenarios: Record<string, NormalizedMetricSet>;
  assumptions: AssumptionRow[];
  input?: UnderwritingInput;
  risks: RiskEntry[];
  reconciliation: ReconciliationFlag[];
};
