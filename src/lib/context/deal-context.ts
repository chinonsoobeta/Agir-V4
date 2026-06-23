// Derive a DealContext deterministically from approved engine inputs + project
// metadata. No new analyst inputs are required; everything is inferred from data
// the engine already consumes, so context is always available.

import type { RevenueUnitInput, UnderwritingInput } from "../engine/types";
import { componentGpr } from "../engine/proforma";
import type { AssetClass, AssetMixComponent, DealContext, DealStage, LoanStructure, MarketTier } from "./types";

export function classifyAssetClass(unitType: string): AssetClass {
  const t = (unitType || "").toLowerCase();
  if (/resident|apartment|multifamily|multi-family|\bunit\b|studio|\d\s*br\b|1br|2br|3br|condo/.test(t)) return "multifamily";
  if (/cold[\s-]?storage|warehouse|distribution|logistics|industrial|flex|last[\s-]?mile|bulk/.test(t)) return "industrial";
  if (/retail|shop|storefront|grocery|anchor|mall/.test(t)) return "retail";
  if (/office|commercial office|medical office|lab|life science/.test(t)) return "office";
  if (/hotel|hospitality|resort|motel|key\b/.test(t)) return "hospitality";
  return "other";
}

// GPR-weighted asset mix; dominant class wins, or "mixed_use" when no class
// holds a clear majority.
export function deriveAssetMix(revenueProgram: RevenueUnitInput[]): { mix: AssetMixComponent[]; dominant: AssetClass } {
  const byClass = new Map<AssetClass, number>();
  let total = 0;
  for (const row of revenueProgram) {
    const cls = classifyAssetClass(row.unitType);
    const gpr = componentGpr(row);
    if (!(gpr > 0)) continue;
    byClass.set(cls, (byClass.get(cls) ?? 0) + gpr);
    total += gpr;
  }
  if (total <= 0 || byClass.size === 0) {
    return { mix: [{ assetClass: "other", sharePct: 100 }], dominant: "other" };
  }
  const mix = [...byClass.entries()]
    .map(([assetClass, gpr]) => ({ assetClass, sharePct: (gpr / total) * 100 }))
    .sort((a, b) => b.sharePct - a.sharePct);
  // A single type, or one type that dominates (>=85% of GPR), defines the deal's
  // class; anything more balanced is genuinely mixed-use.
  const dominant: AssetClass = mix.length === 1 || mix[0].sharePct >= 85 ? mix[0].assetClass : "mixed_use";
  return { mix, dominant };
}

// Market tier from the free-text location. Explicit tier words win; otherwise a
// curated list of gateway/primary metros; default secondary (the conservative
// middle).
export function classifyMarketTier(location: string | null | undefined): { tier: MarketTier; label: string } {
  const t = (location || "").toLowerCase();
  if (/\bgateway\b/.test(t)) return { tier: "gateway", label: "gateway market" };
  if (/\bprimary\b/.test(t)) return { tier: "primary", label: "primary market" };
  if (/\bsecondary\b/.test(t)) return { tier: "secondary", label: "secondary market" };
  if (/\btertiary\b/.test(t)) return { tier: "tertiary", label: "tertiary market" };
  if (/new york|manhattan|nyc|san francisco|bay area|los angeles|boston|washington|seattle|chicago/.test(t))
    return { tier: "gateway", label: "gateway market" };
  if (/austin|denver|atlanta|dallas|miami|nashville|phoenix|charlotte|portland|san diego/.test(t))
    return { tier: "primary", label: "primary market" };
  return { tier: "secondary", label: "secondary market" };
}

export function classifyLoanStructure(input: UnderwritingInput): LoanStructure {
  const holdMonths = Math.max(1, Math.round(input.holdYears * 12));
  if (input.amortYears <= 0) return "interest_only_full";
  if ((input.ioMonths ?? 0) >= holdMonths) return "interest_only_full";
  if ((input.ioMonths ?? 0) > 0) return "partial_io";
  return "amortizing";
}

function classifyStage(input: UnderwritingInput): DealStage {
  if (input.constructionMonths > 6) return "ground_up";
  if (input.leaseUpMonths > 0) return "lease_up";
  return "stabilized";
}

const ASSET_LABEL: Record<AssetClass, string> = {
  multifamily: "multifamily",
  office: "office",
  retail: "retail",
  industrial: "industrial / logistics",
  hospitality: "hospitality",
  mixed_use: "mixed-use",
  other: "commercial",
};

export function deriveDealContext(
  input: UnderwritingInput,
  meta: { type?: string | null; location?: string | null } = {},
): DealContext {
  const { mix, dominant } = deriveAssetMix(input.revenueProgram);
  // The project's declared type wins when it is a recognized class and the
  // revenue mix is ambiguous; otherwise the revenue-derived class leads.
  const declared = classifyAssetClass(String(meta.type ?? ""));
  const assetClass: AssetClass = dominant === "other" && declared !== "other" ? declared : dominant;
  const { tier, label: tierLabel } = classifyMarketTier(meta.location);
  const stage = classifyStage(input);
  const loanStructure = classifyLoanStructure(input);
  const monthsToStabilize = input.constructionMonths + input.leaseUpMonths;

  const notes: string[] = [];
  if (loanStructure === "interest_only_full") notes.push("Loan is interest-only for the entire hold; amortizing coverage is a forward reference, not the near-term debt service.");
  else if (loanStructure === "partial_io") notes.push(`Loan is interest-only for the first ${Math.round((input.ioMonths ?? 0) / 12 * 10) / 10} years, then amortizes.`);
  if (stage === "ground_up") notes.push(`Ground-up development with ${monthsToStabilize} months to stabilization (${input.constructionMonths}mo construction + ${input.leaseUpMonths}mo lease-up).`);
  if (assetClass === "mixed_use") notes.push(`Mixed-use revenue: ${mix.slice(0, 3).map((m) => `${Math.round(m.sharePct)}% ${ASSET_LABEL[m.assetClass]}`).join(", ")}.`);

  const marketLabel = `${tierLabel} ${ASSET_LABEL[assetClass]}`;
  return {
    assetClass,
    assetMix: mix,
    marketTier: tier,
    marketLabel,
    stage,
    loanStructure,
    holdYears: input.holdYears,
    ioMonths: input.ioMonths ?? 0,
    constructionMonths: input.constructionMonths,
    leaseUpMonths: input.leaseUpMonths,
    monthsToStabilize,
    notes,
  };
}

export { ASSET_LABEL };
