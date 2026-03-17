import { test, expect } from "@playwright/test";
import path from "node:path";

const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");
const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");

test.describe("Problems", () => {
  test("can browse problem list as authenticated user", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/problems");
    await expect(page.getByRole("main")).toBeVisible();
    // Should see at least one public problem
    await expect(page.getByText("Warmup Sum")).toBeVisible();
    await context.close();
  });

  test("can view problem detail page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/problems/warmup-sum");
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("teacher can access problem creation page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto("/problems/create");
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });
});
