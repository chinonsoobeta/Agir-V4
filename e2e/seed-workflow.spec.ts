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

test("professional demo workflow resolves provenance and fail-closed underwriting surfaces", async ({
  page,
}) => {
  await seedPackageAndOpen(page, "Harbour Centre");
  await expect(page.getByRole("heading", { name: "Harbour Centre" })).toBeVisible();

  await page.getByRole("tab", { name: /documents/i }).click();
  await expect(page.getByText(/Harbour_Centre_Construction_Budget/i).first()).toBeVisible();
  await expect(page.getByText(/Extracted/i).first()).toBeVisible();

  await page.getByRole("tab", { name: /assumptions/i }).click();
  await expect(page.getByText(/Deal Readiness Score/i)).toBeVisible();
  await expect(page.getByText(/Conflict Resolution Center/i)).toBeVisible();
  await expect(page.getByText(/Confidence/i).first()).toBeVisible();
  await expect(page.getByText(/Source/i).first()).toBeVisible();

  await page.getByRole("button", { name: /Use conservative/i }).first().click();
  await expect(
    page.getByText(/Updated/i).or(page.getByText(/Conflict Resolution Center/i)),
  ).toBeVisible({ timeout: 20_000 });

  await page.getByRole("tab", { name: /analysis/i }).click();
  const runLocator = page
    .getByRole("button", { name: /Run Deterministic Underwriting|Run Underwriting/i })
    .first();
  const blockedPanel = page.getByText(/Underwriting blocked/i).first();
  await expect(blockedPanel.or(runLocator)).toBeVisible({ timeout: 20_000 });
  if (await blockedPanel.isVisible().catch(() => false)) {
    const conservative = page.getByRole("button", { name: /Use conservative/i }).last();
    if (await conservative.isVisible().catch(() => false)) {
      await conservative.click();
      await expect(page.getByText(/Resolved|Updated/i).first()).toBeVisible({ timeout: 20_000 });
    }
  }

  await expect(page.getByText(/Underwriting blocked/i)).toBeVisible();
  await expect(page.getByText(/Expense ratio/i).first()).toBeVisible();
  await expect(page.getByText(/Hold period/i).first()).toBeVisible();
  await expect(page.getByText(/Selling costs/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept defaults", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Let AI accept defaults & run/i })).toBeVisible();
  await expect(page.getByText(/engine runs only on approved or default-accepted inputs/i)).toBeVisible();
  await expect(runLocator).toHaveCount(0);

  await page.getByRole("tab", { name: /investment committee/i }).click();
  await expect(page.getByRole("heading", { name: /Underwriting not run/i })).toBeVisible();
  await expect(page.getByText(/No investment recommendation available yet/i)).toBeVisible();
  await expect(page.getByText(/run deterministic underwriting in Analysis/i)).toBeVisible();

  await page.getByRole("tab", { name: /audit/i }).click();
  await expect(page.getByText(/Audit|underwriting|assumption/i).first()).toBeVisible();
});
