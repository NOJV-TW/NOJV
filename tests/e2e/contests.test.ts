import { test, expect } from "@playwright/test";
import path from "node:path";

const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");

test.describe("Contests", () => {
  test("can browse contest list", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/contests");
    await expect(page.getByRole("main")).toBeVisible();
    // Should see the seeded published contest
    await expect(page.getByText("Spring Qualifier 2026")).toBeVisible();
    await context.close();
  });

  test("can view contest detail page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/contests/spring-qualifier-2026");
    await expect(page.getByRole("main")).toBeVisible();
    // Contest title should be visible in the detail header
    await expect(page.getByRole("heading", { name: "Spring Qualifier 2026" })).toBeVisible();
    // Contest problems section should be present
    await expect(page.getByText("Problems")).toBeVisible();
    await context.close();
  });

  test("can view contest scoreboard", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/contests/spring-qualifier-2026/scoreboard");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText("Scoreboard")).toBeVisible();
    await context.close();
  });

  test("contest search filters the list", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/contests");
    // Type a non-matching query to verify filtering works
    await page.getByRole("searchbox").fill("nonexistent-contest-xyz");
    // The contest card should no longer be visible
    await expect(page.getByText("Spring Qualifier 2026")).not.toBeVisible();
    await context.close();
  });
});
