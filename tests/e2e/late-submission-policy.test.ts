import { test, expect } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../../packages/db/generated/prisma/client";
import { resolveDestructiveTestDatabase } from "../setup/destructive-test-database";
import { apiWriteHeaders, studentAuth, teacherAuth } from "./_shared";

const courseId = "course_os-lab-spring-2026";

for (const kind of ["assignments", "exams"] as const) {
  test(`${kind}: create, reload, edit and disable late collection`, async ({ browser }) => {
    const context = await browser.newContext({
      storageState: teacherAuth,
      locale: "en-US",
      timezoneId: "Asia/Taipei",
    });
    const page = await context.newPage();
    await page.goto(`/courses/${courseId}/${kind}/new`);
    await expect(page.locator("#title")).toBeVisible();
    await page.waitForTimeout(3000);
    await page.locator("#title").fill(`Late policy ${kind}`);
    await page
      .locator(kind === "assignments" ? "#opensAt" : "#startsAt")
      .fill("2030-01-01T09:00");
    await page.locator("#dueAt").fill("2030-01-02T09:00");
    const finalSelector = kind === "assignments" ? "#closesAt" : "#endsAt";
    await expect(page.locator(finalSelector)).toHaveCount(0);
    await page.getByRole("checkbox", { name: "Allow late submissions" }).check();
    await page.locator(finalSelector).fill("2030-01-04T09:00");
    await page.locator("#late-penalty-rule").selectOption("daily_late_penalty");
    await page.locator("#late-penalty-rule").blur();
    const schedule = page.locator('[data-slot="late-submission-fields"]');
    await schedule.screenshot({ path: `output/late-policy-${kind}-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      )
      .toBe(true);
    await schedule.screenshot({ path: `output/late-policy-${kind}-mobile.png` });
    await page.setViewportSize({ width: 1280, height: 900 });
    const createResponsePromise = page.waitForResponse(
      (response) => response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    const createResponse = await createResponsePromise;
    expect((await createResponse.json()).type).toBe("redirect");
    if (kind === "assignments") {
      await expect(page).toHaveURL(`/courses/${courseId}/assignments`, { timeout: 30_000 });
      await page.waitForTimeout(3000);
      await page.getByRole("link", { name: /Late policy assignments/ }).click();
      await expect(page).toHaveURL(/\/assignments\/late-policy-assignments-[^/]+$/, {
        timeout: 30_000,
      });
    } else {
      await expect(page).toHaveURL(/\/exams\/(?!new$)[^/]+$/, { timeout: 30_000 });
    }
    await expect(page.getByText(/10%/).first()).toBeVisible();
    await page.reload();
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    await expect(page.locator("#late-penalty-rule")).toHaveValue("daily_late_penalty");
    await expect(page.locator("#dueAt")).toHaveValue("2030-01-02T09:00");
    await expect(page.locator(finalSelector)).toHaveValue("2030-01-04T09:00");
    await page.locator("#late-penalty-rule").selectOption("flat_late_penalty");
    const updateResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.url().includes("updateSettings"),
    );
    await page
      .locator('form[action="?/updateSettings"] button[type="submit"]:not([formaction])')
      .click();
    expect((await updateResponse).ok()).toBe(true);
    await expect(page.getByText(/20%/).first()).toBeVisible();
    await page.reload();
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    await expect(page.locator("#late-penalty-rule")).toHaveValue("flat_late_penalty");
    await page.getByRole("checkbox", { name: "Allow late submissions" }).uncheck();
    const disableResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.url().includes("updateSettings"),
    );
    await page
      .locator('form[action="?/updateSettings"] button[type="submit"]:not([formaction])')
      .click();
    expect((await disableResponse).ok()).toBe(true);
    await page.reload();
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    await expect(
      page.getByRole("checkbox", { name: "Allow late submissions" }),
    ).not.toBeChecked();
    await expect(page.locator(finalSelector)).toHaveCount(0);
    const database = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: resolveDestructiveTestDatabase("nojv_e2e_test"),
      }),
    });
    try {
      const id = new URL(page.url()).pathname.split("/").at(-1)!;
      if (kind === "assignments") {
        await database.assessment.update({ where: { id }, data: { dueAt: null } });
      } else {
        await database.exam.update({ where: { id }, data: { dueAt: null } });
      }
    } finally {
      await database.$disconnect();
    }
    await page.reload();
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    await expect(page.locator("#dueAt")).toHaveValue("2030-01-02T09:00");
    await context.close();
  });
}

test("student exam workspace remains open and shows the late collection countdown", async ({
  browser,
}) => {
  const database = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: resolveDestructiveTestDatabase("nojv_e2e_test"),
    }),
  });
  const examId = "exam_demo_gradebook_active";
  const previous = await database.exam.findUniqueOrThrow({ where: { id: examId } });
  const context = await browser.newContext({ storageState: studentAuth });
  const page = await context.newPage();
  try {
    await database.exam.update({
      where: { id: examId },
      data: {
        dueAt: new Date(Date.now() - 60_000),
        adjustmentRules: [{ type: "daily_late_penalty", perDayPct: 10 }],
      },
    });
    const response = await page.request.post(`/exams/${examId}?/startExam`, {
      form: {},
      headers: apiWriteHeaders,
    });
    expect((await response.json()).type).toBe("success");
    await page.goto(`/exams/${examId}/problems/problem_warmup-sum`);
    const timer = page.locator('[data-slot="workspace-timer"]');
    await expect(timer).toContainText("Late · final submissions close in");
    await expect(timer).toContainText("Part of a day counts as a full day.");
    await expect(page.getByRole("button", { name: /end exam/i })).toBeVisible();
    const countdown = timer.getByText(/^\d{2,}:\d{2}:\d{2}$/);
    const initialCountdown = await countdown.textContent();
    await expect
      .poll(() => countdown.textContent(), { timeout: 15_000 })
      .not.toBe(initialCountdown);
    await timer.screenshot({ path: "output/late-policy-workspace-desktop.png" });
  } finally {
    await page.request.post(`/exams/${examId}?/releaseSession`, {
      form: {},
      headers: apiWriteHeaders,
    });
    await context.close();
    await database.exam.update({
      where: { id: examId },
      data: {
        dueAt: previous.dueAt,
        adjustmentRules: previous.adjustmentRules ?? Prisma.DbNull,
      },
    });
    await database.$disconnect();
  }
});
