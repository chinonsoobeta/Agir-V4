// IC voting and approval conditions (Workstream 3B). Pure, deterministic
// governance math layered ON TOP of the engine's deterministic verdict: votes
// and conditions record what the committee decided; they never alter a computed
// financial number. The engine verdict and audit trail stay intact.

export type VoteValue = "approve" | "approve_with_conditions" | "reject" | "abstain";

export type IcVote = { memberId: string; vote: VoteValue; weight?: number };

export type TallyPolicy = {
  // Minimum number of decisive (non-abstain) voters required for a valid vote.
  quorum: number;
  // Share of decisive votes that must approve (with or without conditions).
  approveThresholdPct: number;
  // When true, a single reject blocks approval regardless of the tally.
  rejectBlocks?: boolean;
};

export const DEFAULT_TALLY_POLICY: TallyPolicy = {
  quorum: 2,
  approveThresholdPct: 50,
  rejectBlocks: false,
};

export type VoteOutcome =
  | "approved"
  | "approved_with_conditions"
  | "rejected"
  | "no_quorum"
  | "tie";

export type VoteTally = {
  counts: Record<VoteValue, number>;
  decisiveVotes: number;
  approvals: number;
  rejects: number;
  abstentions: number;
  quorumMet: boolean;
  approvalPct: number;
  outcome: VoteOutcome;
};

// One vote per member: a later vote from the same member REPLACES the earlier
// one (members can change their mind before the tally closes).
function dedupeLatest(votes: IcVote[]): IcVote[] {
  const latest = new Map<string, IcVote>();
  for (const v of votes) latest.set(v.memberId, v);
  return [...latest.values()];
}

export function tallyVotes(votes: IcVote[], policy: TallyPolicy = DEFAULT_TALLY_POLICY): VoteTally {
  const counts: Record<VoteValue, number> = {
    approve: 0,
    approve_with_conditions: 0,
    reject: 0,
    abstain: 0,
  };
  for (const v of dedupeLatest(votes)) counts[v.vote] += 1;

  const approvals = counts.approve + counts.approve_with_conditions;
  const rejects = counts.reject;
  const abstentions = counts.abstain;
  const decisiveVotes = approvals + rejects;
  const quorumMet = decisiveVotes >= policy.quorum;
  const approvalPct = decisiveVotes > 0 ? (approvals / decisiveVotes) * 100 : 0;

  let outcome: VoteOutcome;
  if (!quorumMet) {
    outcome = "no_quorum";
  } else if (policy.rejectBlocks && rejects > 0) {
    outcome = "rejected";
  } else if (approvalPct >= policy.approveThresholdPct && approvals > rejects) {
    // Approval requires the CONFIGURED share of decisive votes (a supermajority
    // when approveThresholdPct > 50) AND more approvals than rejects. A prior
    // `approvalPct > 50` short-circuit ignored the threshold entirely, so a
    // simple majority always passed even when a supermajority was required.
    outcome =
      counts.approve_with_conditions >= counts.approve ? "approved_with_conditions" : "approved";
  } else if (rejects > approvals) {
    outcome = "rejected";
  } else {
    outcome = "tie";
  }

  return {
    counts,
    decisiveVotes,
    approvals,
    rejects,
    abstentions,
    quorumMet,
    approvalPct,
    outcome,
  };
}

// ---- Approval conditions tracked open -> satisfied / waived through to close ----

export type ConditionStatus = "open" | "satisfied" | "waived";
export type ConditionAction = "satisfy" | "reopen" | "waive";

const TRANSITIONS: Record<ConditionStatus, Partial<Record<ConditionAction, ConditionStatus>>> = {
  open: { satisfy: "satisfied", waive: "waived" },
  satisfied: { reopen: "open" },
  waived: { reopen: "open" },
};

export function canTransitionCondition(current: ConditionStatus, action: ConditionAction): boolean {
  return TRANSITIONS[current]?.[action] != null;
}

// Apply a condition state transition, or throw on an illegal one (e.g. you
// cannot "satisfy" a waived condition without reopening it first).
export function transitionCondition(
  current: ConditionStatus,
  action: ConditionAction,
): ConditionStatus {
  const next = TRANSITIONS[current]?.[action];
  if (next == null)
    throw new Error(`Illegal condition transition: cannot ${action} a ${current} condition.`);
  return next;
}

export type TrackedCondition = { status: ConditionStatus };

// A conditional approval is cleared for close only when no condition is still
// open (every condition is satisfied or explicitly waived).
export function conditionsCleared(conditions: TrackedCondition[]): boolean {
  return conditions.every((c) => c.status !== "open");
}

export function openConditionCount(conditions: TrackedCondition[]): number {
  return conditions.filter((c) => c.status === "open").length;
}
