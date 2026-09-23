import { describe, expect, it } from "vitest";

import { notificationRepo } from "@nojv/db";
import { courseDomain, userDomain } from "@nojv/application";

import { createTestCourse, createTestUser, testPrisma } from "../../fixtures/factories";

async function setupCourse() {
  const teacher = await createTestUser({ platformRole: "admin" });
  const course = await createTestCourse({ ownerId: teacher.id });
  const actor = {
    userId: teacher.id,
    username: teacher.username!,
    displayName: teacher.name,
    email: teacher.email,
    platformRole: teacher.platformRole,
  };
  return { actor, course };
}

describe("course enrollment notifications", () => {
  it("notifies a real student once and sends no notification to a pending roster row", async () => {
    const { actor, course } = await setupCourse();
    const student = await createTestUser({ username: "alice" });
    await courseDomain.bulkAddByHandle(actor, course.id, {
      handles: ["alice", "future_student"],
      role: "student",
    });
    await courseDomain.bulkAddByHandle(actor, course.id, {
      handles: ["alice", "future_student"],
      role: "student",
    });
    const rows = await notificationRepo.listRecent(student.id, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "course_enrolled",
      linkUrl: `/courses/${course.id}`,
      params: { courseId: course.id, courseName: course.title },
    });
    expect(await testPrisma.notification.count()).toBe(1);
    const future = await createTestUser({ username: "future_student" });
    await userDomain.linkUserCourseRoster(future.id);
    await userDomain.linkUserCourseRoster(future.id);
    expect(await notificationRepo.listRecent(future.id, 10)).toHaveLength(1);
  });

  it.each(["teacher", "ta"] as const)(
    "does not send student enrollment notifications to a %s",
    async (role) => {
      const { actor, course } = await setupCourse();
      const user = await createTestUser({ username: "staff_member" });
      await courseDomain.bulkAddByHandle(actor, course.id, { handles: ["staff_member"], role });
      expect(await notificationRepo.listRecent(user.id, 10)).toHaveLength(0);
    },
  );
});
