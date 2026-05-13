import { expect, type Page } from "@playwright/test";

/**
 * Log the admin user in via the credentials form on /login.
 *
 * The login page submits via `signIn("credentials", ..., { redirect: false })`
 * and then sets `window.location.href = "/dashboard"`, so we just wait for the
 * URL to settle on /dashboard. We do NOT assume any particular dashboard
 * content (different roles render different widgets).
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/login");

  // The inputs have id="email" / id="password" with their own labels.
  await page.locator("#email").fill("admin@karu.ac.ke");
  await page.locator("#password").fill("Admin@2026");

  await Promise.all([
    page.waitForURL("**/dashboard", { timeout: 45_000 }),
    page.getByRole("button", { name: /sign in/i }).click(),
  ]);
  await expect(page).toHaveURL(/\/dashboard/);
}
