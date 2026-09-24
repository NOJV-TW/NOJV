import { test, expect } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../packages/db/generated/prisma/client";
import { resolveDestructiveTestDatabase } from "../setup/destructive-test-database";

import { apiWriteHeaders, ORIGIN, readLiveSession, studentAuth, teacherAuth } from "./_shared";

const MIDTERM_ID = "exam_midterm-systems-lab";
const UPCOMING_ID = "exam_upcoming-demo";
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: resolveDestructiveTestDatabase("nojv_e2e_test") }),
});

test.afterAll(async () => db.$disconnect());

test.describe("Exams — list, detail, problem visibility", () => {
  test("student sees the exams listing page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/exams");
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("teacher exams list shows midterm fixture", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto("/exams");
    await expect(page.getByText("Midterm Systems Lab")).toBeVisible({ timeout: 10_000 });
    await context.close();
  });

  test("teacher can open midterm exam detail", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/exams/${MIDTERM_ID}`);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText("Midterm Systems Lab")).toBeVisible();
    await context.close();
  });

  test("exam tabs follow client navigation and survive refresh", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    try {
      await page.goto(`/exams/${MIDTERM_ID}?tab=results`);
      const selectedTab = page.locator('[role="tab"][aria-selected="true"]');
      await expect(selectedTab).toHaveAttribute("id", "exam-manage-tab-results");
      await page.locator("#exam-manage-tab-submissions").click();
      await expect(page).toHaveURL(/\?tab=submissions$/);
      await page.evaluate((href) => {
        const link = document.createElement("a");
        link.href = href;
        link.id = "exam-navigation-link";
        link.textContent = "Open exam audit";
        document.body.append(link);
      }, `/exams/${MIDTERM_ID}?tab=audit`);
      await page.locator("#exam-navigation-link").click();
      await expect(selectedTab).toHaveAttribute("id", "exam-manage-tab-results");
      await expect(page.locator('a[aria-current="page"][href$="tab=audit"]')).toBeVisible();
      await expect(
        page.locator('[role="tablist"]').first().getByRole("tab").last(),
      ).toHaveAttribute("id", "exam-manage-tab-settings");
      await page.goBack();
      await expect(selectedTab).toHaveAttribute("id", "exam-manage-tab-submissions");
      await page.reload();
      await expect(selectedTab).toHaveAttribute("id", "exam-manage-tab-submissions");
    } finally {
      await context.close();
    }
  });

  test("student opening an upcoming exam sees no problem titles before start", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto(`/exams/${UPCOMING_ID}`);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText("Warmup: Sum")).not.toBeVisible();
    await context.close();
  });

  test("teacher can toggle page lock while a student keeps an exam session open", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const examId = "exam_demo_gradebook_active";
    const teacherContext = await browser.newContext({ storageState: teacherAuth });
    const studentContext = await browser.newContext({ storageState: studentAuth });
    const teacherPage = await teacherContext.newPage();
    const studentPage = await studentContext.newPage();
    const originalExam = await db.exam.findUniqueOrThrow({
      where: { id: examId },
      select: { pageLockEnabled: true },
    });
    let studentUserId: string | undefined;
    const englishLabel = "Restrict other site features during the exam";
    const englishHelp =
      "When enabled, students are confined to this exam after entering. Navigating to another NOJV page redirects them back and is logged. When disabled, they can use other site features while the exam session continues. This setting does not detect window switching or leaving NOJV.";

    await teacherContext.addCookies([
      {
        name: "PARAGLIDE_LOCALE",
        value: "en",
        domain: new URL(ORIGIN).hostname,
        path: "/",
        httpOnly: false,
        secure: false,
        sameSite: "Lax",
      },
    ]);
    try {
      await db.exam.update({ where: { id: examId }, data: { pageLockEnabled: false } });
      const started = await studentPage.request.post(`/exams/${examId}?/startExam`, {
        form: {},
        headers: apiWriteHeaders,
      });
      expect((await started.json()).type).toBe("success");
      const { user } = await readLiveSession(studentPage);
      studentUserId = user.id;

      await teacherPage.goto(`/exams/${examId}?tab=settings`);
      await teacherPage.bringToFront();
      const pageLock = teacherPage.getByLabel(englishLabel);
      await expect(pageLock).not.toBeChecked();
      const helpButton = teacherPage.getByRole("button", { name: englishHelp });
      await helpButton.scrollIntoViewIfNeeded();
      await helpButton.hover();
      await expect(teacherPage.getByText(englishHelp)).toBeVisible();

      await pageLock.check();
      const enableResponse = teacherPage.waitForResponse(
        (response) =>
          response.request().method() === "POST" && response.url().includes("updateSettings"),
      );
      await teacherPage
        .locator('form[action="?/updateSettings"] button[type="submit"]')
        .click();
      expect((await (await enableResponse).json()).type).toBe("success");
      await expect
        .poll(
          async () =>
            (await db.exam.findUniqueOrThrow({ where: { id: examId } })).pageLockEnabled,
        )
        .toBe(true);

      await studentPage.goto(`/exams/${examId}/problems/problem_warmup-sum`);
      await studentPage.goto("/dashboard");
      await expect(studentPage).toHaveURL(new RegExp(`/exams/${examId}$`));
      await studentPage.getByRole("link", { name: "Overview", exact: true }).click();
      await expect(studentPage).toHaveURL(new RegExp(`/exams/${examId}$`));

      const otherTab = await studentContext.newPage();
      await otherTab.goto("/dashboard");
      await expect(otherTab).toHaveURL(new RegExp(`/exams/${examId}$`));
      await otherTab.close();

      await teacherPage.reload();
      await teacherPage.getByLabel(englishLabel).uncheck();
      const disableResponse = teacherPage.waitForResponse(
        (response) =>
          response.request().method() === "POST" && response.url().includes("updateSettings"),
      );
      await teacherPage
        .locator('form[action="?/updateSettings"] button[type="submit"]')
        .click();
      expect((await (await disableResponse).json()).type).toBe("success");
      await expect
        .poll(
          async () =>
            (await db.exam.findUniqueOrThrow({ where: { id: examId } })).pageLockEnabled,
        )
        .toBe(false);

      await teacherContext.addCookies([
        {
          name: "PARAGLIDE_LOCALE",
          value: "zh-TW",
          domain: new URL(ORIGIN).hostname,
          path: "/",
          httpOnly: false,
          secure: false,
          sameSite: "Lax",
        },
      ]);
      await teacherPage.goto(`/exams/${examId}?tab=settings`);
      const chineseHelp =
        "開啟後，學生進入考試即限於本次考試，前往其他 NOJV 頁面會被導回並記錄。關閉後可正常使用其他站內功能，考試仍持續進行。此設定不會偵測切換視窗或離開 NOJV。";
      await expect(teacherPage.getByLabel("限制使用考試以外的站內功能")).toBeVisible();
      const chineseHelpButton = teacherPage.getByRole("button", { name: chineseHelp });
      for (let index = 0; index < 40; index += 1) {
        await teacherPage.keyboard.press("Tab");
        if (await chineseHelpButton.evaluate((button) => button === document.activeElement))
          break;
      }
      await expect(chineseHelpButton).toBeFocused();
      await expect(teacherPage.getByText(chineseHelp)).toBeVisible();

      await studentPage.goto("/dashboard");
      await expect(studentPage).toHaveURL(/\/dashboard$/);
      await expect(studentPage.getByRole("main")).toBeVisible();
      await studentPage.goto(`/exams/${examId}/problems/problem_warmup-sum`);
      await expect(
        studentPage.getByRole("button", { name: "Submit", exact: true }),
      ).toBeVisible();
      await studentPage.goBack();
      await expect(studentPage).toHaveURL(/\/dashboard$/);
      await studentPage.goForward();
      await expect(studentPage).toHaveURL(
        new RegExp(`/exams/${examId}/problems/problem_warmup-sum$`),
      );
      await expect(
        studentPage.getByRole("button", { name: "Submit", exact: true }),
      ).toBeVisible();
      const liveSession = await db.activeExamSession.findFirstOrThrow({
        where: { userId: user.id, examId, endedAt: null },
      });
      expect(liveSession.endedAt).toBeNull();
    } finally {
      await db.exam.update({ where: { id: examId }, data: { pageLockEnabled: false } });
      try {
        if (studentUserId) {
          const activeSession = await db.activeExamSession.findFirst({
            where: { userId: studentUserId, examId, endedAt: null },
            select: { id: true },
          });
          if (activeSession) {
            const response = await teacherPage.request.post(
              `/exams/${examId}?/releaseStudentSession`,
              {
                form: { targetUserId: studentUserId },
                headers: apiWriteHeaders,
              },
            );
            if (!response.ok()) {
              throw new Error(
                `Failed to release the E2E exam session: HTTP ${response.status()}`,
              );
            }
          }
        }
      } finally {
        await db.exam.update({
          where: { id: examId },
          data: { pageLockEnabled: originalExam.pageLockEnabled },
        });
        await teacherContext.close();
        await studentContext.close();
      }
    }
  });

  test("starting an exam session requires authentication", async ({ page }) => {
    const res = await page.request.post(`/exams/${MIDTERM_ID}?/startExam`, {
      form: {},
      headers: apiWriteHeaders,
    });
    const body = await res.json();
    expect(body.type).not.toBe("success");
  });

  test("starting a session for a nonexistent exam fails for a student", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.post(`/exams/exam_does-not-exist?/startExam`, {
      form: {},
      headers: apiWriteHeaders,
    });
    const body = await res.json();
    expect(body.type).not.toBe("success");
    await context.close();
  });

  test("ip-violations endpoint handles unknown exam id gracefully", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.request.get("/api/exams/exam_does-not-exist/ip-violations");
    expect(res.status()).toBeLessThan(500);
    await context.close();
  });

  test("ip-violations endpoint forbids students", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.get(`/api/exams/${MIDTERM_ID}/ip-violations`);
    expect(res.status()).toBe(403);
    await context.close();
  });

  test("teacher can list ip-violations for a real exam", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.request.get(`/api/exams/${MIDTERM_ID}/ip-violations`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.violations)).toBe(true);
    await context.close();
  });

  test("active exam workspace keeps its countdown and moves hand-in to the overview", async ({
    browser,
  }) => {
    const examId = "exam_demo_gradebook_active";
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    try {
      const response = await page.request.post(`/exams/${examId}?/startExam`, {
        form: {},
        headers: apiWriteHeaders,
      });
      expect((await response.json()).type).toBe("success");
      await page.goto(`/exams/${examId}/problems/problem_warmup-sum`);
      const countdown = page.getByText(/^\d{2,}:\d{2}:\d{2}$/);
      await expect(countdown).toBeVisible();
      const initial = await countdown.textContent();
      await expect.poll(() => countdown.textContent()).not.toBe(initial);
      await expect(
        page.locator('[data-slot="workspace-timer"]').getByRole("button"),
      ).toHaveCount(0);
      await page.getByRole("link", { name: "Exam overview", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/exams/${examId}$`));
      await page.getByRole("button", { name: "End exam", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "Cancel, keep working", exact: true }),
      ).toBeFocused();
      await dialog.getByRole("button", { name: "Cancel, keep working", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await page.getByRole("button", { name: "End exam", exact: true }).click();
      await dialog.getByRole("button", { name: "Confirm and end exam", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Submitted", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: /start exam/i })).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole("heading", { name: "Submitted", exact: true })).toBeVisible();
      const restart = await page.request.post(`/exams/${examId}?/startExam`, {
        form: {},
        headers: apiWriteHeaders,
      });
      expect(await restart.json()).toMatchObject({ type: "failure", status: 403 });
      const problem = await page.request.get(`/exams/${examId}/problems/problem_warmup-sum`);
      expect(problem.status()).toBe(403);
    } finally {
      await page.request.post(`/exams/${examId}?/releaseSession`, {
        form: {},
        headers: apiWriteHeaders,
      });
      await context.close();
    }
  });
});
