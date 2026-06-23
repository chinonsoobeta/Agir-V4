import { ASSUMPTION_BY_KEY } from "./assumption-taxonomy";
import { classifyRevenueComponent } from "./taxonomy-engine-map";
import type { MappedCandidate } from "./assumption-mapping";
import type { ParsedRentRollRow } from "./parsers/rent-roll.server";

type RevenueAssumptionValue = { key: string; value: number | null };

// Residential / retail / office classifier (existing supported types). Industrial
// and any other component types are handled generically via classifyRevenueComponent.
function legacyComponent(unitType: string): "Residential" | "Retail" | "Office" | null {
  const t = unitType.toLowerCase();
  if (/\bresidential|apartment|multifamily|multi-family\b/.test(t)) return "Residential";
  if (/\bretail|shop|storefront\b/.test(t)) return "Retail";
  if (/\boffice|commercial office\b/.test(t)) return "Office";
  return null;
}

function isOtherIncome(unitType: string): boolean {
  return /\bother income|ancillary|misc(ellaneous)? income|parking|solar\b/i.test(unitType);
}

export function revenueSourceText(row: ParsedRentRollRow): string {
  const tenant = (row as ParsedRentRollRow & { tenant?: string | null }).tenant;
  const parts = [
    `Component=${row.unitType}`,
    tenant ? `Tenant=${tenant}` : null,
    `Rentable SF=${row.avgSf ?? 0}`,
    `Unit Count=${row.unitCount}`,
    `Market Rent=$${row.rent}`,
    `Rent Basis=${row.rentBasis}`,
    row.occupancyPct != null ? `Occupancy=${row.occupancyPct.toFixed(2)}%` : null,
  ].filter(Boolean);
  return `${row.sourceCellRef}: ${parts.join(" | ")}`;
}

export function mapRevenueProgramRowToAssumptions(row: ParsedRentRollRow, sourceDocument: { name: string }): MappedCandidate[] {
  const source_text = revenueSourceText(row);
  const emit = (key: string, value: number | null, role: string): MappedCandidate[] => {
    if (value == null || !Number.isFinite(value)) return [];
    const def = ASSUMPTION_BY_KEY[key];
    if (!def) return [];
    return [{
      field_key: key,
      value_numeric: value,
      value_text: null,
      unit: def.unit,
      confidence: 98,
      source_doc_name: sourceDocument.name,
      source_text,
      source_location: row.sourceCellRef,
      matched_alias: role,
      via: "alias" as const,
      candidate_role: "rent_row" as const,
    }];
  };

  // Other Income is a scalar, not a leasable component, and is reported ANNUAL.
  // A single aggregate line (count <= 1) is taken as-is; a multi-unit line
  // (e.g. 50 parking stalls @ $X/MONTH) is annualized per the parser's
  // $/unit/month convention (count × rent × 12). Previously both branches
  // returned the raw figure, silently understating multi-unit other income 12x.
  if (isOtherIncome(row.unitType)) {
    const annual = row.rentBasis === "per_unit" && row.unitCount > 1
      ? row.unitCount * row.rent * 12
      : row.rent;
    return emit("other_income_annual", annual, "Other income rent-roll row");
  }

  // Residential / retail / office keep their dedicated keys.
  const legacy = legacyComponent(row.unitType);
  if (legacy === "Residential") {
    return [
      ...emit("residential_units", row.unitCount, "Residential rent-roll row"),
      ...emit("residential_rent_monthly", row.rentBasis === "per_unit" ? row.rent : null, "Residential rent-roll row"),
      ...emit("residential_occupancy", row.occupancyPct, "Residential rent-roll row"),
    ];
  }
  if (legacy === "Retail" || legacy === "Office") {
    const sf = legacy === "Retail" ? "retail_sf" : "office_sf";
    const rent = legacy === "Retail" ? "retail_rent_psf" : "office_rent_psf";
    const occ = legacy === "Retail" ? "retail_occupancy" : "office_occupancy";
    return [
      ...emit(sf, row.avgSf, `${legacy} rent-roll row`),
      ...emit(rent, row.rentBasis === "per_sf" ? row.rent : null, `${legacy} rent-roll row`),
      ...emit(occ, row.occupancyPct, `${legacy} rent-roll row`),
    ];
  }

  // Generic industrial / logistics components — mapped to the canonical
  // per-component key set so approval writes one revenue_program row.
  const keys = classifyRevenueComponent(row.unitType);
  if (keys) {
    const role = `${row.unitType} rent-roll row`;
    return [
      ...emit(keys.sf, row.avgSf, role),
      ...emit(keys.rent, row.rentBasis === "per_sf" ? row.rent : null, role),
      ...emit(keys.occupancy, row.occupancyPct, role),
    ];
  }

  // Unknown component type with usable per_sf data: fall back to dry_warehouse
  // keys so revenue is not silently dropped (still source-backed, never invented).
  if (row.rentBasis === "per_sf" && row.avgSf && row.rent) {
    const role = `${row.unitType} rent-roll row (generic industrial)`;
    return [
      ...emit("dry_warehouse_sf", row.avgSf, role),
      ...emit("dry_warehouse_rent_psf", row.rent, role),
      ...emit("dry_warehouse_occupancy", row.occupancyPct, role),
    ];
  }
  return [];
}
