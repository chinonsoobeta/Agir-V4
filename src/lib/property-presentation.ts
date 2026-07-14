export type PropertyAddress = {
  display_name?: string | null;
  building_name?: string | null;
  address_line_1?: string | null;
  address_line_2?: string | null;
  unit?: string | null;
  municipality?: string | null;
  region?: string | null;
  postal_code?: string | null;
  currency?: string | null;
  price?: number | null;
};

export function propertyTitle(property: PropertyAddress): string {
  return (
    property.display_name?.trim() ||
    property.building_name?.trim() ||
    property.address_line_1?.trim() ||
    "Untitled property"
  );
}

export function propertyAddress(property: PropertyAddress): string {
  const line2 = [property.address_line_2, property.unit ? `Unit ${property.unit}` : null]
    .filter(Boolean)
    .join(" · ");
  return [
    property.address_line_1,
    line2,
    property.municipality,
    property.region,
    property.postal_code,
  ]
    .filter((part, index, values) => Boolean(part) && values.indexOf(part) === index)
    .join(", ");
}

export function propertyPrice(property: PropertyAddress): string {
  if (property.price == null || !Number.isFinite(Number(property.price))) return "Not recorded";
  try {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: property.currency || "CAD",
      maximumFractionDigits: 0,
    }).format(Number(property.price));
  } catch {
    return `${Number(property.price).toLocaleString("en-CA")} ${property.currency || "CAD"}`;
  }
}

export function activityLabel(action: string): string {
  const labels: Record<string, string> = {
    property_created: "Property created",
    property_updated: "Property details updated",
    property_archived: "Property archived",
    project_linked: "Deal linked",
    permit_case_linked: "Permit case linked",
    task_created: "Task created",
    task_updated: "Task updated",
    url_added: "Link added",
    property_tasks_insert: "Task created",
    property_tasks_update: "Task updated",
    property_tasks_delete: "Task removed",
    property_urls_insert: "Link added",
    property_urls_delete: "Link removed",
    property_contacts_insert: "Contact linked",
    property_contacts_delete: "Contact unlinked",
    projects_linked: "Deal linked",
    projects_unlinked: "Deal unlinked",
    permit_cases_linked: "Permit case linked",
    permit_cases_unlinked: "Permit case unlinked",
    documents_linked: "Document linked",
    documents_unlinked: "Document unlinked",
  };
  return (
    labels[action] ?? action.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase())
  );
}
