import { test, expect } from "@playwright/test";
import path from "node:path";

const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");

test.describe("Submission flow", () => {
  test("can view problem list", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/problems");
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("can view submissions page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/submissions");
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });
});
