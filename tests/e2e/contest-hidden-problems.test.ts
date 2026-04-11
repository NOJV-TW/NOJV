import { expect, test } from "@playwright/test";
import path from "node:path";

const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");
const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");

// Seeded in `packages/db/prisma/seeds/courses.ts` as an upcoming contest
// linked to the OS lab course (teacher@nojv.local is the course teacher,
// student@nojv.local is a course student). startsAt is in the far future
// so the hiding logic always fires.
const UPCOMING_SLUG = "upcoming-demo-contest";
const SEEDED_PROBLEM_TITLE = "Warmup Sum";

test.describe("Contest problem visibility", () => {
  test("student sees placeholder and no problem titles before start", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto(`/contests/${UPCOMING_SLUG}`);

    await expect(page.getByText("Problems are not yet available")).toBeVisible();
    await expect(
      page.getByText("Problems will be revealed when the contest starts.")
    ).toBeVisible();
    // Seeded problem title that would leak if hiding is broken.
    await expect(page.getByText(SEEDED_PROBLEM_TITLE)).toHaveCount(0);

    await context.close();
  });

  test("teacher of the course sees problem titles before start", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/contests/${UPCOMING_SLUG}`);

    await expect(page.getByText("Problems are not yet available")).toHaveCount(0);
    await expect(page.getByText(SEEDED_PROBLEM_TITLE).first()).toBeVisible();

    await context.close();
  });

  test("contest list has participable and managed tabs", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto("/contests");

    await expect(page.getByRole("tab", { name: "Participable" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "My contests" })).toBeVisible();

    await page.getByRole("tab", { name: "My contests" }).click();
    await expect(page).toHaveURL(/tab=managed/);

    await context.close();
  });
});
