import { test, expect } from "@playwright/test";
import path from "node:path";

const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");

test.describe("Contests", () => {
  test("can browse contest list", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/contests");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText("Spring Qualifier 2026")).toBeVisible();
    await context.close();
  });

  test("can view contest detail page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/contests/spring-qualifier-2026");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Spring Qualifier 2026" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Problems" })).toBeVisible();
    await context.close();
  });

  test("can view contest scoreboard", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/contests/spring-qualifier-2026/scoreboard");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Live ranking", level: 1 })).toBeVisible();
    await context.close();
  });
});
