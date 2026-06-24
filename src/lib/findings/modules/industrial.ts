import { f, metric, money, pct } from "../findings-rules";
import type { Finding, NormalizedFindingsInput } from "../findings-types";

// Industrial / logistics findings. Every rule is deterministic and source-backed
// (it cites an approved assumption row or a deterministic scenario output).

const COLD_RE = /cold[\s-]?storage|cold[\s-]?chain|refrigerat|temperature[\s-]?controlled/i;
const RATE_LOCK_RE = /rate[\s_-]?lock|rate[\s_-]?update|financing[\s_-]?update|addendum/i;

const assumptionVal = (input: NormalizedFindingsInput, key: string): number | null => {
  const row = input.assumptions.find((a) => a.field_key === key && a.value_numeric != null);
  return row ? Number(row.value_numeric) : null;
};

export function industrialFindings(input: NormalizedFindingsInput): Finding[] {
  const findings: Finding[] = [];
  const revenue = input.input?.revenueProgram ?? [];
  const isIndustrial = revenue.some((r) => /warehouse|cold|storage|logistics|flex|distribution|industrial/i.test(r.unitType))
    || input.assumptions.some((a) => /dry_warehouse|cold_storage|last_mile_flex/.test(a.field_key));

  // 1) Tenant concentration: explicit assumption, else largest component share.
  let concentration = assumptionVal(input, "tenant_concentration_pct");
  let concentrationEvidence: string;
  if (concentration != null) {
    concentrationEvidence = `Documented tenant concentration ${pct(concentration)}`;
  } else if (revenue.length > 1) {
    const gpr = revenue.map((r) => ({
      name: r.unitType,
      gpr: r.rentBasis === "per_sf" ? r.unitCount * Number(r.avgSf ?? 0) * r.rent : r.unitCount * r.rent * 12,
    }));
    const total = gpr.reduce((s, g) => s + g.gpr, 0);
    const top = gpr.sort((a, b) => b.gpr - a.gpr)[0];
    concentration = total > 0 ? (top.gpr / total) * 100 : null;
    concentrationEvidence = concentration != null ? `${top.name} contributes ${pct(concentration)} of gross rent` : "";
  } else {
    concentrationEvidence = "";
  }
  if (concentration != null && concentration > 55) {
    findings.push(f(
      "industrial.tenant_concentration",
      "risk", "high",
      "High Tenant Concentration Risk",
      [concentrationEvidence],
      { tenant_concentration_pct: concentration },
      `A single tenant accounts for roughly ${pct(concentration)} of revenue, so a default or non-renewal would materially impair cash flow.`,
      "assumption",
    ));
  }

  // 2) Anchor tenant termination option near or before exit.
  const termYear = assumptionVal(input, "tenant_termination_option_year");
  const holdYears = input.input?.holdYears ?? null;
  if (termYear != null && (holdYears == null || termYear <= holdYears + 1)) {
    findings.push(f(
      "industrial.termination_option",
      "risk", "high",
      "Anchor Tenant Termination Option",
      [`Termination option in year ${termYear}${holdYears != null ? ` vs ${holdYears}-year hold` : ""}`],
      { termination_option_year: termYear },
      "Anchor tenant termination option may impair exit liquidity and re-leasing certainty around the hold period.",
      "assumption",
    ));
  }

  // 3) Cold-storage re-tenanting risk.
  const coldComponent = revenue.find((r) => COLD_RE.test(r.unitType))
    || input.assumptions.find((a) => a.field_key.startsWith("cold_storage"));
  if (coldComponent) {
    findings.push(f(
      "industrial.cold_storage_retenanting",
      "risk", "medium",
      "Cold-Storage Re-Tenanting Risk",
      ["Cold-storage component present in the revenue program"],
      {},
      "Specialized cold-storage improvements are tenant-specific and may increase re-tenanting time and cost on rollover.",
      "assumption",
    ));
  }

  // 4) Cap-rate sensitivity: cap expansion scenario turns profit negative.
  const capProfit = metric(input.scenarios.cap_expansion ?? {}, "projected_profit");
  if (capProfit != null && capProfit < 0) {
    findings.push(f(
      "industrial.cap_sensitivity",
      "risk", "high",
      "Exit Cap-Rate Sensitivity",
      [`Cap-expansion scenario development profit ${money(capProfit)}`],
      { cap_expansion_profit: capProfit },
      "Exit cap sensitivity materially impairs value: a modest cap-rate widening drives development profit negative.",
      "scenario",
    ));
  }

  // 5) Rate-lock supersession increases debt service.
  const interestRow = input.assumptions.find((a) =>
    a.field_key === "interest_rate" && (RATE_LOCK_RE.test(a.source_location ?? "") || RATE_LOCK_RE.test(a.source_text ?? "")),
  );
  if (interestRow) {
    findings.push(f(
      "industrial.rate_lock",
      "risk", "medium",
      "Updated Rate Lock Increases Debt Service",
      [`Interest rate sourced from ${interestRow.source_location ?? "rate lock / addendum"}`],
      interestRow.value_numeric != null ? { interest_rate_pct: Number(interestRow.value_numeric) } : {},
      "The rate lock / addendum rate supersedes the original term sheet and increases the debt-service burden versus the initial quote.",
      "assumption",
    ));
  }

  // 6) Infrastructure / utility timing risk.
  const offsite = assumptionVal(input, "offsite_improvements");
  const utility = input.assumptions.find((a) => a.field_key === "utility_substation_completion");
  if (offsite != null || utility) {
    findings.push(f(
      "industrial.infrastructure_timing",
      "risk", "medium",
      "Infrastructure Timing Risk",
      [
        offsite != null ? `Offsite improvements ${money(offsite)}` : null,
        utility ? `Utility/substation completion: ${utility.value_text ?? "scheduled"}` : null,
      ].filter(Boolean) as string[],
      offsite != null ? { offsite_improvements: offsite } : {},
      "Delivery depends on offsite improvements and/or utility/substation completion; timing slippage delays lease-up and stabilization.",
      "assumption",
    ));
  }

  // Avoid emitting industrial findings for clearly non-industrial deals.
  return isIndustrial ? findings : [];
}
