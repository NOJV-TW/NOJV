import { describe, expect, it } from "vitest";

import { adminDomain } from "@nojv/application";

import {
  createTestContest,
  createTestCourse,
  createTestExam,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

function actorOf(user: {
  email: string;
  id: string;
  name: string;
  platformRole: "admin" | "student" | "teacher";
  username: string;
}) {
  return {
    displayName: user.name,
    email: user.email,
    platformRole: user.platformRole,
    userId: user.id,
    username: user.username,
  };
}

describe("Admin global content visibility", () => {
  it("lists content without adding the Admin as a course member", async () => {
    const admin = await createTestUser({ platformRole: "admin" });
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });
    const assignment = await testPrisma.assessment.create({
      data: {
        closesAt: new Date("2030-01-03T00:00:00.000Z"),
        courseId: course.id,
        createdByUserId: teacher.id,
        opensAt: new Date("2030-01-01T00:00:00.000Z"),
        status: "draft",
        summary: "Admin visibility",
        title: "Private assignment",
      },
    });
    const exam = await createTestExam({
      courseId: course.id,
      createdByUserId: teacher.id,
      status: "draft",
    });
    const contest = await createTestContest({
      createdByUserId: teacher.id,
      visibility: "draft",
    });

    const [courses, assignments, exams, contests] = await Promise.all([
      adminDomain.listAllCoursesForAdmin(actorOf(admin)),
      adminDomain.listAllAssignmentsForAdmin(actorOf(admin)),
      adminDomain.listAllExamsForAdmin(actorOf(admin)),
      adminDomain.listAllContestsForAdmin(actorOf(admin)),
    ]);

    expect(courses).toContainEqual(expect.objectContaining({ id: course.id }));
    expect(assignments).toContainEqual(
      expect.objectContaining({ id: assignment.id, ownerDisplayName: teacher.name }),
    );
    expect(exams).toContainEqual(expect.objectContaining({ id: exam.id }));
    expect(contests).toContainEqual(expect.objectContaining({ id: contest.id }));
    expect(
      await testPrisma.courseMembership.findUnique({
        where: { courseId_userId: { courseId: course.id, userId: admin.id } },
      }),
    ).toBeNull();
  });

  it("rejects non-Admin callers", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    await expect(adminDomain.listAllCoursesForAdmin(actorOf(teacher))).rejects.toThrow(
      "Admin access required",
    );
  });
});
