import { describe, expect, it } from "vitest";
import { DEMO_PACKAGES, DEMO_PACKAGE_BY_SLUG, categoryForFixture } from "@/lib/demo/registry";

// File-type magic bytes, so we know the embedded base64 is the real binary and
// not corrupted by the generator (PDF = "%PDF", XLSX = PK zip header).
function sniff(base64: string): "pdf" | "zip" | "unknown" {
  const head = Buffer.from(base64.slice(0, 12), "base64");
  if (head.slice(0, 4).toString("latin1") === "%PDF") return "pdf";
  if (head[0] === 0x50 && head[1] === 0x4b) return "zip"; // xlsx is a zip
  return "unknown";
}

describe("demo package registry", () => {
  it("has unique slugs and a slug index that matches", () => {
    const slugs = DEMO_PACKAGES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const p of DEMO_PACKAGES) {
      expect(DEMO_PACKAGE_BY_SLUG[p.slug]).toBe(p);
    }
  });

  it("workflow packages ship project metadata and bundled documents", () => {
    const workflow = DEMO_PACKAGES.filter((p) => p.mode === "workflow");
    expect(workflow.length).toBeGreaterThanOrEqual(2);
    for (const p of workflow) {
      expect(p.project, `${p.slug} project meta`).toBeTruthy();
      expect(p.files.length, `${p.slug} files`).toBeGreaterThan(0);
    }
  });

  it("every bundled document decodes to a real PDF or XLSX binary", () => {
    for (const p of DEMO_PACKAGES) {
      for (const f of p.files) {
        const kind = sniff(f.base64);
        expect(["pdf", "zip"], `${p.slug}/${f.name} (${f.fileType})`).toContain(kind);
        if (f.fileType === "application/pdf") expect(kind).toBe("pdf");
      }
    }
  });

  it("categorizes fixtures into known document categories", () => {
    expect(categoryForFixture("Rivergate_Construction_Budget.xlsx")).toBe("Budget");
    expect(categoryForFixture("Summit_Point_Rent_Roll.xlsx")).toBe("Financial Model");
    expect(categoryForFixture("Rivergate_Appraisal_Valuation_Memo.pdf")).toBe("Appraisal");
    expect(categoryForFixture("Summit_Point_Market_Study.pdf")).toBe("Market Study");
    expect(categoryForFixture("Rivergate_Lender_Term_Sheet.pdf")).toBe("Loan Package");
    expect(categoryForFixture("Summit_Point_Tenant_Lease_Abstracts.pdf")).toBe("Legal");
    expect(categoryForFixture("Summit_Point_Sponsor_Investment_Summary.pdf")).toBe("Other");
  });
});
