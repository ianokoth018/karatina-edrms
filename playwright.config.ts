import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the EDRMS app.
 *
 * - Tests live in `./e2e`.
 * - Auth state is not shareable (the admin's session can affect data), so we
 *   run serially (`fullyParallel: false`).
 * - The dev server is started automatically via `webServer` and reused if a
 *   server is already listening on port 3000.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev:next",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
