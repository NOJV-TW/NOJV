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
    await expect(page.getByRole("heading", { name: "Problems" })).toBeVisible();
    await context.close();
  });

  test("can view contest scoreboard", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/contests/spring-qualifier-2026/scoreboard");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Scoreboard", exact: true })).toBeVisible();
    await context.close();
  });

  test("contest search filters the list", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/contests");
    // Wait for the list to render before interacting with the search box.
    await expect(page.getByText("Spring Qualifier 2026")).toBeVisible();
    // Type a non-matching query to verify filtering works.
    const searchbox = page.getByRole("searchbox");
    await searchbox.fill("nonexistent-contest-xyz");
    // Svelte 5's bind:value may update reactively on the next microtask;
    // poll the heading for absence with generous timeout.
    await expect(page.getByText("Spring Qualifier 2026")).not.toBeVisible({ timeout: 10_000 });
    await context.close();
  });
});
