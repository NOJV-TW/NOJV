import { describe, expect, it } from "vitest";

import { notificationRepo } from "@nojv/db";
import { courseDomain } from "@nojv/application";

import { createTestCourse, createTestUser } from "../../fixtures/factories";

interface ActorOverrides {
  platformRole?: "student" | "teacher" | "admin";
}

async function buildActor(overrides: ActorOverrides = {}) {
  const user = await createTestUser({ platformRole: overrides.platformRole ?? "teacher" });
  return {
    userId: user.id,
    username: user.username ?? user.id,
    displayName: user.name,
    email: user.email,
    platformRole: user.platformRole,
  };
}

describe("manuallyEnrollCourseMember notifications", () => {
  it("writes a course_enrolled notification for a newly enrolled student", async () => {
    const teacher = await buildActor({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.userId });

    const membership = await courseDomain.manuallyEnrollCourseMember(teacher, {
      courseId: course.id,
      displayName: "Alice Student",
      email: "alice@test.local",
      username: "alice",
      role: "student",
    });

    const rows = await notificationRepo.listRecent(membership.userId, 10);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.type).toBe("course_enrolled");
    expect(row.linkUrl).toBe(`/courses/${course.id}`);
    const params = row.params as { courseId: string; courseName: string };
    expect(params.courseId).toBe(course.id);
    expect(params.courseName).toBe(course.title);
  });

  it("does NOT write a notification when enrolling a teacher", async () => {
    const teacher = await buildActor({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.userId });

    const membership = await courseDomain.manuallyEnrollCourseMember(teacher, {
      courseId: course.id,
      displayName: "Ted Teacher",
      email: "ted@test.local",
      username: "ted",
      role: "teacher",
    });

    const rows = await notificationRepo.listRecent(membership.userId, 10);
    expect(rows).toHaveLength(0);
  });

  it("does NOT write a notification when enrolling a TA", async () => {
    const teacher = await buildActor({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.userId });

    const membership = await courseDomain.manuallyEnrollCourseMember(teacher, {
      courseId: course.id,
      displayName: "Tara TA",
      email: "tara@test.local",
      username: "tara",
      role: "ta",
    });

    const rows = await notificationRepo.listRecent(membership.userId, 10);
    expect(rows).toHaveLength(0);
  });
});
