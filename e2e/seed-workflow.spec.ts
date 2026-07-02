import { test, expect } from "@playwright/test";

// The critical underwriting workflow, end to end through the UI: seed a demo
// deal, then confirm the analyst-facing surfaces it produces — source
// documents and the assumption review register (including the documented
// exit-cap conflict the engine must never resolve silently).
test("seed Harbour Centre demo and review its underwriting surfaces", async ({ page }) => {
  await page.goto("/deals");

  // Open the demo-package picker dialog. Retry the trigger click until the
  // dialog actually opens, which absorbs SSR-hydration timing (the click
  // handler may not be attached the instant the route renders).
  const trigger = page.getByRole("button", { name: /seed demo deal/i });
  await expect(trigger).toBeVisible();
  await expect(async () => {
    await trigger.click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });

  // Seed the Harbour Centre package from its card.
  await page
    .getByRole("dialog")
    .locator("div", { has: page.getByRole("heading", { name: "Harbour Centre", exact: false }) })
    .getByRole("button", { name: /seed package/i })
    .first()
    .click();

  // Seeding surfaces a success toast whose action opens the new project. The
  // toast animates and auto-dismisses, so Playwright's stability check can
  // never settle on it - dispatch the click directly once it is visible.
  const openDemo = page.getByRole("button", { name: /open demo/i });
  await expect(openDemo).toBeVisible({ timeout: 60_000 });
  await openDemo.dispatchEvent("click");
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
