import { test, expect } from "@playwright/test";
import { seedPackageAndOpen } from "./seed-helpers";

// The workflow-mode demo packages: seeding creates the project and links the
// bundled SOURCE documents only — the analyst runs extraction in-app, so the
// assertions here are project identity + documents present, not assumptions.
test("seed Rivergate and land in a project with its source documents", async ({ page }) => {
  await seedPackageAndOpen(page, "Rivergate");
  await expect(page.getByRole("heading", { name: /rivergate/i }).first()).toBeVisible();

  await page.getByRole("tab", { name: /documents/i }).click();
  await expect(page.getByText(/Rivergate.Rent.Roll/i).first()).toBeVisible();
  await expect(page.getByText(/Rivergate.Lender.Term.Sheet/i).first()).toBeVisible();
});

test("seed Summit Point and land in a project with its source documents", async ({ page }) => {
  await seedPackageAndOpen(page, "Summit Point");
  await expect(page.getByRole("heading", { name: /summit point/i }).first()).toBeVisible();

  await page.getByRole("tab", { name: /documents/i }).click();
  await expect(page.getByText(/Summit.Point.Tenant.Lease.Abstracts/i).first()).toBeVisible();
  await expect(page.getByText(/Summit.Point.Rent.Roll/i).first()).toBeVisible();
});
