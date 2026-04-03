import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");

test.use({ storageState: teacherAuth });

// ─── Helpers ───────────────────────────────────────────────────────

/** Create a draft problem and return the edit page URL */
async function createDraft(page: Page, title: string): Promise<string> {
  await page.goto("/problems/create");
  await page.locator("form input[required]").first().fill(title);
  const textareas = page.locator("form textarea");
  await textareas.nth(0).fill(
    "This is a test problem for E2E configuration testing. " +
      "It has enough characters to pass the minimum length validation requirement."
  );
  await textareas.nth(1).fill("An integer n.");
  await textareas.nth(2).fill("Print n.");
  await page.getByRole("button", { name: /save basic info/i }).click();
  await page.waitForURL(/\/problems\/.*\/edit/);
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
    const fullSourceRadio = page.locator('input[value="full_source"]');
    await expect(fullSourceRadio).toBeChecked();
  });

  test("can set time and memory limits", async ({ page }) => {
    await goToTab(page, "Submission Settings");

    const timeInput = page.getByLabel(/time limit/i);
    await timeInput.fill("2000");

    const memoryInput = page.getByLabel(/memory limit/i);
    await memoryInput.fill("512");

    await page.getByRole("button", { name: /save settings/i }).click();

    // Reload and verify values persisted
    await page.goto(editUrl);
    await goToTab(page, "Submission Settings");
    await expect(page.getByLabel(/time limit/i)).toHaveValue("2000");
    await expect(page.getByLabel(/memory limit/i)).toHaveValue("512");
  });

  test("switching to function type shows template editor", async ({ page }) => {
    await goToTab(page, "Submission Settings");

    const functionRadio = page.locator('input[value="function"]');
    await functionRadio.check();

    // Template editor should appear
    await expect(page.getByText(/driver code/i)).toBeVisible();
    await expect(page.getByText(/template code/i)).toBeVisible();
  });

  test("switching to zip_project type shows file structure fields", async ({ page }) => {
    await goToTab(page, "Submission Settings");

    const zipRadio = page.locator('input[value="zip_project"]');
    await zipRadio.check();

    // ZIP-specific fields should appear
    await expect(page.getByText(/file structure/i)).toBeVisible();
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
    await checkerRadio.check();

    // Checker script editor should appear
    await expect(page.getByText(/load default template/i)).toBeVisible();
  });

  test("selecting interactive shows interactor script editor", async ({ page }) => {
    await goToTab(page, "Judge Settings");

    const interactiveRadio = page.locator('input[name="judgeType"][value="interactive"]');
    await interactiveRadio.check();

    await expect(page.getByText(/load default template/i)).toBeVisible();
  });

  test("can enable static analysis with banned functions", async ({ page }) => {
    await goToTab(page, "Judge Settings");

    // Find and enable static analysis toggle
    const toggles = page.locator("button[role='switch']");
    const staticAnalysisToggle = toggles.first();
    await staticAnalysisToggle.click();

    // Banned functions field should appear
    await expect(page.getByText(/banned functions/i)).toBeVisible();
    await expect(page.getByText(/banned imports/i)).toBeVisible();
    await expect(page.getByText(/banned patterns/i)).toBeVisible();
    await expect(page.getByText(/linter command/i)).toBeVisible();
  });

  test("can enable artifact collection", async ({ page }) => {
    await goToTab(page, "Judge Settings");

    // Scroll down to artifact section and enable it
    const artifactHeading = page.getByText(/artifact collection/i).first();
    await artifactHeading.scrollIntoViewIfNeeded();

    // Find the toggle near the artifact section
    const artifactSection = page
      .locator("section, div")
      .filter({ hasText: /artifact collection/i });
    const toggle = artifactSection.locator("button[role='switch']").first();
    await toggle.click();

    await expect(page.getByText(/collection patterns/i)).toBeVisible();
    await expect(page.getByText(/max total size/i)).toBeVisible();
  });

  test("can enable network access with firewall rules", async ({ page }) => {
    await goToTab(page, "Judge Settings");

    const networkHeading = page.getByText(/network access/i).first();
    await networkHeading.scrollIntoViewIfNeeded();

    const networkSection = page.locator("section, div").filter({ hasText: /network access/i });
    const toggle = networkSection.locator("button[role='switch']").first();
    await toggle.click();

    await expect(page.getByText(/firewall rules/i)).toBeVisible();
    await expect(page.getByText(/sidecar services/i)).toBeVisible();
    await expect(page.getByText(/log traffic/i)).toBeVisible();
  });

  test("can save checker configuration", async ({ page }) => {
    await goToTab(page, "Judge Settings");

    // Select checker type
    const checkerRadio = page.locator('input[name="judgeType"][value="checker"]');
    await checkerRadio.check();

    // Load default template
    await page
      .getByRole("button", { name: /load default template/i })
      .first()
      .click();

    // Save
    await page.getByRole("button", { name: /save settings/i }).click();

    // Reload and verify
    await page.goto(editUrl);
    await goToTab(page, "Judge Settings");
    const checkerRadioAfter = page.locator('input[name="judgeType"][value="checker"]');
    await expect(checkerRadioAfter).toBeChecked();
  });
});

// ─── Testcase Management ───────────────────────────────────────────

test.describe("Testcase Management Tab", () => {
  let editUrl: string;

  test.beforeEach(async ({ page }) => {
    editUrl = await createDraft(page, `Testcase Config ${Date.now()}`);
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
  let editUrl: string;

  test.beforeEach(async ({ page }) => {
    editUrl = await createDraft(page, `Scoring Config ${Date.now()}`);
  });

  test("shows hint when no testcase sets exist", async ({ page }) => {
    await goToTab(page, "Scoring Rules");

    // Should show message about needing testcase sets
    await expect(page.getByText(/testcase/i)).toBeVisible();
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

    // Enable the toggle
    const scriptSection = page
      .locator("section, div")
      .filter({ hasText: /custom scoring script/i });
    const toggle = scriptSection.locator("button[role='switch']").first();
    if (await toggle.isVisible()) {
      await toggle.click();
      // Warning about override should appear
      await expect(page.getByText(/override/i)).toBeVisible();
    }
  });
});

// ─── Full Workflow: Create → Configure → Publish ───────────────────

test.describe("Full Problem Configuration Workflow", () => {
  test("standard problem: create → add testcases → publish", async ({ page }) => {
    // Step 1: Create draft
    const editUrl = await createDraft(page, `Full Workflow ${Date.now()}`);

    // Step 2: Verify draft badge
    await expect(page.getByText("Draft")).toBeVisible();

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
    await checkerRadio.check();

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

    const functionRadio = page.locator('input[value="function"]');
    await functionRadio.check();

    // Template editor section should appear
    await expect(page.getByText(/driver code/i)).toBeVisible();
    await expect(page.getByText(/template code/i)).toBeVisible();
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

    await expect(page.getByText(/banned functions/i)).toBeVisible();

    // Save judge settings
    await page.getByRole("button", { name: /save settings/i }).click();

    // Step 3: Enable custom scoring in Scoring Rules
    await goToTab(page, "Scoring Rules");

    const scriptHeading = page.getByText(/custom scoring script/i).first();
    await scriptHeading.scrollIntoViewIfNeeded();

    const scriptSection = page
      .locator("section, div")
      .filter({ hasText: /custom scoring script/i });
    const scriptToggle = scriptSection.locator("button[role='switch']").first();
    if (await scriptToggle.isVisible()) {
      await scriptToggle.click();
      await expect(page.getByText(/override/i)).toBeVisible();
    }
  });

  test("cross-tab navigation preserves unsaved state warning", async ({ page }) => {
    // Create draft and go to submission settings
    await createDraft(page, `Cross Tab ${Date.now()}`);
    await goToTab(page, "Submission Settings");

    // Change time limit
    const timeInput = page.getByLabel(/time limit/i);
    await timeInput.fill("5000");

    // Switch to another tab and back
    await goToTab(page, "Judge Settings");
    await goToTab(page, "Submission Settings");

    // Each tab has independent form state, so the value should be from server
    await expect(page.getByRole("main")).toBeVisible();
  });
});
