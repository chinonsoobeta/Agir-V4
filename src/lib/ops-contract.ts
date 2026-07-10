export type OpsStatus = "passed" | "failed" | "blocked";

/** Shared contract for structured operator output and its regression tests. */
export function classifyOpsResult(
  label: string,
  result: { status?: number | null } | undefined,
  blocked = false,
): { label: string; status: OpsStatus; code: number } {
  if (blocked) return { label, status: "blocked", code: result?.status ?? 1 };
  return { label, status: result?.status === 0 ? "passed" : "failed", code: result?.status ?? 1 };
}
