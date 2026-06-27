import { FINDING_THRESHOLDS, f, metric, money, pct, x } from "../findings-rules";
import type { Finding, NormalizedFindingsInput } from "../findings-types";

function assumptionValue(input: NormalizedFindingsInput, key: string): number | null {
  const row = input.assumptions.find((a) => a.field_key === key);
  const value = row?.value_numeric == null ? null : Number(row.value_numeric);
  return Number.isFinite(value) ? value : null;
}

export function debtFindings(input: NormalizedFindingsInput): Finding[] {
  const findings: Finding[] = [];
  const dscr = metric(input.base, "dscr");
  const minDscr = assumptionValue(input, "min_dscr") ?? FINDING_THRESHOLDS.minDscr;
  const noi = metric(input.base, "stabilized_noi");
  const annualDebtService = metric(input.base, "annual_debt_service");
  const loan = input.input?.loanAmount ?? null;
  const debtYield = loan && noi != null && loan > 0 ? (noi / loan) * 100 : null;

  if (dscr != null && dscr < minDscr) {
    findings.push(
      f(
        "debt.weak_dscr",
        "weakness",
        "high",
        "Weak Debt Coverage",
        [`DSCR ${x(dscr)}`, `Threshold ${x(minDscr)}`],
        { dscr, threshold: minDscr },
        "Operating cash flow is insufficient relative to required amortizing debt service.",
        "underwriting",
        `Reduce leverage or increase NOI until DSCR exceeds ${x(minDscr)}.`,
      ),
    );
    findings.push(
      f(
        "debt.refinance_risk",
        "risk",
        "high",
        "Refinance Risk",
        [
          `DSCR ${x(dscr)}`,
          annualDebtService == null
            ? "Annual debt service unavailable"
            : `Annual debt service ${money(annualDebtService)}`,
        ],
        {
          dscr,
          threshold: minDscr,
          ...(annualDebtService == null ? {} : { annual_debt_service: annualDebtService }),
        },
        "A DSCR covenant failure indicates limited cash flow support for the proposed debt load.",
        "underwriting",
        "Reduce leverage.",
      ),
    );
  } else if (dscr != null) {
    findings.push(
      f(
        "debt.dscr_pass",
        "covenant",
        "low",
        "DSCR Covenant Pass",
        [`DSCR ${x(dscr)}`, `Threshold ${x(minDscr)}`],
        { dscr, threshold: minDscr },
        "Underwritten debt coverage meets the DSCR threshold.",
        "underwriting",
      ),
    );
  }

  if (dscr != null && dscr < minDscr) {
    const shortfall = (minDscr - dscr) / minDscr;
    if (shortfall > 0 && shortfall <= 0.2) {
      findings.push(
        f(
          "debt.noi_enhancement_opportunity",
          "opportunity",
          "medium",
          "NOI Enhancement Opportunity",
          [`DSCR ${x(dscr)}`, `Threshold ${x(minDscr)}`],
          { dscr, threshold: minDscr, shortfall_ratio: shortfall },
          "The DSCR gap is within the defined close-to-passing range.",
          "underwriting",
          `Increase NOI until DSCR exceeds ${x(minDscr)}.`,
        ),
      );
    }
  }

  if (debtYield != null) {
    findings.push(
      f(
        "debt.debt_yield",
        "covenant",
        "low",
        "Debt Yield Observation",
        [`Debt yield ${pct(debtYield)}`],
        { debt_yield_pct: debtYield },
        "Debt yield is calculated from deterministic NOI and approved loan amount.",
        "underwriting",
      ),
    );
  }

  return findings;
}
