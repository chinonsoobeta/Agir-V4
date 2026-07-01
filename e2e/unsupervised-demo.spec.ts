import { test, expect } from "@playwright/test";

test("demo user sees the unsupervised demo guide and package picker", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(
    page.getByRole("heading", { name: /run the same pilot path every time/i }),
  ).toBeVisible();
  await expect(page.getByText(/Unsupervised demo guide/i)).toBeVisible();
  await expect(page.getByText(/decision-support for evaluation/i)).toBeVisible();

  await page
    .getByRole("button", { name: /seed demo deal/i })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: /demo packages/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Harbour Centre", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/Resolve exit-cap conflict/i)).toBeVisible();
  await expect(dialog.getByRole("button", { name: /seed package/i })).toBeVisible();
});
