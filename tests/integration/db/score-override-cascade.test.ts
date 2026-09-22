import { describe, expect, it } from "vitest";

import {
  createTestCourse,
  createTestExam,
  createTestProblem,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

async function fixture() {
  const teacher = await createTestUser({ platformRole: "teacher" });
  const student = await createTestUser();
  const course = await createTestCourse({ ownerId: teacher.id });
  const membership = await testPrisma.courseMembership.create({
    data: { courseId: course.id, userId: student.id, role: "student", status: "active" },
  });
  const problem = await createTestProblem({ authorId: teacher.id });
  const assignment = await testPrisma.assessment.create({
    data: {
      courseId: course.id,
      createdByUserId: teacher.id,
      title: "Homework",
      summary: "Homework",
      status: "published",
      opensAt: new Date("2020-01-01"),
      closesAt: new Date("2020-01-03"),
    },
  });
  const exam = await createTestExam({ courseId: course.id });
  return { teacher, membership, problem, assignment, exam };
}

describe("score override activity references", () => {
  it("drops an assignment's overrides and audit trail with the assignment", async () => {
    const f = await fixture();
    const override = await testPrisma.scoreOverride.create({
      data: {
        courseMembershipId: f.membership.id,
        problemId: f.problem.id,
        assessmentId: f.assignment.id,
        overrideScore: 90,
        reason: "Manual grade",
        createdByUserId: f.teacher.id,
        updatedByUserId: f.teacher.id,
      },
    });
    await testPrisma.scoreOverrideAuditLog.create({
      data: {
        overrideId: override.id,
        courseMembershipId: f.membership.id,
        problemId: f.problem.id,
        assessmentId: f.assignment.id,
        action: "create",
        newScore: 90,
        newReason: "Manual grade",
        changedByUserId: f.teacher.id,
      },
    });

    await testPrisma.assessment.delete({ where: { id: f.assignment.id } });

    expect(await testPrisma.scoreOverride.count({ where: { id: override.id } })).toBe(0);
    expect(
      await testPrisma.scoreOverrideAuditLog.findFirst({ where: { problemId: f.problem.id } }),
    ).toMatchObject({ overrideId: null, assessmentId: f.assignment.id });
  });

  it("keys exam overrides by the exam and rejects a second row for the same student and problem", async () => {
    const f = await fixture();
    const data = {
      courseMembershipId: f.membership.id,
      problemId: f.problem.id,
      examId: f.exam.id,
      overrideScore: 60,
      reason: "Manual grade",
    };
    await testPrisma.scoreOverride.create({ data });

    await expect(testPrisma.scoreOverride.create({ data })).rejects.toThrow();
    await testPrisma.exam.delete({ where: { id: f.exam.id } });
    expect(await testPrisma.scoreOverride.count({ where: { examId: f.exam.id } })).toBe(0);
  });
});
