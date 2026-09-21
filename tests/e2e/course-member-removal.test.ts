import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../packages/db/generated/prisma/client";
import { resolveDestructiveTestDatabase } from "../setup/destructive-test-database";
import { formActionHeaders, teacherAuth } from "./_shared";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: resolveDestructiveTestDatabase("nojv_e2e_test") }),
});
test.afterAll(async () => db.$disconnect());

test("a course TA can remove students but cannot remove staff or promote students", async ({
  browser,
}) => {
  const actor = await db.user.findUniqueOrThrow({ where: { email: "teacher@nojv.local" } });
  const owner = await db.user.findUniqueOrThrow({ where: { email: "admin@nojv.local" } });
  const linkedStudent = await db.user.findUniqueOrThrow({
    where: { email: "student@nojv.local" },
  });
  const course = await db.course.create({
    data: {
      title: "Removal permission regression",
      description: "Temporary E2E fixture",
      ownerId: owner.id,
      memberships: {
        create: [
          { userId: owner.id, role: "teacher" },
          { userId: actor.id, role: "ta" },
          { pendingUsername: `remove_${randomUUID()}`, role: "student" },
          { userId: linkedStudent.id, role: "student" },
          { pendingUsername: `ta_${randomUUID()}`, role: "ta" },
          { pendingUsername: `teacher_${randomUUID()}`, role: "teacher" },
        ],
      },
    },
    include: { memberships: true },
  });
  const member = course.memberships.find(
    (row) => row.role === "student" && row.pendingUsername,
  )!;
  const context = await browser.newContext({ storageState: teacherAuth });
  try {
    const page = await context.newPage();
    await page.goto(`/courses/${course.id}/members`);
    await expect(
      page.getByRole("button", { name: "Open account menu for Teacher", exact: true }),
    ).toBeEnabled({ timeout: 20_000 });
    await expect(page.locator('input[name="role"][value="ta"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Change role for/ })).toHaveCount(0);
    for (const staff of course.memberships.filter((entry) => entry.role !== "student")) {
      await expect(
        page
          .locator(`[data-membership-id="${staff.id}"]`)
          .getByRole("button", { name: "Remove member", exact: true }),
      ).toHaveCount(0);
      const denied = await page.request.post(`/courses/${course.id}/members?/remove`, {
        headers: formActionHeaders,
        form: { membershipId: staff.id },
      });
      expect(await denied.json()).toMatchObject({ type: "failure", status: 403 });
      expect(await db.courseMembership.findUnique({ where: { id: staff.id } })).toMatchObject({
        status: "active",
      });
    }
    const promotion = await page.request.post(`/courses/${course.id}/members?/changeRole`, {
      headers: formActionHeaders,
      form: { membershipId: member.id, role: "ta" },
    });
    expect(await promotion.json()).toMatchObject({ type: "failure", status: 403 });
    const addTa = await page.request.post(`/courses/${course.id}/members?/bulkAdd`, {
      headers: formActionHeaders,
      form: { handles: member.pendingUsername!, role: "ta" },
    });
    expect(await addTa.json()).toMatchObject({ type: "failure", status: 403 });
    expect(await db.courseMembership.findUnique({ where: { id: member.id } })).toMatchObject({
      role: "student",
    });
    for (const member of course.memberships.filter((entry) => entry.role === "student")) {
      const row = page.locator(`[data-membership-id="${member.id}"]`);
      await row.getByRole("button", { name: "Remove member", exact: true }).click();
      const response = page.waitForResponse((res) => res.url().includes("?/remove"));
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Remove member", exact: true })
        .click();
      expect(await (await response).json()).toMatchObject({ type: "success" });
      await expect(row).toHaveCount(0);
      expect(await db.courseMembership.findUnique({ where: { id: member.id } })).toMatchObject({
        status: "removed",
        removedAt: expect.any(Date),
      });
    }
  } finally {
    await context.close();
    await db.course.delete({ where: { id: course.id } });
  }
});

for (const role of ["student", "ta"] as const) {
  for (const linked of [false, true]) {
    test(`teacher removes ${linked ? "linked" : "pending"} ${role} through the confirmation dialog`, async ({
      browser,
    }) => {
      const courseId = "course_os-lab-spring-2026";
      const username = `remove_${randomUUID()}`;
      const user = linked
        ? await db.user.create({
            data: { username, email: `${username}@example.test`, name: username },
          })
        : null;
      const member = await db.courseMembership.create({
        data: { courseId, userId: user?.id, pendingUsername: user ? null : username, role },
      });
      const context = await browser.newContext({ storageState: teacherAuth });
      try {
        const page = await context.newPage();
        await page.goto(`/courses/${courseId}/members`);
        await expect(
          page.getByRole("button", { name: "Open account menu for Teacher", exact: true }),
        ).toBeEnabled({ timeout: 20_000 });
        const row = page.locator(`[data-membership-id="${member.id}"]`);
        await row.getByRole("button", { name: "Remove member", exact: true }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        const response = page.waitForResponse((res) => res.url().includes("?/remove"));
        await dialog.getByRole("button", { name: "Remove member", exact: true }).click();
        expect((await response).status()).toBe(200);
        await expect(row).toHaveCount(0);
        expect(
          await db.courseMembership.findUnique({ where: { id: member.id } }),
        ).toMatchObject({
          status: "removed",
          removedAt: expect.any(Date),
        });
      } finally {
        await context.close();
        await db.courseMembership.delete({ where: { id: member.id } });
        if (user) await db.user.delete({ where: { id: user.id } });
      }
    });
  }
}
