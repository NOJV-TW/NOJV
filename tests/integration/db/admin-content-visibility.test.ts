import { describe, expect, it } from "vitest";

import {
  adminDomain,
  assignmentDomain,
  contestDomain,
  courseDomain,
  examDomain,
} from "@nojv/application";

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
  it("lets a regular admin list and edit all content without course membership", async () => {
    const admin = await createTestUser({ platformRole: "admin", isSuperAdmin: false });
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
    const actor = actorOf(admin);
    const personalActor = { ...actor, platformRole: "student" as const };
    const edits = [
      (viewer: typeof actor) =>
        courseDomain.updateCourse(viewer, course.id, {
          title: "Admin course",
          description: "Updated",
        }),
      (viewer: typeof actor) =>
        assignmentDomain.updateAssignmentRecord(viewer, assignment.id, {
          title: "Admin assignment",
        }),
      (viewer: typeof actor) =>
        examDomain.updateExamRecord(viewer, exam.id, { title: "Admin exam" }),
      (viewer: typeof actor) =>
        contestDomain.updateContestRecord(viewer, contest.id, { title: "Admin contest" }),
    ];
    for (const edit of edits) {
      await expect(edit(personalActor)).rejects.toThrow();
      await edit(actor);
    }
    expect(
      await testPrisma.course.findUniqueOrThrow({ where: { id: course.id } }),
    ).toMatchObject({ title: "Admin course" });
    expect(
      await testPrisma.assessment.findUniqueOrThrow({ where: { id: assignment.id } }),
    ).toMatchObject({ title: "Admin assignment" });
    expect(await testPrisma.exam.findUniqueOrThrow({ where: { id: exam.id } })).toMatchObject({
      title: "Admin exam",
    });
    expect(
      await testPrisma.contest.findUniqueOrThrow({ where: { id: contest.id } }),
    ).toMatchObject({ title: "Admin contest" });
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
