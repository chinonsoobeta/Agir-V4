import { f } from "../findings-rules";
import type { Finding, NormalizedFindingsInput } from "../findings-types";

export function reconciliationFindings(input: NormalizedFindingsInput): Finding[] {
  return input.reconciliation
    .filter((flag) => !(flag as { resolved?: unknown }).resolved)
    .map((flag) =>
      f(
        `reconciliation.${flag.check_key}`,
        flag.severity === "error" ? "risk" : "weakness",
        flag.severity === "error" ? "high" : "medium",
        `Reconciliation ${String(flag.check_key).replace(/_/g, " ")}`,
        [flag.message],
        {
          ...(flag.expected == null ? {} : { expected: Number(flag.expected) }),
          ...(flag.actual == null ? {} : { actual: Number(flag.actual) }),
        },
        "A deterministic reconciliation check identified an exception that should be resolved before committee approval.",
        "reconciliation",
        "Resolve the reconciliation exception and rerun underwriting.",
      ),
    );
}
