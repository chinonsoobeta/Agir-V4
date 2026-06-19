// Canonical deal asset types. Industrial / logistics is first-class (and the
// default) so logistics deals like Summit Point are not misclassified as
// multifamily.

export const ASSET_TYPES: { value: string; label: string }[] = [
  { value: "industrial", label: "Industrial / Logistics" },
  { value: "mixed_use", label: "Mixed Use" },
  { value: "multifamily", label: "Multifamily" },
  { value: "office", label: "Office" },
  { value: "retail", label: "Retail" },
  { value: "hospitality", label: "Hospitality" },
  { value: "self_storage", label: "Self Storage" },
  { value: "data_center", label: "Data Center" },
  { value: "life_science", label: "Life Science" },
  { value: "commercial", label: "Commercial" },
  { value: "land", label: "Land" },
  { value: "other", label: "Other" },
];

const LABEL_BY_VALUE = Object.fromEntries(ASSET_TYPES.map((t) => [t.value, t.label]));

export function assetTypeLabel(value?: string | null): string {
  if (!value) return "—";
  return LABEL_BY_VALUE[value] ?? value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Detect the likely asset type from free text (project facts / document names /
// extracted component labels). Used to suggest a non-multifamily default.
export function detectAssetType(text: string): string | null {
  const t = (text || "").toLowerCase();
  if (/industrial|logistics|warehouse|distribution|cold[\s-]?storage|last[\s-]?mile|fulfillment/.test(t)) return "industrial";
  if (/data[\s-]?center/.test(t)) return "data_center";
  if (/life[\s-]?science|lab|biotech/.test(t)) return "life_science";
  if (/self[\s-]?storage/.test(t)) return "self_storage";
  if (/hotel|hospitality|resort|keys\b/.test(t)) return "hospitality";
  if (/multifamily|apartment|residential/.test(t)) return "multifamily";
  if (/office/.test(t)) return "office";
  if (/retail|shopping|mall/.test(t)) return "retail";
  return null;
}
