// Registry of in-app seedable demo packages. Each entry is enough for the demo
// seeder (demo.functions.ts) to create a project, upload its bundled source
// documents, and link them as document rows - a full in-app workflow the user
// can then run extraction / review / committee / reporting against.
//
// Two seed modes:
//   - "preseeded": the project ships with verified engine rows + assumptions
//     already populated (Harbour Centre - handled by its bespoke seeder).
//   - "workflow":  the project ships with source documents only; the analyst
//     runs the real extraction pipeline in-app. Used by Rivergate / Summit
//     Point, whose golden numbers live inside the document bytes.
import { RIVERGATE_FIXTURE_FILES } from "./fixtures/rivergate.generated";
import { SUMMIT_POINT_FIXTURE_FILES } from "./fixtures/summit-point.generated";
import type { DemoFixtureFile } from "./fixtures/types";

export type DemoSeedMode = "preseeded" | "workflow";

// Mirror the project enums from the Supabase schema so seeded metadata is
// type-checked against the same unions the projects table accepts.
type ProjectType =
  | "land"
  | "other"
  | "multifamily"
  | "commercial"
  | "mixed_use"
  | "industrial"
  | "retail"
  | "office"
  | "hospitality"
  | "self_storage"
  | "data_center"
  | "life_science";
type ProjectStatus =
  | "approved"
  | "pipeline"
  | "underwriting"
  | "active"
  | "completed"
  | "cancelled";
type DealType = "development" | "acquisition";

export type DemoProjectMeta = {
  name: string;
  location: string;
  type: ProjectType;
  status: ProjectStatus;
  deal_type?: DealType;
};

export type DemoPackage = {
  slug: string;
  label: string;
  blurb: string;
  mode: DemoSeedMode;
  /** Storage-path segment under the user's namespace. */
  storagePrefix: string;
  /** Project row metadata. Omitted for preseeded packages with bespoke seeders. */
  project?: DemoProjectMeta;
  /** Bundled source documents. Empty for packages that render docs elsewhere. */
  files: DemoFixtureFile[];
};

// Map a fixture filename to a documents.category value (mirrors the categorizer
// in the legacy seed scripts and the CATEGORIES list in documents.tsx).
export function categoryForFixture(name: string): string {
  if (/budget/i.test(name)) return "Budget";
  if (/rent_roll/i.test(name)) return "Financial Model";
  if (/appraisal|valuation/i.test(name)) return "Appraisal";
  if (/market/i.test(name)) return "Market Study";
  if (/term_sheet|rate_lock|lender/i.test(name)) return "Loan Package";
  if (/lease|legal/i.test(name)) return "Legal";
  return "Other";
}

export const DEMO_PACKAGES: DemoPackage[] = [
  {
    slug: "harbour-centre",
    label: "Harbour Centre",
    blurb:
      "Pre-seeded mixed-use deal with a verified extraction register, a documented exit-cap conflict, and genuinely-missing inputs. Ready to review immediately.",
    mode: "preseeded",
    storagePrefix: "demo/harbour-centre",
    files: [],
  },
  {
    slug: "rivergate",
    label: "Rivergate",
    blurb:
      "Mixed-use development in the Rivergate Innovation District. Ships 8 source documents - run extraction to populate assumptions end-to-end.",
    mode: "workflow",
    storagePrefix: "demo/rivergate",
    project: {
      name: "Rivergate",
      location: "Rivergate Innovation District",
      type: "mixed_use",
      status: "underwriting",
      deal_type: "development",
    },
    files: RIVERGATE_FIXTURE_FILES,
  },
  {
    slug: "summit-point",
    label: "Summit Point Logistics Park",
    blurb:
      "Industrial logistics deal (Option B - hidden-risk profile) with tenant concentration and three documented conflicts. Ships 10 source documents to run extraction against.",
    mode: "workflow",
    storagePrefix: "demo/summit-point",
    project: {
      name: "Summit Point Logistics Park",
      location: "I-85 logistics corridor, Charlotte, North Carolina",
      type: "industrial",
      status: "pipeline",
      deal_type: "development",
    },
    files: SUMMIT_POINT_FIXTURE_FILES,
  },
];

export const DEMO_PACKAGE_BY_SLUG: Record<string, DemoPackage> = Object.fromEntries(
  DEMO_PACKAGES.map((p) => [p.slug, p]),
);
