import { defineConfig, devices } from "@playwright/test";

// Browser/E2E coverage. Requires a running app (vite dev on port 8081 by
// default) backed by a local Supabase stack with the demo user seeded
// (scripts/ensure-demo-user.mjs). Point at any environment via E2E_BASE_URL.
//
//   npm run test:e2e            run all specs headless
//   npm run test:e2e -- --ui    interactive runner
//
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8081";
const WORKERS = process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 1;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.artifacts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: WORKERS,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],
  // Reuse an already-running dev server (the common local case); otherwise boot
  // one. Locally the launch script pins Node 22 via nvm (the Supabase realtime
  // client requires it); in CI Node 22 is already the runtime, so run dev
  // directly. Override with E2E_WEB_SERVER_CMD if needed.
  webServer: {
    command:
      process.env.E2E_WEB_SERVER_CMD ??
      (process.env.CI ? "npm run dev" : "bash .claude/dev-node22.sh"),
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
