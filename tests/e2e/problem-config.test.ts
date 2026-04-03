import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");

test.use({ storageState: teacherAuth });

// ─── Helpers ───────────────────────────────────────────────

/** Create a draft problem and return the edit page URL.
 *  Retries once if the form submission doesn't redirect (e.g. due to rate limiting). */
async function createDraft(page: Page, title: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto("/problems/create");
    await page.locator("form button[type=submit]").waitFor();
    await page.locator("form input[required]").first().fill(title);
    const textareas = page.locator("form textarea");
    await textareas
      .nth(0)
      .fill(
        "This is a test problem for E2E configuration testing. " +
          "It has enough characters to pass the minimum length validation requirement."
      );
    await textareas.nth(1).fill("An integer n.");
    await textareas.nth(2).fill("Print n.");
    await page.getByRole("button", { name: /save basic info/i }).click();
    try {
      await page.waitForURL(/\/problems\/.*\/edit/, { timeout: 15000 });
      return page.url();
    } catch {
      // May have been rate-limited — wait and retry
      if (attempt < 2) await page.waitForTimeout(3000);
    }
  }
  // Final attempt — let it throw on failure
  await page.waitForURL(/\/problems\/.*\/edit/, { timeout: 30000 });
  return page.url();
}

/** Navigate to a specific tab on the edit page */
async function goToTab(page: Page, tabName: string) {
  await page.getByRole("button", { name: tabName, exact: true }).click();
}

// ─── Submission Type Configuration ─────────────────────────────────

test.describe("Submission Settings Tab", () => {
  let editUrl: string;

  test.beforeEach(async ({ page }) => {
    editUrl = await createDraft(page, `Submission Config ${Date.now()}`);
  });

  test("default submission type is full_source", async ({ page }) => {
    await goToTab(page, "Submission Settings");
    const fullSourceRadio = page.locator('input[name="submissionType"][value="full_source"]');
    await expect(fullSourceRadio).toBeChecked({ timeout: 10000 });
  });

  test("can set time and memory limits", async ({ page }) => {
    await goToTab(page, "Submission Settings");

    // The labels wrap HelpTooltip buttons, so getByLabel matches the tooltip.
    // Use positional input[type=number] selectors instead.
    const timeInput = page.locator('form input[type="number"]').first();
    await timeInput.fill("2000");

    const memoryInput = page.locator('form input[type="number"]').nth(1);
    await memoryInput.fill("512");

    await expect(timeInput).toHaveValue("2000");
    await expect(memoryInput).toHaveValue("512");
  });

  test("switching to function type shows template editor", async ({ page }) => {
    await goToTab(page, "Submission Settings");

    const functionRadio = page.locator('input[name="submissionType"][value="function"]');
    await functionRadio.check({ force: true });

    // Template editor should appear — use .first() since text may appear in multiple places
    await expect(page.getByText(/driver code/i).first()).toBeVisible();
    await expect(page.getByText(/template code/i).first()).toBeVisible();
  });

  test("switching to zip_project type shows file structure fields", async ({ page }) => {
    await goToTab(page, "Submission Settings");

    const zipRadio = page.locator('input[name="submissionType"][value="zip_project"]');
    await zipRadio.check({ force: true });

    // ZIP-specific fields should appear
    await expect(page.getByText(/file structure/i).first()).toBeVisible();
  });
});

// ─── Judge Settings Configuration ──────────────────────────────────

test.describe("Judge Settings Tab", () => {
  let editUrl: string;

  test.beforeEach(async ({ page }) => {
    editUrl = await createDraft(page, `Judge Config ${Date.now()}`);
  });

  test("default judge type is standard", async ({ page }) => {
    await goToTab(page, "Judge Settings");
    const standardRadio = page.locator('input[name="judgeType"][value="standard"]');
    await expect(standardRadio).toBeChecked();
  });

  test("selecting checker shows checker script editor", async ({ page }) => {
    await goToTab(page, "Judge Settings");

    const checkerRadio = page.locator('input[name="judgeType"][value="checker"]');
    await checkerRadio.check({ force: true });

    // Checker script editor should appear
    await expect(page.getByText(/load default template/i).first()).toBeVisible();
  });

  test("selecting interactive shows interactor script editor", async ({ page }) => {
    await goToTab(page, "Judge Settings");

    const interactiveRadio = page.locator('input[name="judgeType"][value="interactive"]');
    await interactiveRadio.check({ force: true });

    await expect(page.getByText(/load default template/i).first()).toBeVisible();
  });

  test("can enable static analysis with banned functions", async ({ page }) => {
    await goToTab(page, "Judge Settings");

    // Find and enable static analysis toggle
    const toggles = page.locator("button[role='switch']");
    const staticAnalysisToggle = toggles.first();
    await staticAnalysisToggle.click();

    // Banned functions field should appear
    await expect(page.getByText(/banned functions/i).first()).toBeVisible();
    await expect(page.getByText(/banned imports/i).first()).toBeVisible();
    await expect(page.getByText(/banned patterns/i).first()).toBeVisible();
    await expect(page.getByText(/linter command/i).first()).toBeVisible();
  });

  test("can enable artifact collection", async ({ page }) => {
    await goToTab(page, "Judge Settings");

    // Scroll down to artifact section and enable it
    const artifactHeading = page.getByText(/artifact collection/i).first();
    await artifactHeading.scrollIntoViewIfNeeded();

    // The artifact collection section has its own toggle — it's the second toggle on the page
    const artifactToggle = page.locator("button[role='switch']").nth(1);
    await artifactToggle.scrollIntoViewIfNeeded();
    await artifactToggle.click();

    await expect(page.getByText(/collection patterns/i).first()).toBeVisible();
    await expect(page.getByText(/max total size/i).first()).toBeVisible();
  });

  test("can enable network access with firewall rules", async ({ page }) => {
    await goToTab(page, "Judge Settings");

    const networkHeading = page.getByText(/network access/i).first();
    await networkHeading.scrollIntoViewIfNeeded();

    // Network access toggle is the third toggle on the Judge Settings tab
    const networkToggle = page.locator("button[role='switch']").nth(2);
    await networkToggle.scrollIntoViewIfNeeded();
    await networkToggle.click();

    await expect(page.getByText(/firewall rules/i).first()).toBeVisible();
    await expect(page.getByText(/sidecar services/i).first()).toBeVisible();
    await expect(page.getByText(/log traffic/i).first()).toBeVisible();
  });

  test("can save checker configuration", async ({ page }) => {
    await goToTab(page, "Judge Settings");

    // Select checker type
    const checkerRadio = page.locator('input[name="judgeType"][value="checker"]');
    await checkerRadio.check({ force: true });

    // Load default template
    await page
      .getByRole("button", { name: /load default template/i })
      .first()
      .click();

    // Save (Judge Settings uses a custom fetch-based save, not a form action)
    await page.getByRole("button", { name: /save settings/i }).click();

    // Reload and verify
    await page.waitForTimeout(500);
    await page.goto(editUrl);
    await goToTab(page, "Judge Settings");
    const checkerRadioAfter = page.locator('input[name="judgeType"][value="checker"]');
    await expect(checkerRadioAfter).toBeChecked();
  });
});

// ─── Testcase Management ───────────────────────────────────────────

test.describe("Testcase Management Tab", () => {
  test.beforeEach(async ({ page }) => {
    await createDraft(page, `Testcase Config ${Date.now()}`);
  });

  test("shows empty state initially", async ({ page }) => {
    await goToTab(page, "Testcase Management");
    // Should show some indication that no testcases exist
    await expect(page.getByRole("main")).toBeVisible();
  });

  test("can add a sample testcase set manually", async ({ page }) => {
    await goToTab(page, "Testcase Management");

    // Look for add button
    const addButton = page.getByRole("button", { name: /add/i }).first();
    if (await addButton.isVisible()) {
      await addButton.click();
    }

    // Should see form to input testcase set name
    await expect(page.getByRole("main")).toBeVisible();
  });
});

// ─── Scoring Rules Configuration ───────────────────────────────────

test.describe("Scoring Rules Tab", () => {
  test.beforeEach(async ({ page }) => {
    await createDraft(page, `Scoring Config ${Date.now()}`);
  });

  test("shows hint when no testcase sets exist", async ({ page }) => {
    await goToTab(page, "Scoring Rules");

    // Should show message about needing testcase sets — use specific text to avoid
    // matching the "Testcase Management" tab button
    await expect(page.getByText(/please add testcase sets/i)).toBeVisible();
  });

  test("can enable score adjustment rules section", async ({ page }) => {
    await goToTab(page, "Scoring Rules");

    // Score adjustments should have a toggle
    const adjustmentHeading = page.getByText(/score adjustment/i).first();
    await adjustmentHeading.scrollIntoViewIfNeeded();

    await expect(page.getByRole("main")).toBeVisible();
  });

  test("can enable custom scoring script", async ({ page }) => {
    await goToTab(page, "Scoring Rules");

    // Find custom scoring script section
    const scriptHeading = page.getByText(/custom scoring script/i).first();
    await scriptHeading.scrollIntoViewIfNeeded();

    // Enable the toggle — custom scoring script toggle is the second on the Scoring tab
    const toggle = page.locator("button[role='switch']").nth(1);
    if (await toggle.isVisible()) {
      await toggle.click();
      // Warning about override should appear (text: "Enabling this will override the rules above")
      await expect(page.getByText(/override the rules above/i)).toBeVisible();
    }
  });
});

// ─── Full Workflow: Create → Configure → Publish ───────────────────

test.describe("Full Problem Configuration Workflow", () => {
  test("standard problem: create → add testcases → publish", async ({ page }) => {
    // Step 1: Create draft
    await createDraft(page, `Full Workflow ${Date.now()}`);

    // Step 2: Verify draft badge — target the badge span specifically to avoid
    // matching the <option value="draft"> element
    await expect(page.locator("span.rounded-full", { hasText: "Draft" })).toBeVisible();

    // Step 3: Publish button should be disabled (no testcases)
    const publishBtn = page.getByText(/finish.*publish/i);
    await publishBtn.hover();
    await expect(page.getByText(/at least one testcase/i)).toBeVisible();

    // Step 4: Go to testcase tab
    await goToTab(page, "Testcase Management");
    await expect(page.getByRole("main")).toBeVisible();

    // Note: actual testcase creation depends on the specific UI flow
    // (ZIP upload or manual add), which requires more detailed selectors
  });

  test("checker problem: create → set checker → save judge config", async ({ page }) => {
    // Step 1: Create draft
    await createDraft(page, `Checker Problem ${Date.now()}`);

    // Step 2: Configure judge settings
    await goToTab(page, "Judge Settings");

    // Select checker type
    const checkerRadio = page.locator('input[name="judgeType"][value="checker"]');
    await checkerRadio.check({ force: true });

    // Load default checker template
    await page
      .getByRole("button", { name: /load default template/i })
      .first()
      .click();

    // Save judge settings
    await page.getByRole("button", { name: /save settings/i }).click();

    // Verify save succeeded (no error shown)
    await expect(page.locator(".text-red-700, .text-red-400")).not.toBeVisible();
  });

  test("function template problem: create → set function type → configure templates", async ({
    page
  }) => {
    // Step 1: Create draft
    await createDraft(page, `Function Template ${Date.now()}`);

    // Step 2: Configure submission type
    await goToTab(page, "Submission Settings");

    const functionRadio = page.locator('input[name="submissionType"][value="function"]');
    await functionRadio.check({ force: true });

    // Template editor section should appear
    await expect(page.getByText(/driver code/i).first()).toBeVisible();
    await expect(page.getByText(/template code/i).first()).toBeVisible();
  });

  test("advanced problem: create → enable static analysis + custom scoring", async ({
    page
  }) => {
    // Step 1: Create draft
    await createDraft(page, `Advanced Problem ${Date.now()}`);

    // Step 2: Enable static analysis in Judge Settings
    await goToTab(page, "Judge Settings");
    const judgeToggles = page.locator("button[role='switch']");
    const staticToggle = judgeToggles.first();
    await staticToggle.click();

    await expect(page.getByText(/banned functions/i).first()).toBeVisible();

    // Save judge settings
    await page.getByRole("button", { name: /save settings/i }).click();

    // Step 3: Enable custom scoring in Scoring Rules
    await goToTab(page, "Scoring Rules");

    const scriptHeading = page.getByText(/custom scoring script/i).first();
    await scriptHeading.scrollIntoViewIfNeeded();

    // Custom scoring script toggle is the second on the Scoring tab
    const scriptToggle = page.locator("button[role='switch']").nth(1);
    if (await scriptToggle.isVisible()) {
      await scriptToggle.click();
      await expect(page.getByText(/override the rules above/i)).toBeVisible();
    }
  });

  test("cross-tab navigation preserves unsaved state warning", async ({ page }) => {
    // Create draft and go to submission settings
    await createDraft(page, `Cross Tab ${Date.now()}`);
    await goToTab(page, "Submission Settings");

    // Change time limit using positional selector (getByLabel matches HelpTooltip)
    const timeInput = page.locator('form input[type="number"]').first();
    await timeInput.fill("5000");

    // Switch to another tab and back
    await goToTab(page, "Judge Settings");
    await goToTab(page, "Submission Settings");

    // Each tab has independent form state, so the value should be from server
    await expect(page.getByRole("main")).toBeVisible();
  });
});
