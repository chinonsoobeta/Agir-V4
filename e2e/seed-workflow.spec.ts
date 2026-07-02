import { test, expect } from "@playwright/test";
import { seedPackageAndOpen } from "./seed-helpers";

// The critical underwriting workflow, end to end through the UI: seed a demo
// deal, then confirm the analyst-facing surfaces it produces — source
// documents and the assumption review register (including the documented
// exit-cap conflict the engine must never resolve silently).
test("seed Harbour Centre demo and review its underwriting surfaces", async ({ page }) => {
  await seedPackageAndOpen(page, "Harbour Centre");
  await expect(page.getByRole("heading", { name: "Harbour Centre" })).toBeVisible();

  // Documents tab: the six bundled source documents are linked.
  await page.getByRole("tab", { name: /documents/i }).click();
  await expect(page.getByText(/Harbour_Centre_Construction_Budget/i).first()).toBeVisible();
  await expect(page.getByText(/Harbour_Centre_Lender_Term_Sheet/i).first()).toBeVisible();

  // Assumptions tab: the review register is populated, and the exit-cap
  // conflict surfaces rather than being silently averaged.
  await page.getByRole("tab", { name: /assumptions/i }).click();
  await expect(page.getByText(/exit cap/i).first()).toBeVisible();
  await expect(page.getByText(/conflict/i).first()).toBeVisible();
});
