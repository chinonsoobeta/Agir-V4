import { test, expect } from "@playwright/test";

// The critical underwriting workflow, end to end through the UI: seed a demo
// deal, then confirm the analyst-facing surfaces it produces — source
// documents and the assumption review register (including the documented
// exit-cap conflict the engine must never resolve silently).
test("seed Harbour Centre demo and review its underwriting surfaces", async ({ page }) => {
  await page.goto("/deals");

  // Open the demo-package picker. Retry the trigger click until the menu
  // actually opens, which absorbs SSR-hydration timing (the click handler may
  // not be attached the instant the route renders).
  const trigger = page.getByRole("button", { name: /seed demo deal/i });
  await expect(trigger).toBeVisible();
  await expect(async () => {
    await trigger.click();
    await expect(page.getByRole("menu")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("menuitem").filter({ hasText: "Harbour Centre" }).click();

  // The seed creates the project and opens it.
  await page.waitForURL("**/projects/**", { timeout: 60_000 });
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
