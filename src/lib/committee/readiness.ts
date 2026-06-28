import type { VoteTally, TrackedCondition } from "@/lib/committee/voting";

export type ReadinessSeverity = "blocker" | "warning" | "satisfied";

export type ReadinessItem = {
  key: string;
  label: string;
  severity: ReadinessSeverity;
  detail: string;
};

export type CommitteeReadinessStatus = "blocked" | "ready" | "decided";

export type CommitteeReadiness = {
  status: CommitteeReadinessStatus;
  label: string;
  items: ReadinessItem[];
  blockers: number;
  warnings: number;
};

export type AssumptionReviewRow = { status?: string | null };
export type ReconciliationFlagRow = { severity?: string | null; resolved?: boolean | null };
export type CommitteeDecisionRow = {
  decision?: string | null;
  created_at?: string | null;
  user_name?: string | null;
};

const REVIEWED_STATUSES = new Set(["approved", "modified", "default_accepted", "calculated"]);
const DECIDED_STATUSES = new Set(["approve", "approve_with_conditions", "reject"]);

function item(
  key: string,
  label: string,
  severity: ReadinessSeverity,
  detail: string,
): ReadinessItem {
  return { key, label, severity, detail };
}

export function buildCommitteeReadiness(input: {
  hasUnderwriting: boolean;
  assumptions: AssumptionReviewRow[];
  reconciliationFlags: ReconciliationFlagRow[];
  voteTally: VoteTally | null;
  conditions: TrackedCondition[];
  decisions: CommitteeDecisionRow[];
  memoCount: number;
}): CommitteeReadiness {
  const items: ReadinessItem[] = [];
  const latestDecision = input.decisions[0] ?? null;
  const latestDecisionValue = latestDecision?.decision ?? null;
  const isDecided = latestDecisionValue != null && DECIDED_STATUSES.has(latestDecisionValue);

  items.push(
    item(
      "underwriting",
      "Deterministic underwriting",
      input.hasUnderwriting ? "satisfied" : "blocker",
      input.hasUnderwriting
        ? "Engine outputs exist for committee review."
        : "Run underwriting before recording an IC decision.",
    ),
  );

  const totalAssumptions = input.assumptions.length;
  const reviewed = input.assumptions.filter((row) =>
    REVIEWED_STATUSES.has(row.status ?? ""),
  ).length;
  const conflicting = input.assumptions.filter((row) => row.status === "conflicting").length;
  const missing = input.assumptions.filter((row) => row.status === "missing").length;
  const unreviewed = Math.max(0, totalAssumptions - reviewed - conflicting - missing);
  const assumptionSeverity: ReadinessSeverity =
    conflicting > 0 || missing > 0 ? "blocker" : unreviewed > 0 ? "warning" : "satisfied";
  items.push(
    item(
      "assumptions",
      "Assumption review",
      assumptionSeverity,
      `${reviewed}/${totalAssumptions} reviewed; ${conflicting} conflicting; ${missing} missing; ${unreviewed} unreviewed.`,
    ),
  );

  const openErrors = input.reconciliationFlags.filter(
    (flag) => flag.severity === "error" && !flag.resolved,
  ).length;
  const openWarnings = input.reconciliationFlags.filter(
    (flag) => flag.severity === "warning" && !flag.resolved,
  ).length;
  items.push(
    item(
      "reconciliation",
      "Reconciliation",
      openErrors > 0 ? "blocker" : openWarnings > 0 ? "warning" : "satisfied",
      openErrors > 0
        ? `${openErrors} unresolved reconciliation error${openErrors === 1 ? "" : "s"}.`
        : openWarnings > 0
          ? `${openWarnings} unresolved reconciliation warning${openWarnings === 1 ? "" : "s"}.`
          : "No unresolved reconciliation exceptions.",
    ),
  );

  const tally = input.voteTally;
  items.push(
    item(
      "votes",
      "Committee votes",
      tally == null || !tally.quorumMet ? "warning" : "satisfied",
      tally == null
        ? "No vote tally available."
        : tally.quorumMet
          ? `${tally.outcome.replace(/_/g, " ")} with ${tally.decisiveVotes} decisive vote${tally.decisiveVotes === 1 ? "" : "s"}.`
          : `Quorum not met; ${tally.decisiveVotes} decisive vote${tally.decisiveVotes === 1 ? "" : "s"} recorded.`,
    ),
  );

  const openConditions = input.conditions.filter((condition) => condition.status === "open").length;
  items.push(
    item(
      "conditions",
      "Tracked conditions",
      openConditions > 0 ? "warning" : "satisfied",
      openConditions > 0
        ? `${openConditions} open condition${openConditions === 1 ? "" : "s"} still tracked.`
        : input.conditions.length > 0
          ? "All tracked conditions are satisfied or waived."
          : "No tracked approval conditions.",
    ),
  );

  items.push(
    item(
      "memo",
      "IC memo",
      input.memoCount > 0 ? "satisfied" : "warning",
      input.memoCount > 0
        ? `${input.memoCount} memo${input.memoCount === 1 ? "" : "s"} generated.`
        : "Generate a memo before final committee circulation.",
    ),
  );

  items.push(
    item(
      "decision_history",
      "Decision accountability",
      latestDecision ? "satisfied" : "warning",
      latestDecision
        ? `Latest decision: ${String(latestDecisionValue).replace(/_/g, " ")}${latestDecision.user_name ? ` by ${latestDecision.user_name}` : ""}.`
        : "No committee decision has been recorded yet.",
    ),
  );

  const blockers = items.filter((row) => row.severity === "blocker").length;
  const warnings = items.filter((row) => row.severity === "warning").length;
  const status: CommitteeReadinessStatus = isDecided
    ? "decided"
    : blockers > 0
      ? "blocked"
      : "ready";

  return {
    status,
    label:
      status === "decided"
        ? "Decision recorded"
        : status === "ready"
          ? "Ready for committee"
          : "Blocked before committee",
    items,
    blockers,
    warnings,
  };
}
