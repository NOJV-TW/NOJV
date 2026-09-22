import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "../../packages/db/generated/prisma/client";
import { resolveDestructiveTestDatabase } from "../setup/destructive-test-database";
import { readLiveSession, studentAuth, teacherAuth } from "./_shared";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: resolveDestructiveTestDatabase("nojv_e2e_test") }),
});
test.afterAll(async () => db.$disconnect());

async function capture(page: Page, surface: string) {
  const directory = path.resolve("output/exam-access-safety");
  await mkdir(directory, { recursive: true });
  for (const theme of ["light", "dark"] as const) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate((next) => {
        localStorage.setItem("nojv-theme", next);
        document.documentElement.classList.toggle("dark", next === "dark");
      }, theme);
      await page.evaluate(() => document.fonts.ready);
      await expect
        .poll(() =>
          page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        )
        .toBe(true);
      await page.screenshot({
        path: path.join(directory, `${surface}-${theme}-${String(width)}.png`),
        fullPage: true,
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test("teacher changes exam password and student signs in through the new login form", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const teacher = await browser.newContext({ storageState: teacherAuth });
  const student = await browser.newContext({ storageState: studentAuth });
  const guest = await browser.newContext();
  const teacherPage = await teacher.newPage();
  const studentPage = await student.newPage();
  const loginPage = await guest.newPage();
  const teacherId = (await readLiveSession(teacherPage)).user.id;
  const studentId = (await readLiveSession(studentPage)).user.id;
  const user = await db.user.findUniqueOrThrow({
    where: { id: studentId },
    select: { username: true },
  });
  const id = `access-${randomUUID()}`;
  try {
    await db.course.create({
      data: {
        id,
        title: "Example exam access course",
        description: "Synthetic UI verification fixture",
        ownerId: teacherId,
        memberships: {
          create: [
            { userId: teacherId, role: "teacher" },
            { userId: studentId, role: "student" },
          ],
        },
      },
    });
    await db.exam.create({
      data: {
        id,
        courseId: id,
        title: "Example exam access",
        summary: "Synthetic exam for access verification",
        createdByUserId: teacherId,
        status: "published",
        startsAt: new Date(Date.now() + 3_600_000),
        endsAt: new Date(Date.now() + 7_200_000),
        pageLockEnabled: false,
        ipBindingEnabled: false,
        ipWhitelistEnabled: false,
      },
    });
    const ready = teacherPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/submissions/pending" && response.ok(),
    );
    await teacherPage.goto(`/exams/${id}?tab=credentials`);
    await ready;
    await expect(teacherPage.locator("#exam-manage-tab-proctoring")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(
      teacherPage.locator('[role="tablist"]').first().getByRole("tab").last(),
    ).toHaveAttribute("id", "exam-manage-tab-settings");
    for (const password of ["ExampleOnlyPass123", "ExampleOnlyPass456"]) {
      await teacherPage.getByRole("button", { name: "Change password", exact: true }).click();
      const form = teacherPage.locator('form[action="?/updateCredentialPassword"]');
      await form.getByLabel(`Temporary password for ${user.username}`).fill(password);
      await form.getByRole("button", { name: "Save", exact: true }).click();
      await expect(teacherPage.locator("code").filter({ hasText: password })).toBeVisible();
      await expect(form).not.toBeVisible();
    }
    await capture(teacherPage, "credentials");
    await loginPage.goto("/signin");
    await loginPage
      .getByRole("button", { name: "Continue with password", exact: true })
      .click();
    const loginDialog = loginPage.getByRole("dialog");
    await expect(loginDialog.locator('input[name="username"]')).toBeVisible();
    await capture(loginPage, "password-login");
    await loginDialog.locator('input[name="username"]').fill(user.username!);
    await loginDialog.locator('input[name="password"]').fill("ExampleOnlyPass123");
    await loginPage.getByRole("button", { name: "Sign in to exam", exact: true }).click();
    await expect(loginPage.getByRole("alert")).toContainText("incorrect or has expired");
    await loginDialog.locator('input[name="password"]').fill("ExampleOnlyPass456");
    await loginPage.getByRole("button", { name: "Sign in to exam", exact: true }).click();
    await expect(loginPage).toHaveURL(new RegExp(`/exams/${id}$`));
    await expect(
      loginPage.getByRole("heading", { name: "Example exam access", exact: true }),
    ).toBeVisible();
    const temporary = await readLiveSession(loginPage);
    expect(temporary.user.id).toBe(studentId);
    expect(
      await db.examCredentialSession.findUnique({ where: { sessionId: temporary.session.id } }),
    ).toMatchObject({ revision: 2 });
  } finally {
    await teacher.close();
    await student.close();
    await guest.close();
    await db.session.deleteMany({ where: { examCredential: { credential: { examId: id } } } });
    await db.exam.deleteMany({ where: { id } });
    await db.course.deleteMany({ where: { id } });
  }
});
