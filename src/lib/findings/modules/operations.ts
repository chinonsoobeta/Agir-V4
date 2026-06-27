import { FINDING_THRESHOLDS, f, pct } from "../findings-rules";
import type { Finding, NormalizedFindingsInput } from "../findings-types";

export function operationsFindings(input: NormalizedFindingsInput): Finding[] {
  const findings: Finding[] = [];
  const revenue = input.input?.revenueProgram ?? [];
  const componentOcc = revenue
    .map((r) => ({
      name: r.unitType,
      occupancy: r.occupancyPct ?? input.input?.stabilizedOccupancyPct ?? null,
    }))
    .filter(
      (r): r is { name: string; occupancy: number } =>
        r.occupancy != null && Number.isFinite(r.occupancy),
    );

  if (
    componentOcc.length &&
    componentOcc.every((r) => r.occupancy >= FINDING_THRESHOLDS.strongOccupancyPct)
  ) {
    findings.push(
      f(
        "operations.strong_occupancy",
        "strength",
        "medium",
        "Strong Occupancy Profile",
        componentOcc.map((r) => `${r.name} occupancy ${pct(r.occupancy)}`),
        Object.fromEntries(
          componentOcc.map((r) => [`${r.name.toLowerCase()}_occupancy_pct`, r.occupancy]),
        ),
        "Every documented component occupancy meets or exceeds the strong-occupancy threshold.",
        "assumption",
      ),
    );
  }

  const rentRows = input.assumptions.filter(
    (a) =>
      ["residential_rent_monthly", "retail_rent_psf", "office_rent_psf"].includes(a.field_key) &&
      a.value_numeric != null,
  );
  if (rentRows.length) {
    findings.push(
      f(
        "operations.documented_revenue_program",
        "strength",
        "low",
        "Documented Revenue Program",
        rentRows.map((a) => `${a.field_label ?? a.field_key} ${a.value_numeric}`),
        Object.fromEntries(rentRows.map((a) => [a.field_key, Number(a.value_numeric)])),
        "Revenue assumptions are present by component and can be traced to approved assumption rows.",
        "assumption",
      ),
    );
  }

  return findings;
}
