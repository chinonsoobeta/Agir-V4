import { expect, test } from "@playwright/test";

for (const route of ["/permits", "/permits/new"]) {
  test(`${route} has labelled controls, one primary heading, keyboard focus, and no horizontal overflow`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(route);
    await expect(page.locator("h1")).toHaveCount(1);
    const unnamed = await page.locator("button, a[href], input, select, textarea").evaluateAll(
      (elements) =>
        elements.filter((element) => {
          const html = element as HTMLElement;
          if (html.getAttribute("aria-hidden") === "true" || html.hasAttribute("disabled"))
            return false;
          const labelled =
            html.getAttribute("aria-label") ||
            html.getAttribute("aria-labelledby") ||
            html.textContent?.trim() ||
            (html instanceof HTMLInputElement && html.labels?.length);
          return !labelled;
        }).length,
    );
    expect(unnamed).toBe(0);
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
    const width = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(width.scroll).toBeLessThanOrEqual(width.client);
  });
}
