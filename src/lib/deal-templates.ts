// Sample deal templates for common asset types. These pre-fill DEAL METADATA
// only: asset type, a starting name, a typical sourcing channel, a default
// probability, and a checklist of documents to gather next. They never set
// underwriting inputs: the engine's numbers still come exclusively from
// extracted/approved/calculated provenance rows. Every default here is
// explicitly disclosed in the picker so nothing feels like a hidden assumption.

export type DealTemplate = {
  id: string;
  name: string;
  /** Short, plain-language description shown in the picker. */
  description: string;
  /** Maps to projects.type. */
  type: string;
  /** Default probability for a freshly sourced deal of this kind. */
  probability: number;
  /** Typical sourcing channel: pre-fills the Source field. */
  source: string;
  /** Suggested deal-name prefix the user can edit. */
  namePrefix: string;
  /** Documents to gather next (shown as guidance, not data). */
  suggestedDocs: string[];
};

export const DEAL_TEMPLATES: DealTemplate[] = [
  {
    id: "blank",
    name: "Blank deal",
    description: "Start from scratch. Only a name is required.",
    type: "industrial",
    probability: 25,
    source: "",
    namePrefix: "",
    suggestedDocs: ["Offering memorandum", "Rent roll", "Operating budget"],
  },
  {
    id: "multifamily_acq",
    name: "Multifamily acquisition",
    description: "Stabilized or value-add apartments. Underwrite from a rent roll and T-12.",
    type: "multifamily",
    probability: 30,
    source: "Broker: marketed",
    namePrefix: "Multifamily: ",
    suggestedDocs: [
      "Offering memorandum",
      "Rent roll",
      "Trailing-12 operating statement",
      "Loan term sheet",
    ],
  },
  {
    id: "industrial_dev",
    name: "Industrial / logistics development",
    description:
      "Ground-up warehouse or last-mile. Underwrite from a development budget and lease comps.",
    type: "industrial",
    probability: 25,
    source: "Direct: sponsor",
    namePrefix: "Logistics: ",
    suggestedDocs: [
      "Development budget",
      "Site plan",
      "Market lease study",
      "Construction loan term sheet",
    ],
  },
  {
    id: "office_value_add",
    name: "Office value-add",
    description:
      "Reposition with leasing capital. Underwrite from a stacking plan and TI/LC budget.",
    type: "office",
    probability: 20,
    source: "Broker: marketed",
    namePrefix: "Office: ",
    suggestedDocs: [
      "Offering memorandum",
      "Stacking plan / rent roll",
      "TI-LC budget",
      "Market study",
    ],
  },
  {
    id: "retail_acq",
    name: "Retail / mixed-use acquisition",
    description:
      "Grocery-anchored or mixed-use. Underwrite from in-place leases and recovery schedules.",
    type: "mixed_use",
    probability: 30,
    source: "Broker: marketed",
    namePrefix: "Mixed-use: ",
    suggestedDocs: [
      "Offering memorandum",
      "Rent roll",
      "CAM / recovery schedule",
      "Loan term sheet",
    ],
  },
];

export function dealTemplate(id: string): DealTemplate | undefined {
  return DEAL_TEMPLATES.find((t) => t.id === id);
}
