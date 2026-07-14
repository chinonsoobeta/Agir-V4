/**
 * Assumption rows are review records, not automatically engine authority.
 *
 * A material analyst override is stored as `modified` while it waits for a
 * second approver.  That pending row must never be quoted by Copilot or used in
 * a governed memo/report.  The deterministic engine remains authoritative via
 * its approved/default-accepted input rows; this helper only identifies the
 * assumption records that may accompany those outputs as reviewed evidence.
 */
export const EFFECTIVE_ASSUMPTION_STATUSES = [
  "approved",
  "modified",
  "default_accepted",
  "calculated",
] as const;

const EFFECTIVE_STATUS_SET = new Set<string>(EFFECTIVE_ASSUMPTION_STATUSES);

export type AssumptionAuthorityFields = {
  status?: string | null;
  dual_control_pending?: boolean | null;
};

export function isEffectiveAssumption(row: AssumptionAuthorityFields): boolean {
  return EFFECTIVE_STATUS_SET.has(row.status ?? "") && row.dual_control_pending !== true;
}

export function effectiveAssumptions<T extends AssumptionAuthorityFields>(rows: readonly T[]): T[] {
  return rows.filter(isEffectiveAssumption);
}
