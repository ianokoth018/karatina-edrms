import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "./helpers/login";

/**
 * Workflow designer smoke test.
 *
 * NOTE: The repository currently ships a SimulatorDialog component
 * (components/workflow/simulator-dialog.tsx) but the designer page does NOT
 * mount it — there is no "Test" button in the toolbar at the time of writing.
 * The closest toolbar action is "Validate", which runs the
 * workflow-validator and surfaces issues. We use that as the smoke check so
 * we still exercise the designer end-to-end without modifying production
 * code. When the simulator is wired up, swap this test for the full
 * "click Test, leave form data, run simulation, expect trace" flow described
 * in the task.
 */
test.describe("workflow designer", () => {
  test("designer loads and Validate runs without throwing", async ({ page }) => {
    await loginAsAdmin(page);

    await page.goto("/workflows/designer");

    // React Flow mounts the canvas inside .react-flow.
    await expect(page.locator(".react-flow").first()).toBeVisible({
      timeout: 30_000,
    });

    // The toolbar exposes a Validate button (title="Validate workflow").
    const validateBtn = page.locator('button[title="Validate workflow"]');
    await expect(validateBtn).toBeVisible();
    await validateBtn.click();

    // Validation surfaces a badge counter on the button when there are
    // issues, or just clears silently when the graph is empty. Either way
    // the click should not navigate away or crash the canvas.
    await expect(page.locator(".react-flow").first()).toBeVisible();
    await expect(page).toHaveURL(/\/workflows\/designer/);
  });

  // eslint-disable-next-line playwright/no-skipped-test
  test.skip("workflow simulator runs a basic graph", async () => {
    // BLOCKED: the SimulatorDialog component exists at
    // components/workflow/simulator-dialog.tsx but is not imported or
    // rendered by app/(dashboard)/workflows/designer/page.tsx. There is no
    // "Test" toolbar button yet, so this scenario can't be exercised from
    // the browser. Re-enable once the dialog is wired up.
  });
});
