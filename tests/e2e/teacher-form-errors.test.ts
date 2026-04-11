import { test, expect } from "@playwright/test";
import path from "node:path";

const teacherAuth = path.resolve(
  import.meta.dirname,
  "../fixtures/auth-states/teacher.json"
);

test.describe("Teacher form error visibility", () => {
  test("teacher can create an assessment and sees a success banner", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto("/courses/os-lab-spring-2026/manage/assessments");

    // The component defaults to zh locale — placeholders are in Chinese.
    // Slug and problemIdsText placeholders are hard-coded (not translated).
    const uniqueSuffix = Date.now().toString(36);
    const title = `Fix HW ${uniqueSuffix}`;

    await page.getByPlaceholder("測驗標題").fill(title);
    await page.getByPlaceholder("assessment-slug").fill(`hw-fix-${uniqueSuffix}`);
    await page.getByPlaceholder("測驗摘要").fill("Regression test for silent failure fix.");
    // problemIdsText — first textarea with this placeholder (assessment form)
    await page.getByPlaceholder("problem-one, problem-two").first().fill("problem_warmup-sum");

    await page.getByRole("button", { name: /發布測驗/i }).click();

    await expect(page.getByText(`Published ${title}.`)).toBeVisible({ timeout: 10_000 });
    await context.close();
  });

  test("teacher sees a visible error banner when assessment creation fails", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto("/courses/os-lab-spring-2026/manage/assessments");

    // Use a problem id that does not exist — server will throw NotFoundError,
    // which must surface through the FormError banner (data-testid="form-error").
    await page.getByPlaceholder("測驗標題").fill("Never Published");
    await page.getByPlaceholder("assessment-slug").fill("never-published-regression");
    await page.getByPlaceholder("測驗摘要").fill("Intentional failure to test error surfacing.");
    await page.getByPlaceholder("problem-one, problem-two").first().fill("problem_does_not_exist_zzzz");

    await page.getByRole("button", { name: /發布測驗/i }).click();

    await expect(page.getByTestId("form-error")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("form-error")).toContainText(/not found/i);
    await context.close();
  });

  test("teacher can create a contest and sees a success banner", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto("/courses/os-lab-spring-2026/manage/assessments");

    const uniqueSuffix = Date.now().toString(36);
    const title = `Fix Quiz ${uniqueSuffix}`;

    await page.getByPlaceholder("競賽標題").fill(title);
    await page.getByPlaceholder("contest-slug").fill(`quiz-fix-${uniqueSuffix}`);
    await page.getByPlaceholder("競賽摘要").fill("Regression contest to verify form error fix.");
    // problemIdsText — last textarea with this placeholder (contest form)
    await page.getByPlaceholder("problem-one, problem-two").last().fill("problem_warmup-sum");

    await page.getByRole("button", { name: /建立競賽/i }).click();

    await expect(page.getByText(`Contest "${title}" created.`)).toBeVisible({ timeout: 10_000 });
    await context.close();
  });
});
