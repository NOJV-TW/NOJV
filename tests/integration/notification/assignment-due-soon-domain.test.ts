import { beforeEach, describe, expect, it } from "vitest";

import { notificationRepo } from "@nojv/db";
import { notificationDomain } from "@nojv/domain";

import {
  createTestCourse,
  createTestProblem,
  createTestSubmission,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

// Notification is NOT in the shared TABLES list truncated by integration-setup,
// so clear it locally (same pattern as notification-domain.test.ts).
describe("notificationDomain.fanoutAssignmentDueSoon", () => {
  beforeEach(async () => {
    await testPrisma.$executeRawUnsafe('TRUNCATE TABLE "Notification" CASCADE');
  });

  it("notifies only students below max score", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });

    const problemA = await createTestProblem({ authorId: teacher.id });
    const problemB = await createTestProblem({ authorId: teacher.id });

    // Assessment closes in 48h — two 10-point problems, max 20.
    const closesAt = new Date(Date.now() + 48 * 3600_000);
    const assessment = await testPrisma.courseAssessment.create({
      data: {
        courseId: course.id,
        createdByUserId: teacher.id,
        title: "HW 1",
        summary: "Due soon test",
        status: "published",
        opensAt: new Date(Date.now() - 3600_000),
        closesAt,
      },
    });
    await testPrisma.courseAssessmentProblem.createMany({
      data: [
        { assessmentId: assessment.id, problemId: problemA.id, ordinal: 1, points: 10 },
        { assessmentId: assessment.id, problemId: problemB.id, ordinal: 2, points: 10 },
      ],
    });

    const studentA = await createTestUser({ platformRole: "student" });
    const studentB = await createTestUser({ platformRole: "student" });
    const studentC = await createTestUser({ platformRole: "student" });
    for (const s of [studentA, studentB, studentC]) {
      await testPrisma.courseMembership.create({
        data: {
          courseId: course.id,
          userId: s.id,
          role: "student",
          status: "active",
        },
      });
    }

    // Student A maxes out (10 + 10 = 20).
    await createTestSubmission({
      userId: studentA.id,
      problemId: problemA.id,
      courseId: course.id,
      courseAssessmentId: assessment.id,
      status: "accepted",
      score: 10,
    });
    await createTestSubmission({
      userId: studentA.id,
      problemId: problemB.id,
      courseId: course.id,
      courseAssessmentId: assessment.id,
      status: "accepted",
      score: 10,
    });
    // Student B partially scores (10 + 5 = 15).
    await createTestSubmission({
      userId: studentB.id,
      problemId: problemA.id,
      courseId: course.id,
      courseAssessmentId: assessment.id,
      status: "accepted",
      score: 10,
    });
    await createTestSubmission({
      userId: studentB.id,
      problemId: problemB.id,
      courseId: course.id,
      courseAssessmentId: assessment.id,
      status: "wrong_answer",
      score: 5,
    });
    // Student C makes no submissions (score 0).

    await notificationDomain.fanoutAssignmentDueSoon(assessment.id);

    const rowsA = await notificationRepo.listRecent(studentA.id, 10);
    const rowsB = await notificationRepo.listRecent(studentB.id, 10);
    const rowsC = await notificationRepo.listRecent(studentC.id, 10);

    expect(rowsA).toHaveLength(0);
    expect(rowsB).toHaveLength(1);
    expect(rowsC).toHaveLength(1);

    const rowB = rowsB[0]!;
    expect(rowB.type).toBe("assignment_due_soon");
    expect(rowB.linkUrl).toBe(`/assignments/${assessment.id}`);
    const params = rowB.params as {
      assessmentId: string;
      courseId: string;
      title: string;
      dueAt: string;
    };
    expect(params.assessmentId).toBe(assessment.id);
    expect(params.courseId).toBe(course.id);
    expect(params.title).toBe("HW 1");
    expect(params.dueAt).toBe(closesAt.toISOString());
  });

  it("is a no-op when the assessment is already closed", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });
    const student = await createTestUser({ platformRole: "student" });
    await testPrisma.courseMembership.create({
      data: { courseId: course.id, userId: student.id, role: "student", status: "active" },
    });

    const assessment = await testPrisma.courseAssessment.create({
      data: {
        courseId: course.id,
        createdByUserId: teacher.id,
        title: "Past Due",
        summary: "Closed already",
        status: "published",
        opensAt: new Date(Date.now() - 7 * 24 * 3600_000),
        closesAt: new Date(Date.now() - 3600_000),
      },
    });

    await notificationDomain.fanoutAssignmentDueSoon(assessment.id);

    const rows = await notificationRepo.listRecent(student.id, 10);
    expect(rows).toHaveLength(0);
  });

  it("is a no-op when the assessment is still a draft", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });
    const student = await createTestUser({ platformRole: "student" });
    await testPrisma.courseMembership.create({
      data: { courseId: course.id, userId: student.id, role: "student", status: "active" },
    });

    const assessment = await testPrisma.courseAssessment.create({
      data: {
        courseId: course.id,
        createdByUserId: teacher.id,
        title: "Draft",
        summary: "Not live yet",
        status: "draft",
        opensAt: new Date(Date.now() + 3600_000),
        closesAt: new Date(Date.now() + 48 * 3600_000),
      },
    });

    await notificationDomain.fanoutAssignmentDueSoon(assessment.id);

    const rows = await notificationRepo.listRecent(student.id, 10);
    expect(rows).toHaveLength(0);
  });
});
