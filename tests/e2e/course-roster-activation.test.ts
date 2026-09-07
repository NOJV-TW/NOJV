import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "../../packages/db/generated/prisma/client";
import { resolveDestructiveTestDatabase } from "../setup/destructive-test-database";
import {
  apiWriteHeaders,
  formActionHeaders,
  newStudentAuth,
  readLiveSession,
  teacherAuth,
} from "./_shared";

const testPrisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: resolveDestructiveTestDatabase("nojv_e2e_test") }),
});
test.afterAll(async () => testPrisma.$disconnect());

test("first general username setup links the same User to an already graded roster row", async ({
  browser,
}) => {
  const teacher = await browser.newContext({ storageState: teacherAuth });
  const student = await browser.newContext({ storageState: newStudentAuth });
  const page = await student.newPage();
  const { user } = await readLiveSession(page);
  const original = await testPrisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const handle = `activate_${randomUUID()}`;
  const courseId = "course_os-lab-spring-2026";
  let membershipId: string | null = null;
  try {
    const added = await teacher.request.post(`/courses/${courseId}/members?/bulkAdd`, {
      form: { handles: handle, role: "student" },
      headers: formActionHeaders,
    });
    expect((await added.json()).type).toBe("success");
    const pending = await testPrisma.courseMembership.findUniqueOrThrow({
      where: { courseId_pendingUsername: { courseId, pendingUsername: handle } },
    });
    membershipId = pending.id;
    expect(pending.userId).toBeNull();
    expect(await testPrisma.user.findUnique({ where: { username: handle } })).toBeNull();
    const problem = await testPrisma.assessmentProblem.findFirstOrThrow({
      where: { assessmentId: "hw1-process-trace" },
      orderBy: { ordinal: "asc" },
      include: { problem: { include: { testcaseSets: true } } },
    });
    const graded = await teacher.request.post("/api/overrides", {
      data: {
        context: { type: "assignment", assignmentId: problem.assessmentId },
        courseMembershipId: pending.id,
        problemId: problem.problemId,
        overrideScore: 80,
        reason: "Grade before activation",
      },
      headers: apiWriteHeaders,
    });
    expect(graded.status()).toBe(201);
    await testPrisma.user.update({
      where: { id: user.id },
      data: { username: null, displayUsername: null },
    });
    await page.goto("/complete-profile");
    await expect(
      page.getByRole("button", { name: "Open account menu for New Student", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: /General Account/ }).click();
    await page.locator("#general-username").fill(handle);
    const actionResponse = page.waitForResponse(
      (response) =>
        response.url().includes("?/setUsername") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const response = await actionResponse;
    expect(response.request().headers().accept).toBe("application/json");
    expect((await response.json()).type).toBe("success");
    await expect(page).toHaveURL(/\/dashboard$/);
    expect((await readLiveSession(page)).user.id).toBe(user.id);
    expect(
      await testPrisma.courseMembership.findUnique({ where: { id: pending.id } }),
    ).toMatchObject({ userId: user.id, pendingUsername: null, role: "student" });
    await page.goto(`/courses/${courseId}/grades`);
    await expect(page.getByRole("heading", { name: "My grades" })).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    const rawMax = problem.problem.testcaseSets.reduce((sum, set) => sum + set.weight, 0);
    const weightedScore = Number(((80 / rawMax) * Number(problem.points)).toFixed(2));
    await expect(page.locator("tbody tr td").last()).toHaveText(String(weightedScore));
    expect(await testPrisma.participation.count({ where: { userId: user.id } })).toBe(0);
  } finally {
    if (membershipId) await testPrisma.courseMembership.delete({ where: { id: membershipId } });
    await testPrisma.user.update({
      where: { id: user.id },
      data: { username: original.username, displayUsername: original.displayUsername },
    });
    await teacher.close();
    await student.close();
  }
});
