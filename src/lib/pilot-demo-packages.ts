export type PilotDealPackage = {
  id: string;
  name: string;
  assetType: string;
  intendedOutcome: string;
  availability: "seedable" | "fixture_only" | "corpus_harness";
  documents: string[];
  expectedWorkflow: string[];
  knownWatchpoints: string[];
};

export const PILOT_DEAL_PACKAGES: PilotDealPackage[] = [
  {
    id: "rivergate",
    name: "Rivergate",
    assetType: "Mixed-use development",
    intendedOutcome:
      "Validate that messy rent-roll rows and lender terms produce a conservative underwriting case without invented lease-up.",
    availability: "fixture_only",
    documents: [
      "Rivergate_Appraisal_Valuation_Memo.pdf",
      "Rivergate_Construction_Budget.xlsx",
      "Rivergate_Lender_Term_Sheet.pdf",
      "Rivergate_Market_Study.pdf",
      "Rivergate_Rent_Roll.xlsx",
      "Rivergate_Sponsor_Investment_Summary.pdf",
    ],
    expectedWorkflow: [
      "Upload documents",
      "Extract assumptions",
      "Resolve conflicts",
      "Run underwriting",
      "Generate IC memo",
    ],
    knownWatchpoints: ["Revenue extraction from spreadsheet rows", "No fabricated lease-up months"],
  },
  {
    id: "summit-point",
    name: "Summit Point Logistics Park",
    assetType: "Industrial development",
    intendedOutcome:
      "Validate industrial $/SF rent basis, tenant lease abstracts, incentives, and lender terms through extraction and underwriting.",
    availability: "fixture_only",
    documents: [
      "Summit_Point_Appraisal_Valuation_Memo.pdf",
      "Summit_Point_Construction_Budget.xlsx",
      "Summit_Point_Lender_Term_Sheet.pdf",
      "Summit_Point_Rent_Roll.xlsx",
      "Summit_Point_Tenant_Lease_Abstracts.pdf",
    ],
    expectedWorkflow: [
      "Upload documents",
      "Review industrial rent roll",
      "Run underwriting",
      "Generate lender package",
    ],
    knownWatchpoints: ["Industrial $/SF rent basis", "Tenant lease abstract extraction"],
  },
  {
    id: "harbour-centre",
    name: "Harbour Centre",
    assetType: "Residential/mixed-use demo",
    intendedOutcome:
      "Seed a live deal that forces conflict resolution, default acceptance, underwriting, memo generation, and audit review.",
    availability: "seedable",
    documents: [
      "Harbour_Centre_Sponsor_Summary.pdf",
      "Harbour_Centre_Market_Study.pdf",
      "Harbour_Centre_Broker_Opinion.pdf",
      "Harbour_Centre_Lender_Term_Sheet.pdf",
      "Harbour_Centre_Construction_Budget.xlsx",
      "Harbour_Centre_Rent_Roll.xlsx",
    ],
    expectedWorkflow: ["Seed demo", "Resolve exit-cap conflict", "Accept defaults", "Run memo"],
    knownWatchpoints: ["Conflicting cap-rate sources", "Missing operating assumptions"],
  },
  {
    id: "synthetic-commercial",
    name: "Commercial Rent Roll Regression",
    assetType: "Commercial / industrial",
    intendedOutcome:
      "Exercise the extraction corpus against $/SF headers, scaled money, and false-positive capital stack guards.",
    availability: "corpus_harness",
    documents: ["commercial_rent_roll.xlsx", "budget.xlsx", "capital_stack.txt"],
    expectedWorkflow: ["Run corpus harness", "Validate $/SF extraction", "Validate capital stack"],
    knownWatchpoints: ["False unit-count positives", "Scaled money values"],
  },
  {
    id: "ocr-stress",
    name: "OCR Stress Package",
    assetType: "Scanned term sheet",
    intendedOutcome:
      "Exercise OCR fallback behavior, confidence reporting, and long-document page-cap metadata.",
    availability: "corpus_harness",
    documents: ["Scanned_Term_Sheet.pdf", "Long_Scanned_Appraisal.pdf"],
    expectedWorkflow: ["Run OCR fallback", "Check confidence", "Respect page cap"],
    knownWatchpoints: ["Low-confidence OCR", "Page-cap metadata"],
  },
];
