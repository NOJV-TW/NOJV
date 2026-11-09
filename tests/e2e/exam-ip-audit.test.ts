import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "../../packages/db/generated/prisma/client";
import { resolveDestructiveTestDatabase } from "../setup/destructive-test-database";
import { readLiveSession, studentAuth, teacherAuth } from "./_shared";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: resolveDestructiveTestDatabase("nojv_e2e_test") }),
});
test.afterAll(async () => db.$disconnect());

test("background invalidation and automatic reload do not audit an exam entry", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const student = await browser.newContext({
    storageState: studentAuth,
    extraHTTPHeaders: { "x-dev-ip": "192.0.2.1" },
  });
  const teacher = await browser.newContext({ storageState: teacherAuth });
  const page = await student.newPage();
  const teacherPage = await teacher.newPage();
  const studentId = (await readLiveSession(page)).user.id;
  const teacherId = (await readLiveSession(teacherPage)).user.id;
  const id = `ip-audit-${randomUUID()}`;
  try {
    await db.course.create({
      data: {
        id,
        title: id,
        description: "Synthetic IP audit fixture",
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
        title: id,
        summary: "Synthetic IP audit fixture",
        status: "published",
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 3_600_000),
        ipWhitelistEnabled: true,
        ipWhitelist: ["192.0.2.0/24"],
        ipViolationMode: "block",
        pageLockEnabled: false,
      },
    });
    await db.activeExamSession.create({ data: { userId: studentId, examId: id } });
    await page.goto(`/exams/${id}`);
    await expect(page.getByRole("heading", { name: id, exact: true })).toBeVisible();
    await page.waitForTimeout(3000);
    await student.setExtraHTTPHeaders({ "x-dev-ip": "198.51.100.1" });
    await page.evaluate(() => {
      const originalNow = Date.now;
      Date.now = () => originalNow() + 5000;
      window.dispatchEvent(new Event("pageshow"));
    });
    await expect(page).toHaveURL(/\/exam-access-denied$/);
    await expect(page.getByText(/^403 —/)).toBeVisible();
    expect(await db.ipViolationLog.count({ where: { examId: id } })).toBe(0);

    await student.setExtraHTTPHeaders({ "x-dev-ip": "192.0.2.1" });
    await page.goto(`/exams/${id}`);
    await page.waitForTimeout(3000);
    await student.setExtraHTTPHeaders({ "x-dev-ip": "198.51.100.1" });
    const explicitReload = await page.reload();
    expect(explicitReload?.status()).toBe(403);
    expect(await explicitReload?.request().headerValue("sec-fetch-user")).toBe("?1");
    await expect.poll(() => db.ipViolationLog.count({ where: { examId: id } })).toBe(1);

    await db.ipViolationLog.updateMany({
      where: { examId: id },
      data: { createdAt: new Date(Date.now() - 120_000) },
    });
    await page.goto("/exams");
    await page.waitForTimeout(3000);
    await page.locator(`a[href="/exams/${id}"]`).click();
    await expect.poll(() => db.ipViolationLog.count({ where: { examId: id } })).toBe(2);
  } finally {
    await student.close();
    await teacher.close();
    await db.exam.deleteMany({ where: { id } });
    await db.course.deleteMany({ where: { id } });
  }
});
