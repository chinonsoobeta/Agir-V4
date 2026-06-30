import { test as setup, expect } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL ?? "maple.heights@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";
const AUTH_FILE = "e2e/.auth/user.json";

// Sign in once through the real UI and persist the Supabase session (stored in
// localStorage) so every other spec starts authenticated without re-logging in.
setup("authenticate", async ({ page }) => {
  await page.goto("/auth");
  const email = page.locator('input[type="email"]');
  const password = page.locator('input[type="password"]');
  await expect(email).toBeVisible();

  // Fill in a retry loop and assert the controlled inputs actually hold the
  // values before submitting. This absorbs the SSR-hydration race where an
  // early fill is discarded when React re-renders the controlled inputs.
  await expect(async () => {
    await email.fill(EMAIL);
    await password.fill(PASSWORD);
    await expect(email).toHaveValue(EMAIL);
    await expect(password).toHaveValue(PASSWORD);
  }).toPass({ timeout: 15_000 });

  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  // Successful login lands on the dashboard.
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
  await expect(page).toHaveTitle(/Overview|Dashboard/);

  await page.context().storageState({ path: AUTH_FILE });
});
