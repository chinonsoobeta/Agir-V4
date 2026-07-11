import { expect, test } from "@playwright/test";

test("guided standalone permit case preserves uncertainty and product mode", async ({ page }) => {
  await page.goto("/dashboard");
  const permitsMode = page.getByRole("radio", { name: "permits", exact: true }).first();
  await permitsMode.focus();
  await page.keyboard.press("Space");
  await expect(page).toHaveURL(/\/permits$/);
  await expect(page.getByText("Permits mode active").first()).toBeAttached();
  await page.reload();
  await expect(page.getByRole("radio", { name: "permits", exact: true }).first()).toBeChecked();

  await page
    .getByRole("link", { name: /start a permit project/i })
    .first()
    .click();
  await page.getByLabel(/case name/i).fill("Backyard dwelling review");
  await page.getByLabel(/property address/i).fill("Incomplete Vancouver address");
  await page.getByRole("textbox", { name: "Municipality", exact: true }).fill("City of Vancouver");
  await page.getByRole("button", { name: /continue/i }).click();
  await page.getByLabel(/type of work/i).click();
  await page.getByRole("option", { name: /accessory secondary dwelling/i }).click();
  await page.getByLabel("Structural work").click();
  await page.getByRole("button", { name: /continue/i }).click();
  await page.getByLabel(/brief project description/i).fill("Homeowner-provided concept only.");
  await page.getByRole("button", { name: /continue/i }).click();
  await expect(page.getByText("Unknown: no verified analysis")).toBeVisible();
  await page.getByRole("button", { name: /create permit case/i }).click();
  await expect(page).toHaveURL(/\/permits\/[0-9a-f-]+$/);
  await expect(page.getByText("Municipality", { exact: true })).toBeVisible();
  await expect(page.getByText("Unconfirmed", { exact: true })).toBeVisible();
  await expect(page.getByText(/zoning change analysis not yet available/i)).toBeVisible();
  await page.getByRole("tab", { name: "Permits", exact: true }).click();
  await expect(page.getByRole("button", { name: /generate review candidates/i })).toBeDisabled();
  await expect(page.getByText(/investment score|debt service|equity multiple/i)).toHaveCount(0);
  await page.getByRole("radio", { name: "Professional" }).click();
  await expect(page.getByRole("radio", { name: "Professional" })).toBeChecked();
  await page.reload();
  await expect(page.getByRole("radio", { name: "Professional" })).toBeChecked();
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
});
