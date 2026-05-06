import { expect, test } from "@playwright/test";
import path from "node:path";

const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");

// Original "upcoming-demo-contest" fixture was retired during the
// contest/exam split (proctoring moved to exams). The remaining contest
// seed `spring-qualifier-2026` has its `startsAt` in the past, so the
// "problems hidden before start" branch can no longer be exercised here
// without re-introducing seed data.
//
// What we still want to lock down: the contest listing exposes a stable
// pair of tabs (participable + managed), and clicking the managed tab
// updates the URL — that's the glue the SSR loader depends on.
test.describe("Contest listing", () => {
  test("contest list has participable and managed tabs", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto("/contests");

    await expect(page.getByRole("tab", { name: "Participable" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "My contests" })).toBeVisible();

    // setTab uses goto() from $app/navigation, which requires Svelte
    // hydration to have finished. Without a beat the click fires the
    // static HTML button, never updates the URL.
    await page.waitForTimeout(1500);
    await page.getByRole("tab", { name: "My contests" }).click();
    await expect(page).toHaveURL(/tab=managed/, { timeout: 10_000 });

    await context.close();
  });
});
