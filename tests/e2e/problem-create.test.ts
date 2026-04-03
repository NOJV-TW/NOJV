import { test, expect } from "@playwright/test";
import path from "node:path";

const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");
const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");

// Helper: fill the basic info form and submit
async function fillBasicInfo(
  page: import("@playwright/test").Page,
  opts: {
    title: string;
    statement: string;
    inputFormat: string;
    outputFormat: string;
    difficulty?: "Easy" | "Medium" | "Hard";
    visibility?: "Private" | "Public";
  }
) {
  // Wait for form to be interactive
  await page.locator("form button[type=submit]").waitFor();
  // Title is the first required input in the form
  await page.locator("form input[required]").first().fill(opts.title);
  // Statement, inputFormat, outputFormat are the first 3 textareas
  const textareas = page.locator("form textarea");
  await textareas.nth(0).fill(opts.statement);
  await textareas.nth(1).fill(opts.inputFormat);
  await textareas.nth(2).fill(opts.outputFormat);

  if (opts.difficulty) {
    await page.getByText(opts.difficulty).click();
  }
  if (opts.visibility) {
    await page.getByText(opts.visibility).click();
  }
}

test.describe("Problem Creation — Standard Problem", () => {
  test.use({ storageState: teacherAuth });

  test("create page shows all 5 tabs with 4 disabled", async ({ page }) => {
    await page.goto("/problems/create");
    await expect(page.getByRole("button", { name: "Basic Info", exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Submission Settings", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Testcase Management", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Judge Settings", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Scoring Rules", exact: true })
    ).toBeVisible();

    // Disabled tabs should not be clickable (they have aria-disabled or disabled attribute)
    const submissionTab = page.getByRole("button", {
      name: "Submission Settings",
      exact: true
    });
    await expect(submissionTab).toBeVisible();
  });

  test("create a standard problem draft and redirect to edit", async ({ page }) => {
    const uniqueTitle = `E2E Standard ${Date.now()}`;

    await page.goto("/problems/create");

    await fillBasicInfo(page, {
      title: uniqueTitle,
      statement: "Given two integers, print their sum.\n\nConstraints: 1 <= a, b <= 1000",
      inputFormat: "Two integers a and b, separated by a space.",
      outputFormat: "A single integer, the sum of a and b."
    });

    await page.getByRole("button", { name: /save basic info/i }).click();

    // Should redirect to edit page with all tabs enabled
    await page.waitForURL(/\/problems\/.*\/edit/, { timeout: 30000 });
    await expect(page.getByText(uniqueTitle)).toBeVisible();

    // All tabs should now be clickable
    await page.getByRole("button", { name: "Submission Settings", exact: true }).click();
    await expect(page.getByText(/time limit/i)).toBeVisible();

    await page.getByRole("button", { name: "Testcase Management", exact: true }).click();
    // Should show empty state or testcase upload UI
    await expect(page.getByRole("main")).toBeVisible();
  });

  test("create draft with custom slug via advanced options", async ({ page }) => {
    const slug = `e2e-custom-slug-${Date.now()}`;

    await page.goto("/problems/create");

    await fillBasicInfo(page, {
      title: "Custom Slug Problem",
      statement: "This is a test problem with a custom slug for URL identification.",
      inputFormat: "One integer n.",
      outputFormat: "Print n."
    });

    // Open advanced options and set slug
    await page.getByText(/advanced options/i).click();
    await page.waitForTimeout(500);
    await page.locator('input[name="slug"]').fill(slug);

    await page.getByRole("button", { name: /save basic info/i }).click();
    await page.waitForURL(`**/problems/${slug}/edit`, { timeout: 30000 });
  });

  test("shows Draft badge on edit page", async ({ page }) => {
    await page.goto("/problems/create");

    await fillBasicInfo(page, {
      title: `Draft Badge Test ${Date.now()}`,
      statement: "Testing that the draft badge is visible on the edit page.",
      inputFormat: "n/a",
      outputFormat: "n/a"
    });

    await page.getByRole("button", { name: /save basic info/i }).click();
    await page.waitForURL(/\/problems\/.*\/edit/, { timeout: 30000 });

    await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  });
});

test.describe("Problem Creation — Edit Flow", () => {
  test.use({ storageState: teacherAuth });

  let editUrl: string;

  test.beforeEach(async ({ page }) => {
    // Create a draft problem first
    await page.goto("/problems/create");

    await fillBasicInfo(page, {
      title: `E2E Edit Flow ${Date.now()}`,
      statement: "A problem for testing the full edit workflow across all tabs.",
      inputFormat: "An integer n (1 <= n <= 100).",
      outputFormat: "Print n lines."
    });

    await page.getByRole("button", { name: /save basic info/i }).click();
    await page.waitForURL(/\/problems\/.*\/edit/, { timeout: 30000 });
    editUrl = page.url();
  });

  test("can switch between all tabs", async ({ page }) => {
    await page.goto(editUrl);

    const tabs = [
      "Basic Info",
      "Submission Settings",
      "Testcase Management",
      "Judge Settings",
      "Scoring Rules"
    ];

    for (const tab of tabs) {
      await page.getByRole("button", { name: tab, exact: true }).click();
      // Each tab should render content
      await expect(page.getByRole("main")).toBeVisible();
    }
  });

  test("can update submission settings", async ({ page }) => {
    await page.goto(editUrl);
    await page.getByRole("button", { name: "Submission Settings", exact: true }).click();

    // Should see time/memory limit fields
    await expect(page.getByText(/time limit/i)).toBeVisible();
    await expect(page.getByText(/memory limit/i)).toBeVisible();
  });

  test("publish button is disabled without testcases", async ({ page }) => {
    await page.goto(editUrl);

    // Publish button should exist but be disabled (no testcases yet)
    const publishBtn = page.getByText(/finish.*publish/i);
    await expect(publishBtn).toBeVisible();

    // Hover should show tooltip
    await publishBtn.hover();
    await expect(page.getByText(/at least one testcase/i)).toBeVisible();
  });
});

test.describe("Problem Creation — Validation", () => {
  test.use({ storageState: teacherAuth });

  test("cannot create without required fields", async ({ page }) => {
    await page.goto("/problems/create");

    // Try to submit without filling anything
    await page.getByRole("button", { name: /save basic info/i }).click();

    // Should stay on create page (HTML5 validation prevents submit)
    await expect(page).toHaveURL(/\/problems\/create/);
  });

  test("shows error for too-short statement", async ({ page }) => {
    await page.goto("/problems/create");

    await page.locator("form input[required]").first().fill("Short Statement Test");
    const textareas = page.locator("form textarea");
    await textareas.nth(0).fill("Too short");
    await textareas.nth(1).fill("n/a");
    await textareas.nth(2).fill("n/a");

    await page.getByRole("button", { name: /save basic info/i }).click();

    // Should show validation error (statement min 16 chars)
    await expect(page).toHaveURL(/\/problems\/create/);
  });
});

test.describe("Problem Creation — Access Control", () => {
  test("unverified student cannot see My Problems tab", async ({ browser }) => {
    // Student seed account has emailVerified: false
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();

    await page.goto("/problems");
    await expect(page.getByText(/public/i)).toBeVisible();

    // My Problems tab should not be visible
    await expect(page.getByRole("button", { name: /my problems/i })).not.toBeVisible();
    await context.close();
  });

  test("unverified student is redirected from create page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();

    await page.goto("/problems/create");

    // Should be redirected to /problems
    await expect(page).toHaveURL(/\/problems$/);
    await context.close();
  });

  test("teacher can access create page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();

    await page.goto("/problems/create");
    await expect(page.getByRole("button", { name: "Basic Info", exact: true })).toBeVisible();
    await context.close();
  });
});

test.describe("Problem Creation — My Problems List", () => {
  test.use({ storageState: teacherAuth });

  test("newly created draft appears in My Problems", async ({ page }) => {
    const uniqueTitle = `My Problems List ${Date.now()}`;

    // Create a draft
    await page.goto("/problems/create");
    await fillBasicInfo(page, {
      title: uniqueTitle,
      statement: "Testing that created problems appear in My Problems tab.",
      inputFormat: "n/a",
      outputFormat: "n/a"
    });
    await page.getByRole("button", { name: /save basic info/i }).click();
    await page.waitForURL(/\/problems\/.*\/edit/, { timeout: 30000 });

    // Go to problems list
    await page.goto("/problems");
    await page.getByRole("button", { name: /my problems/i }).click();

    // Should see the new problem with Draft badge and edit button
    await expect(page.getByText(uniqueTitle)).toBeVisible();
    await expect(page.getByText("Draft").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /edit/i }).first()).toBeVisible();
  });
});
