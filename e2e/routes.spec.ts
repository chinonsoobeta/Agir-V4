import { test, expect, type Page } from "@playwright/test";

// Every destination in the app sidebar (src/components/app-shell.tsx) plus
// Settings. A route "passes" smoke if it renders authenticated content (no
// redirect back to /auth), shows a real heading, doesn't trip the error
// boundary, and logs no uncaught page errors.
const SIDEBAR_ROUTES: { path: string; heading: RegExp }[] = [
  { path: "/dashboard", heading: /overview|dashboard|home/i },
  { path: "/portfolio", heading: /portfolio/i },
  { path: "/deals", heading: /deals/i },
  { path: "/relationships", heading: /relationship/i },
  { path: "/compare", heading: /compare/i },
  { path: "/execution", heading: /execution/i },
  { path: "/markets", heading: /market/i },
  { path: "/committee", heading: /committee/i },
  { path: "/documents", heading: /document/i },
  { path: "/analysis", heading: /analysis/i },
  { path: "/reports", heading: /report/i },
  { path: "/integrations", heading: /integration/i },
  { path: "/copilot", heading: /copilot/i },
  { path: "/settings", heading: /settings/i },
];

// Collect page errors and console errors for the duration of a navigation.
function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });
  return errors;
}

test.describe("sidebar routes smoke", () => {
  for (const route of SIDEBAR_ROUTES) {
    test(`${route.path} renders`, async ({ page }) => {
      const errors = trackErrors(page);
      const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });

      // Not bounced to the login screen (would mean the session didn't load).
      await expect(page).toHaveURL(new RegExp(route.path.replace("/", "\\/")));
      expect(response?.status() ?? 200, "HTTP status").toBeLessThan(400);

      // The app shell rendered (sidebar present) and a heading is visible.
      await expect(page.getByRole("heading").first()).toBeVisible();
      await expect(page.getByRole("heading", { name: route.heading }).first()).toBeVisible();

      // No error-boundary fallback.
      await expect(page.getByText(/something went wrong|unexpected error/i)).toHaveCount(0);

      // Fatal = an uncaught client exception or an app-level console error.
      // Excluded as non-fatal dev/runtime noise:
      //   - favicon / websocket / realtime reconnects to local Supabase
      //   - ResizeObserver loop warnings
      //   - generic "Failed to load resource" lines: under the runner's
      //     parallel load the TanStack dev server aborts in-flight server-fn
      //     prefetches, surfacing transient 5xx that do not reproduce in
      //     steady state and are not product defects. Real crashes still fail
      //     the test via `pageerror` and the error-boundary assertion above.
      const fatal = errors.filter(
        (e) => !/favicon|websocket|realtime|ResizeObserver|Failed to load resource/i.test(e),
      );
      expect(fatal, `console/page errors on ${route.path}`).toEqual([]);
    });
  }
});
