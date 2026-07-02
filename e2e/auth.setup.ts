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

  // Wait for React hydration before touching the form. Filled values "holding"
  // does not prove hydration (pre-hydration DOM keeps them too), and clicking
  // the submit button before handlers attach fires a NATIVE form submit that
  // reloads /auth? and dumps the session. The password-visibility toggle is a
  // reliable probe: it is type="button" (inert pre-hydration) and only flips
  // the input type once React's onClick is wired.
  const toggle = page.getByRole("button", { name: "Show password" });
  await expect(async () => {
    await toggle.click();
    await expect(page.locator('input[type="text"][autocomplete="current-password"]')).toBeVisible({
      timeout: 1_000,
    });
  }).toPass({ timeout: 30_000 });
  await page.getByRole("button", { name: "Hide password" }).click();

  // Hydrated now: controlled inputs keep their values and submit runs the JS
  // handler. The retry loop stays as belt-and-braces against re-render races.
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
