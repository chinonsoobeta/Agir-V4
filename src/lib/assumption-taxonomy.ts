// Canonical underwriting assumption taxonomy. Every project assumption MUST
// originate from one of these field_keys so calculations remain traceable.
// Each definition includes alias terms so Stage-3 alias mapping can resolve
// free-text labels lifted from documents into canonical keys.

export type AssumptionDef = {
  key: string;
  label: string;
  category:
    | "Costs"
    | "Revenue"
    | "Capital Stack"
    | "Operations"
    | "Exit"
    | "Schedule"
    | "Sponsor";
  unit: string; // $, %, x, mo, yr, units, count, text
  numeric: boolean;
  required: boolean;
  aliases: string[];
};

// Required set per product spec:
//   Land Cost, Hard Cost, Debt Amount, Equity Amount, Interest Rate,
//   Stabilized Occupancy, Exit Cap Rate.
// Optional set includes Environmental Reserve, Delay Contingency,
// Lease-Up Schedule, Tax Reassessment.

export const ASSUMPTION_DEFS: AssumptionDef[] = [
  { key: "land_cost", label: "Land Cost", category: "Costs", unit: "$", numeric: true, required: true,
    aliases: ["land cost","land acquisition","acquisition cost","acquisition price","purchase price","site acquisition","site cost","land basis","land purchase"] },
  { key: "hard_costs", label: "Hard / Construction Costs", category: "Costs", unit: "$", numeric: true, required: true,
    aliases: ["hard cost","hard costs","construction cost","construction costs","building costs","gmp","guaranteed maximum price","trade costs","direct costs"] },
  { key: "soft_costs", label: "Soft Costs", category: "Costs", unit: "$", numeric: true, required: false,
    aliases: ["soft cost","soft costs","professional fees","architect fees","permits","ffe","indirect costs"] },
  { key: "financing_costs", label: "Financing Costs", category: "Costs", unit: "$", numeric: true, required: false,
    aliases: ["financing cost","loan fees","origination fee","interest reserve","carry cost"] },
  { key: "contingency", label: "Contingency", category: "Costs", unit: "$", numeric: true, required: false,
    aliases: ["contingency","construction contingency","delay contingency","cost contingency"] },
  { key: "environmental_reserve", label: "Environmental Reserve", category: "Costs", unit: "$", numeric: true, required: false,
    aliases: ["environmental reserve","environmental remediation","phase ii reserve","esa reserve"] },
  { key: "tax_reassessment", label: "Tax Reassessment", category: "Costs", unit: "$", numeric: true, required: false,
    aliases: ["tax reassessment","property tax reassessment","reassessed taxes","mill rate change"] },
  { key: "total_project_cost", label: "Total Project Cost", category: "Costs", unit: "$", numeric: true, required: false,
    aliases: ["total project cost","tpc","total development cost","tdc","total budget","total cost"] },

  { key: "residential_units", label: "Residential Units", category: "Revenue", unit: "units", numeric: true, required: false,
    aliases: ["residential units","apartment units","unit count","multifamily units","rental units"] },
  { key: "residential_rent_monthly", label: "Residential Rent (per unit / mo)", category: "Revenue", unit: "$", numeric: true, required: false,
    aliases: ["residential rent","average rent","rent per unit","monthly rent","asking rent"] },
  { key: "retail_sf", label: "Retail SF", category: "Revenue", unit: "SF", numeric: true, required: false,
    aliases: ["retail sf","retail square feet","retail area","ground floor retail"] },
  { key: "retail_rent_psf", label: "Retail Rent ($/SF)", category: "Revenue", unit: "$/SF", numeric: true, required: false,
    aliases: ["retail rent","retail rent psf","retail $/sf"] },
  { key: "office_sf", label: "Office SF", category: "Revenue", unit: "SF", numeric: true, required: false,
    aliases: ["office sf","office square feet","office area","rentable office area"] },
  { key: "office_rent_psf", label: "Office Rent ($/SF)", category: "Revenue", unit: "$/SF", numeric: true, required: false,
    aliases: ["office rent","office rent psf","office $/sf"] },

  // Industrial / logistics revenue components. Authoritative population is the
  // row-aware rent-roll parser; aliases here only help the free-text sweep.
  { key: "dry_warehouse_sf", label: "Dry Warehouse SF", category: "Revenue", unit: "SF", numeric: true, required: false,
    aliases: ["dry warehouse sf","dry warehouse square feet","warehouse sf","distribution sf","bulk distribution sf","industrial warehouse sf"] },
  { key: "dry_warehouse_rent_psf", label: "Dry Warehouse Rent ($/SF)", category: "Revenue", unit: "$/SF", numeric: true, required: false,
    aliases: ["dry warehouse rent","warehouse rent psf","distribution rent","bulk distribution rent"] },
  { key: "dry_warehouse_occupancy", label: "Dry Warehouse Occupancy", category: "Revenue", unit: "%", numeric: true, required: false,
    aliases: ["dry warehouse occupancy","warehouse occupancy","distribution occupancy"] },
  { key: "cold_storage_sf", label: "Cold Storage SF", category: "Revenue", unit: "SF", numeric: true, required: false,
    aliases: ["cold storage sf","cold-chain sf","refrigerated warehouse sf","temperature-controlled sf"] },
  { key: "cold_storage_rent_psf", label: "Cold Storage Rent ($/SF)", category: "Revenue", unit: "$/SF", numeric: true, required: false,
    aliases: ["cold storage rent","cold-chain rent","refrigerated warehouse rent","temperature-controlled rent"] },
  { key: "cold_storage_occupancy", label: "Cold Storage Occupancy", category: "Revenue", unit: "%", numeric: true, required: false,
    aliases: ["cold storage occupancy","cold-chain occupancy","refrigerated occupancy"] },
  { key: "last_mile_flex_sf", label: "Last-Mile Flex SF", category: "Revenue", unit: "SF", numeric: true, required: false,
    aliases: ["last-mile flex sf","last mile sf","flex logistics sf","urban logistics sf"] },
  { key: "last_mile_flex_rent_psf", label: "Last-Mile Flex Rent ($/SF)", category: "Revenue", unit: "$/SF", numeric: true, required: false,
    aliases: ["last-mile flex rent","last mile rent","flex logistics rent","delivery rent"] },
  { key: "last_mile_flex_occupancy", label: "Last-Mile Flex Occupancy", category: "Revenue", unit: "%", numeric: true, required: false,
    aliases: ["last-mile flex occupancy","last mile occupancy","flex logistics occupancy"] },

  // Industrial risk / structure fields (informational; surfaced by findings).
  { key: "tenant_concentration_pct", label: "Tenant Concentration", category: "Operations", unit: "%", numeric: true, required: false,
    aliases: ["tenant concentration","revenue concentration","single tenant concentration","largest tenant share","anchor tenant concentration"] },
  { key: "anchor_tenant_name", label: "Anchor Tenant", category: "Operations", unit: "text", numeric: false, required: false,
    aliases: ["anchor tenant","largest tenant","primary tenant","single tenant"] },
  { key: "tenant_termination_option_year", label: "Tenant Termination Option (year)", category: "Operations", unit: "yr", numeric: true, required: false,
    aliases: ["termination option","early termination","kick-out","kick out","termination year"] },
  { key: "min_debt_yield", label: "Minimum Debt Yield Covenant", category: "Capital Stack", unit: "%", numeric: true, required: false,
    aliases: ["minimum debt yield","debt yield covenant","required debt yield","debt yield"] },
  { key: "leasing_reserve", label: "Leasing Reserve", category: "Costs", unit: "$", numeric: true, required: false,
    aliases: ["leasing reserve","leasing commissions reserve","ti/lc reserve"] },
  { key: "offsite_improvements", label: "Offsite Improvements", category: "Costs", unit: "$", numeric: true, required: false,
    aliases: ["offsite improvements","off-site improvements","public road improvements","municipal improvements","infrastructure improvements"] },
  { key: "utility_substation_completion", label: "Utility / Substation Completion", category: "Schedule", unit: "text", numeric: false, required: false,
    aliases: ["substation completion","power delivery","utility completion","electrical substation"] },

  { key: "stabilized_occupancy", label: "Stabilized Occupancy", category: "Operations", unit: "%", numeric: true, required: true,
    aliases: ["stabilized occupancy","economic occupancy","physical occupancy","overall occupancy","portfolio occupancy","blended occupancy","average occupancy"] },
  // Component-level occupancies: when present they are NEVER collapsed into a
  // flat blended number: each revenue component carries its own occupancy.
  { key: "residential_occupancy", label: "Residential Occupancy", category: "Revenue", unit: "%", numeric: true, required: false,
    aliases: ["residential occupancy","apartment occupancy","residential stabilized occupancy","multifamily occupancy"] },
  { key: "retail_occupancy", label: "Retail Occupancy", category: "Revenue", unit: "%", numeric: true, required: false,
    aliases: ["retail occupancy","retail stabilized occupancy"] },
  { key: "office_occupancy", label: "Office Occupancy", category: "Revenue", unit: "%", numeric: true, required: false,
    aliases: ["office occupancy","office stabilized occupancy"] },
  { key: "other_income_annual", label: "Other Income (annual)", category: "Revenue", unit: "$", numeric: true, required: false,
    aliases: ["other income","ancillary income","parking income","misc income"] },
  { key: "lender_stabilized_occupancy", label: "Lender Stabilization Requirement", category: "Capital Stack", unit: "%", numeric: true, required: false,
    aliases: ["lender stabilization","stabilization requirement","required occupancy","stabilization test"] },
  { key: "rent_growth", label: "Annual Rent Growth", category: "Operations", unit: "%", numeric: true, required: false,
    aliases: ["rent growth","annual rent growth","rent escalation","rent inflation"] },
  { key: "opex_ratio", label: "Operating Expense Ratio", category: "Operations", unit: "%", numeric: true, required: false,
    aliases: ["operating expense ratio","opex ratio","oer","expense ratio","opex %"] },
  { key: "lease_up_months", label: "Lease-Up Period", category: "Operations", unit: "mo", numeric: true, required: false,
    aliases: ["lease-up","lease up","lease-up period","lease-up schedule","absorption period"] },

  { key: "debt_amount", label: "Debt Amount", category: "Capital Stack", unit: "$", numeric: true, required: true,
    aliases: ["debt amount","loan amount","senior loan","senior construction debt","construction debt","senior debt","construction loan","mortgage amount","facility size"] },
  { key: "equity_amount", label: "Equity Amount", category: "Capital Stack", unit: "$", numeric: true, required: true,
    aliases: ["equity amount","sponsor equity","common equity","total equity","equity contribution","equity check"] },
  { key: "interest_rate", label: "Interest Rate", category: "Capital Stack", unit: "%", numeric: true, required: true,
    aliases: ["interest rate","coupon","loan rate","sofr spread","all-in rate","note rate"] },
  { key: "ltc", label: "Loan-to-Cost", category: "Capital Stack", unit: "%", numeric: true, required: false,
    aliases: ["loan to cost","ltc","loan-to-cost ratio"] },
  { key: "amortization_years", label: "Amortization Period", category: "Capital Stack", unit: "yr", numeric: true, required: false,
    aliases: ["amortization","amortization period","amort term"] },
  { key: "min_dscr", label: "Minimum DSCR Covenant", category: "Capital Stack", unit: "x", numeric: true, required: false,
    aliases: ["minimum dscr","dscr covenant","required dscr"] },

  // ---- Multi-tranche debt (mezzanine). Optional; absent => senior-only. ----
  { key: "mezz_debt_amount", label: "Mezzanine Debt Amount", category: "Capital Stack", unit: "$", numeric: true, required: false,
    aliases: ["mezzanine debt","mezzanine loan","mezz loan","mezz debt","subordinate debt","junior debt","mezzanine facility"] },
  { key: "mezz_interest_rate", label: "Mezzanine Interest Rate", category: "Capital Stack", unit: "%", numeric: true, required: false,
    aliases: ["mezzanine rate","mezzanine interest rate","mezz rate","mezz coupon","subordinate debt rate"] },
  { key: "mezz_amortization_years", label: "Mezzanine Amortization", category: "Capital Stack", unit: "yr", numeric: true, required: false,
    aliases: ["mezzanine amortization","mezz amortization","mezzanine amort term"] },
  { key: "mezz_io_months", label: "Mezzanine Interest-Only Period", category: "Capital Stack", unit: "mo", numeric: true, required: false,
    aliases: ["mezzanine interest only","mezz io","mezzanine io period"] },

  // ---- LP/GP distribution waterfall and promote. Optional; absent => LP holds the whole deal. ----
  { key: "lp_equity_pct", label: "LP Equity Share", category: "Capital Stack", unit: "%", numeric: true, required: false,
    aliases: ["lp equity","lp equity share","limited partner equity","lp share","lp contribution pct"] },
  { key: "gp_equity_pct", label: "GP Equity Share (co-invest)", category: "Capital Stack", unit: "%", numeric: true, required: false,
    aliases: ["gp equity","gp equity share","gp co-invest","general partner equity","sponsor co-invest","gp share"] },
  { key: "preferred_return_pct", label: "Preferred Return (hurdle)", category: "Capital Stack", unit: "%", numeric: true, required: false,
    aliases: ["preferred return","pref return","preferred rate","lp preferred","hurdle rate","pref"] },
  { key: "gp_catch_up_pct", label: "GP Catch-Up", category: "Capital Stack", unit: "%", numeric: true, required: false,
    aliases: ["gp catch-up","gp catch up","catch-up","catchup","gp catchup percentage"] },
  { key: "promote_tier1_hurdle_pct", label: "Promote Tier 1 Hurdle", category: "Capital Stack", unit: "%", numeric: true, required: false,
    aliases: ["promote tier 1 hurdle","first hurdle","tier 1 irr hurdle","first promote hurdle"] },
  { key: "promote_tier1_gp_pct", label: "Promote Tier 1 GP Split", category: "Capital Stack", unit: "%", numeric: true, required: false,
    aliases: ["promote tier 1","first promote","tier 1 promote","carried interest tier 1","gp promote tier 1"] },
  { key: "promote_tier2_hurdle_pct", label: "Promote Tier 2 Hurdle", category: "Capital Stack", unit: "%", numeric: true, required: false,
    aliases: ["promote tier 2 hurdle","second hurdle","tier 2 irr hurdle","second promote hurdle"] },
  { key: "promote_tier2_gp_pct", label: "Promote Tier 2 GP Split", category: "Capital Stack", unit: "%", numeric: true, required: false,
    aliases: ["promote tier 2","second promote","tier 2 promote","carried interest tier 2","gp promote tier 2"] },

  // ---- Equity draw timing. Optional; absent => single lump sum at t=0. ----
  { key: "equity_draw_months", label: "Equity Draw Period", category: "Schedule", unit: "mo", numeric: true, required: false,
    aliases: ["equity draw period","equity draw months","equity contribution schedule","equity draw schedule"] },

  { key: "exit_cap_rate", label: "Exit Cap Rate", category: "Exit", unit: "%", numeric: true, required: true,
    aliases: ["exit cap","exit cap rate","disposition cap","reversion cap rate","terminal cap"] },
  { key: "hold_period_years", label: "Hold Period", category: "Exit", unit: "yr", numeric: true, required: false,
    aliases: ["hold period","investment horizon","hold term"] },
  { key: "disposition_cost_pct", label: "Disposition Costs", category: "Exit", unit: "%", numeric: true, required: false,
    aliases: ["disposition cost","disposition costs","selling costs","broker fee"] },

  { key: "sponsor_track_record", label: "Sponsor Track Record", category: "Sponsor", unit: "text", numeric: false, required: false,
    aliases: ["sponsor track record","sponsor experience","sponsor history"] },
];

export const ASSUMPTION_KEYS = ASSUMPTION_DEFS.map((d) => d.key);
export const ASSUMPTION_BY_KEY = Object.fromEntries(ASSUMPTION_DEFS.map((d) => [d.key, d]));
export const REQUIRED_KEYS = ASSUMPTION_DEFS.filter((d) => d.required).map((d) => d.key);
export const OPTIONAL_KEYS = ASSUMPTION_DEFS.filter((d) => !d.required).map((d) => d.key);

// Flat alias → canonical key index (lowercase, trimmed).
export const ALIAS_INDEX: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const d of ASSUMPTION_DEFS) {
    out[d.label.toLowerCase()] = d.key;
    out[d.key.toLowerCase()] = d.key;
    for (const a of d.aliases) out[a.toLowerCase()] = d.key;
  }
  return out;
})();

export function resolveAlias(term: string): string | null {
  if (!term) return null;
  const t = term.toLowerCase().trim().replace(/\s+/g, " ");
  if (ALIAS_INDEX[t]) return ALIAS_INDEX[t];
  // Loose match: contains any alias as a substring
  for (const [alias, key] of Object.entries(ALIAS_INDEX)) {
    if (alias.length >= 6 && t.includes(alias)) return key;
  }
  return null;
}

export function bandFor(score: number): "high" | "medium" | "low" | "missing" {
  if (score >= 85) return "high";
  if (score >= 60) return "medium";
  if (score > 0) return "low";
  return "missing";
}
