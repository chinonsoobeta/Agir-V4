import { expect, type Page } from "@playwright/test";

// Open the demo-package picker on /deals and seed the named package from its
// card, then follow the success toast into the new project. Shared by every
// package spec so the selectors stay consistent as the picker evolves.
export async function seedPackageAndOpen(page: Page, packageName: string) {
  await page.goto("/deals");

  // Open the picker dialog. Retry the trigger click until the dialog actually
  // opens, which absorbs SSR-hydration timing (the click handler may not be
  // attached the instant the route renders).
  const trigger = page.getByRole("button", { name: /seed demo deal/i });
  await expect(trigger).toBeVisible();
  await expect(async () => {
    await trigger.click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });

  // Package cards are non-nested bordered rows, so class + text is an
  // unambiguous scope even though every seedable card has a "Seed package"
  // button. (Scoping by `has: heading` would also match the dialog wrapper
  // and click the FIRST card's button.)
  const card = page.getByRole("dialog").locator("div.rounded-lg.border", { hasText: packageName });
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: /seed package/i }).click();

  // Seeding surfaces a success toast whose action opens the new project. The
  // toast animates and auto-dismisses, so Playwright's stability check can
  // never settle on it - dispatch the click directly once it is visible.
  const openDemo = page.getByRole("button", { name: /open demo/i });
  await expect(openDemo).toBeVisible({ timeout: 60_000 });
  await openDemo.dispatchEvent("click");
  await page.waitForURL("**/projects/**", { timeout: 60_000 });
}
