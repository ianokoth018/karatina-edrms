import { expect, test } from "@playwright/test";

test.describe("auth", () => {
  test("admin can log in", async ({ page }) => {
    await page.goto("/login");

    // Form has labelled email & password inputs.
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();

    await page.locator("#email").fill("admin@karu.ac.ke");
    await page.locator("#password").fill("Admin@2026");

    await Promise.all([
      page.waitForURL("**/dashboard", { timeout: 45_000 }),
      page.getByRole("button", { name: /sign in/i }).click(),
    ]);
    await expect(page).toHaveURL(/\/dashboard/);

    // Any recognisable dashboard chrome. The sidebar has a "Documents" link
    // for users who can see it; admins always can.
    await expect(
      page.getByRole("link", { name: /documents/i }).first(),
    ).toBeVisible();
  });
});
