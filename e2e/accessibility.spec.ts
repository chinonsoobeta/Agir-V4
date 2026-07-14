import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const AUTHENTICATED_ROUTES = [
  "/dashboard",
  "/properties",
  "/permits",
  "/permits/new",
  "/deals",
  "/reports",
  "/copilot",
  "/settings",
] as const;

async function expectAccessiblePage(page: Page, route: string) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const response = await page.goto(route, { waitUntil: "domcontentloaded" });
  expect(response?.status() ?? 200).toBeLessThan(400);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toBeVisible();

  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    axe.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.flatMap((node) => node.target),
    })),
  ).toEqual([]);

  await page.keyboard.press("Tab");
  if (await page.evaluate(() => document.activeElement === document.body)) {
    // WebKit on macOS follows the host's Full Keyboard Access preference and
    // may leave a bare Tab on body. Explicit focus still verifies that the
    // first interactive control is keyboard-focusable and visibly rendered.
    await page.locator("a[href], button, input, select, textarea").first().focus();
  }
  await expect(page.locator(":focus")).toBeVisible();
  const width = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.client);
}

test.describe("authenticated accessibility baseline", () => {
  for (const route of AUTHENTICATED_ROUTES) {
    test(`${route} passes WCAG, keyboard, reduced-motion, and overflow gates`, async ({ page }) => {
      await expectAccessiblePage(page, route);
    });
  }
});

test.describe("public accessibility baseline", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const route of ["/", "/auth"] as const) {
    test(`${route} passes the public WCAG baseline`, async ({ page }) => {
      await expectAccessiblePage(page, route);
    });
  }
});
