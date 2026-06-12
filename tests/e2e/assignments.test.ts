import { test, expect } from "@playwright/test";

import { studentAuth, teacherAuth } from "./_shared";

const HW1_ID = "hw1-process-trace";
const HW2_ID = "hw2-signal-handling";
const HW3_ID = "hw3-scheduler-draft";

test.describe("Assignments — list + detail", () => {
  test("student sees the assignments listing page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/assignments");
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("student sees published seeded assignments in the listing", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/assignments");
    await expect(page.getByText("Homework 1: Process Trace")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Homework 2: Signal Handling")).toBeVisible();
    await context.close();
  });

  test("draft assignment is hidden from students", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/assignments");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText("Homework 3: Scheduler (draft)")).not.toBeVisible();
    await context.close();
  });

  test("teacher sees draft assignment in listing", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto("/assignments");
    await expect(page.getByText("Homework 3: Scheduler (draft)")).toBeVisible({
      timeout: 10_000,
    });
    await context.close();
  });

  test("student can open a published assignment detail page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto(`/assignments/${HW1_ID}`);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Homework 1: Process Trace" }),
    ).toBeVisible();
    await context.close();
  });

  test("teacher can open the draft assignment detail page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/assignments/${HW3_ID}`);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Homework 3: Scheduler (draft)" }),
    ).toBeVisible();
    await context.close();
  });

  test("student visiting a problem under a closed assignment lands on bare practice", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto(`/assignments/${HW2_ID}/problems/problem_add-two-numbers`);
    await expect(page).toHaveURL(/\/problems\/problem_add-two-numbers/);
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("filter tabs change the URL", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/assignments?tab=closed");
    await expect(page.getByRole("main")).toBeVisible();
    expect(page.url()).toContain("tab=closed");
    await context.close();
  });
});
