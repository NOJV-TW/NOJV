import { randomUUID } from "node:crypto";
import { createStorageClient, putSubmissionSources, deleteBlobsByPrefix } from "@nojv/storage";
import { PLAYWRIGHT_STORAGE_ENVIRONMENT } from "../setup/playwright-environment";
import { PrismaPg } from "@prisma/adapter-pg";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "../../packages/db/generated/prisma/client";
import { resolveDestructiveTestDatabase } from "../setup/destructive-test-database";
import { formActionHeaders, readLiveSession, studentAuth, teacherAuth } from "./_shared";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: resolveDestructiveTestDatabase("nojv_e2e_test") }),
});
test.afterAll(async () => db.$disconnect());

async function openTrackedWorkspace(page: Page, navigate: () => Promise<unknown>) {
  const ready = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/submissions/pending" && response.ok(),
  );
  await navigate();
  await ready;
}

for (const kind of ["assignment", "exam"] as const) {
  test(`${kind}: recovers A on B after reload, new tab, reconnect and reaches 151 history rows`, async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    Object.assign(process.env, PLAYWRIGHT_STORAGE_ENVIRONMENT);
    const storage = createStorageClient();
    const student = await browser.newContext({ storageState: studentAuth });
    const teacher = await browser.newContext({ storageState: teacherAuth });
    const page = await student.newPage();
    const teacherPage = await teacher.newPage();
    const userId = (await readLiveSession(page)).user.id;
    const teacherId = (await readLiveSession(teacherPage)).user.id;
    const id = `tracking-${randomUUID()}`;
    const problemA = `${id}_a`;
    const problemB = `${id}_b`;
    const pendingId = `${id}_pending`;
    const workspace = (problem: string) =>
      `/${kind === "exam" ? "exams" : "assignments"}/${id}/problems/${problem}`;
    const submissionContext =
      kind === "exam" ? { examId: id } : { assessmentId: id, courseId: id };
    try {
      await db.course.create({
        data: {
          id,
          title: "Tracking regression",
          description: "",
          ownerId: teacherId,
          memberships: {
            create: [
              { userId: teacherId, role: "teacher" },
              { userId, role: "student" },
            ],
          },
        },
      });
      for (const [problemId, title] of [
        [problemA, "Tracking A"],
        [problemB, "Tracking B"],
      ] as const) {
        await db.problem.create({
          data: {
            id: problemId,
            title,
            authorId: teacherId,
            status: "published",
            visibility: "private",
            timeLimitMs: 1000,
            memoryLimitMb: 256,
            testcaseSets: { create: { name: "All cases", weight: 100 } },
            statement: {
              create: {
                bodyMarkdown: "Return the sum.",
                inputFormat: "Two integers",
                outputFormat: "Their sum",
              },
            },
          },
        });
      }
      if (kind === "assignment")
        await db.assessment.create({
          data: {
            id,
            courseId: id,
            title: "Tracking assignment",
            summary: "",
            createdByUserId: teacherId,
            status: "published",
            opensAt: new Date(Date.now() - 60_000),
            closesAt: new Date(Date.now() + 3_600_000),
            problems: {
              create: [
                { problemId: problemA, ordinal: 1, points: 50 },
                { problemId: problemB, ordinal: 2, points: 50 },
              ],
            },
          },
        });
      if (kind === "exam") {
        await db.exam.create({
          data: {
            id,
            courseId: id,
            title: "Tracking exam",
            summary: "",
            createdByUserId: teacherId,
            status: "published",
            pageLockEnabled: true,
            startsAt: new Date(Date.now() - 60_000),
            endsAt: new Date(Date.now() + 3_600_000),
            problems: {
              create: [
                { problemId: problemA, ordinal: 1, points: 50 },
                { problemId: problemB, ordinal: 2, points: 50 },
              ],
            },
          },
        });
        const start = await page.request.post(`/exams/${id}?/startExam`, {
          form: {},
          headers: formActionHeaders,
        });
        expect(await start.json()).toMatchObject({ type: "success" });
      }
      const sourceStorage = await putSubmissionSources(storage, pendingId, "fixture", [
        { path: "main.py", content: "print(1)" },
      ]);
      await db.submission.create({
        data: {
          id: pendingId,
          userId,
          problemId: problemA,
          ...submissionContext,
          sourceStorage,
          language: "python",
          status: "running",
          judgeGeneration: 1,
        },
      });
      await openTrackedWorkspace(page, () => page.goto(workspace(problemB)));
      await expect(page.locator('a[title="B · Tracking B"]')).toHaveAttribute(
        "aria-current",
        "page",
      );
      await openTrackedWorkspace(page, () => page.reload());
      const secondTab = await student.newPage();
      await openTrackedWorkspace(secondTab, () => secondTab.goto(workspace(problemB)));
      await student.setOffline(true);
      // Fixture-controlled completion exercises the real API and UI without depending on worker timing.
      await db.submission.update({
        where: { id: pendingId },
        data: {
          status: "accepted",
          score: 100,
          runtimeMs: 1,
          verdictSummary: {
            accepted: true,
            verdict: "accepted",
            score: 100,
            runtimeMs: 1,
            feedback: "Accepted",
          },
        },
      });
      await student.setOffline(false);
      for (const tab of [page, secondTab]) {
        await tab.bringToFront();
        await expect(tab.locator('a[title="A · Tracking A"]')).toHaveClass(/bg-success/, {
          timeout: 20_000,
        });
        await expect(tab.locator('a[title="B · Tracking B"]')).toHaveAttribute(
          "aria-current",
          "page",
        );
      }
      await db.submission.createMany({
        data: Array.from({ length: 150 }, (_, index) => ({
          id: `${id}_history_${String(index).padStart(3, "0")}`,
          userId,
          problemId: problemA,
          ...submissionContext,
          sourceStorage,
          language: "python" as const,
          status: "accepted" as const,
          score: 100,
          createdAt: new Date(Date.now() - 30_000),
        })),
      });
      await page.bringToFront();
      await page.locator('a[title="A · Tracking A"]').click();
      await expect(page.locator('a[title="A · Tracking A"]')).toHaveAttribute(
        "aria-current",
        "page",
      );
      await page.getByRole("tab", { name: "Submissions", exact: true }).click();
      const history = page.locator("[data-history-scroll]");
      await expect(history.getByRole("button").filter({ hasText: "AC" })).toHaveCount(50);
      for (const count of [100, 150, 151]) {
        await history.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        await expect(history.getByRole("button").filter({ hasText: "AC" })).toHaveCount(count);
      }
      await expect(history.getByText("Judging", { exact: true })).toHaveCount(0);
    } finally {
      await student.setOffline(false);
      await student.close();
      await teacher.close();
      await db.submission.deleteMany({ where: submissionContext });
      await db.exam.deleteMany({ where: { id } });
      await db.assessment.deleteMany({ where: { id } });
      await db.course.deleteMany({ where: { id } });
      await db.problem.deleteMany({ where: { id: { in: [problemA, problemB] } } });
      await deleteBlobsByPrefix(storage, `submissions/${pendingId}/`);
      storage.destroy();
    }
  });
}
