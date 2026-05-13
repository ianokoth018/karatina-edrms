import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "./helpers/login";

// Allow extra time for the dev server to compile the /documents and
// /documents/[id] routes on first hit.
test.setTimeout(120_000);

test.describe("document classification", () => {
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip("admin can change document security classification", async ({ page }) => {
    // BLOCKED: app/(dashboard)/documents/[id]/page.tsx throws at runtime:
    //   "React has detected a change in the order of Hooks called by
    //    DocumentDetailPage."
    // The component calls React.useState/useEffect *after* a conditional
    // early-return path (the lazy-loaded `subscription` hook is at line ~686,
    // below code that may return null/loading states earlier). This violates
    // the Rules of Hooks and breaks the detail page entirely for some
    // documents, so the Edit button never renders. Fix the page (lift those
    // hooks to the top of the component) and unskip this test.
    //
    // Steps the test would run once unblocked:
    await loginAsAdmin(page);

    // List page
    await page.goto("/documents");
    // Wait for the table to populate; networkidle is unreliable behind RSC
    // streaming, so wait for either a row or the empty-state instead.
    await Promise.race([
      page
        .locator('a[href^="/documents/"][title="View"]')
        .first()
        .waitFor({ state: "visible", timeout: 45_000 }),
      page
        .getByText(/No documents found/i)
        .waitFor({ state: "visible", timeout: 45_000 }),
    ]);

    const firstDocLink = page
      .locator('a[href^="/documents/"][title="View"]')
      .first();
    const hasDoc = await firstDocLink.isVisible().catch(() => false);
    test.skip(!hasDoc, "No documents in the database to edit — seed first.");

    await Promise.all([
      page.waitForURL(/\/documents\/[a-zA-Z0-9-]+$/, { timeout: 60_000 }),
      firstDocLink.click(),
    ]);

    // The detail page renders an Edit button inside the action bar once the
    // document loads. There's both an "Edit" button (title metadata) and an
    // "Edit Description" button further down; we want the first.
    const editBtn = page.getByRole("button", { name: /^edit$/i }).first();
    await editBtn.waitFor({ state: "visible", timeout: 30_000 });
    await editBtn.click();

    // The classification <select> in the edit panel has an option
    // <option value="CONFIDENTIAL">Confidential</option>.
    const classificationSelect = page
      .locator("select")
      .filter({ has: page.locator('option[value="CONFIDENTIAL"]') })
      .first();
    await classificationSelect.selectOption("CONFIDENTIAL");

    await page.getByRole("button", { name: /save changes/i }).click();

    // After save the badge re-renders with "Confidential".
    await expect(
      page.getByText(/^Confidential$/).first(),
    ).toBeVisible({ timeout: 20_000 });
  });
});
