export const PROPERTY_PROJECT_TYPES = [
  { value: "acquisition", label: "Acquisition" },
  { value: "development", label: "Ground-up development" },
  { value: "redevelopment", label: "Redevelopment" },
  { value: "renovation", label: "Renovation" },
  { value: "tenant_improvement", label: "Tenant improvement" },
  { value: "conversion_change_of_use", label: "Conversion or change of use" },
  { value: "repositioning", label: "Repositioning" },
  { value: "entitlement_zoning", label: "Entitlement or rezoning" },
  { value: "land_assembly", label: "Land assembly" },
  { value: "asset_management", label: "Asset management" },
  { value: "refinance", label: "Refinance" },
  { value: "disposition", label: "Disposition" },
  { value: "other", label: "Other" },
] as const;

const labelByValue = new Map(PROPERTY_PROJECT_TYPES.map((option) => [option.value, option.label]));

export function propertyProjectTypeLabel(value: string | null | undefined): string {
  if (!value) return "Not categorized";
  return (
    labelByValue.get(value as (typeof PROPERTY_PROJECT_TYPES)[number]["value"]) ??
    value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase())
  );
}

export function propertyProjectTypeOptions(current: string | null | undefined) {
  if (!current || labelByValue.has(current as (typeof PROPERTY_PROJECT_TYPES)[number]["value"]))
    return [...PROPERTY_PROJECT_TYPES];
  return [
    ...PROPERTY_PROJECT_TYPES,
    { value: current, label: `Existing category: ${propertyProjectTypeLabel(current)}` },
  ];
}
