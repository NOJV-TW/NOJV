import { beforeEach, describe, expect, it } from "vitest";

import { notificationRepo } from "@nojv/db";
import { notificationDomain } from "@nojv/application";

import {
  createTestCourse,
  createTestProblem,
  createTestSubmission,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

describe("notificationDomain.fanoutAssignmentDueSoon", () => {
  beforeEach(async () => {
    await testPrisma.$executeRawUnsafe('TRUNCATE TABLE "Notification" CASCADE');
  });

  it("notifies only students below max score", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });

    const problemA = await createTestProblem({ authorId: teacher.id });
    const problemB = await createTestProblem({ authorId: teacher.id });
    await testPrisma.testcaseSet.updateMany({
      where: { problemId: { in: [problemA.id, problemB.id] } },
      data: { weight: 10 },
    });

    const closesAt = new Date(Date.now() + 48 * 3600_000);
    const assessment = await testPrisma.assessment.create({
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
    await testPrisma.assessmentProblem.createMany({
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

    await createTestSubmission({
      userId: studentA.id,
      problemId: problemA.id,
      courseId: course.id,
      assessmentId: assessment.id,
      status: "accepted",
      score: 10,
    });
    await createTestSubmission({
      userId: studentA.id,
      problemId: problemB.id,
      courseId: course.id,
      assessmentId: assessment.id,
      status: "accepted",
      score: 10,
    });
    await createTestSubmission({
      userId: studentB.id,
      problemId: problemA.id,
      courseId: course.id,
      assessmentId: assessment.id,
      status: "accepted",
      score: 10,
    });
    await createTestSubmission({
      userId: studentB.id,
      problemId: problemB.id,
      courseId: course.id,
      assessmentId: assessment.id,
      status: "wrong_answer",
      score: 5,
    });

    await notificationDomain.fanoutAssignmentDueSoon(assessment.id, 3);

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
      assignmentId: string;
      courseId: string;
      title: string;
      dueAt: string;
    };
    expect(params.assignmentId).toBe(assessment.id);
    expect(params.courseId).toBe(course.id);
    expect(params.title).toBe("HW 1");
    expect(params.dueAt).toBe(closesAt.toISOString());
  });

  it("is idempotent — a re-run (activity retry) does not duplicate notifications", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });
    const student = await createTestUser({ platformRole: "student" });
    await testPrisma.courseMembership.create({
      data: { courseId: course.id, userId: student.id, role: "student", status: "active" },
    });

    const assessment = await testPrisma.assessment.create({
      data: {
        courseId: course.id,
        createdByUserId: teacher.id,
        title: "Due Soon",
        summary: "Not yet maxed",
        status: "published",
        opensAt: new Date(Date.now() - 3600_000),
        closesAt: new Date(Date.now() + 24 * 3600_000),
      },
    });

    await notificationDomain.fanoutAssignmentDueSoon(assessment.id, 3);
    await notificationDomain.fanoutAssignmentDueSoon(assessment.id, 3);

    const rows = await notificationRepo.listRecent(student.id, 10);
    expect(rows).toHaveLength(1);
  });

  it("is a no-op when the assessment is already closed", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });
    const student = await createTestUser({ platformRole: "student" });
    await testPrisma.courseMembership.create({
      data: { courseId: course.id, userId: student.id, role: "student", status: "active" },
    });

    const assessment = await testPrisma.assessment.create({
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

    await notificationDomain.fanoutAssignmentDueSoon(assessment.id, 3);

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

    const assessment = await testPrisma.assessment.create({
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

    await notificationDomain.fanoutAssignmentDueSoon(assessment.id, 3);

    const rows = await notificationRepo.listRecent(student.id, 10);
    expect(rows).toHaveLength(0);
  });

  it("targets only students whose lead-day preference matches the checkpoint", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });

    const assessment = await testPrisma.assessment.create({
      data: {
        courseId: course.id,
        createdByUserId: teacher.id,
        title: "Lead Days",
        summary: "Per-user lead days",
        status: "published",
        opensAt: new Date(Date.now() - 7 * 24 * 3600_000),
        closesAt: new Date(Date.now() + 5 * 24 * 3600_000),
      },
    });

    const wantsThree = await createTestUser({ platformRole: "student" });
    const wantsOne = await createTestUser({ platformRole: "student" });
    const wantsDefault = await createTestUser({ platformRole: "student" });
    for (const s of [wantsThree, wantsOne, wantsDefault]) {
      await testPrisma.courseMembership.create({
        data: { courseId: course.id, userId: s.id, role: "student", status: "active" },
      });
    }
    await testPrisma.notificationPreference.create({
      data: { userId: wantsThree.id, assignmentDueSoonLeadDays: 3 },
    });
    await testPrisma.notificationPreference.create({
      data: { userId: wantsOne.id, assignmentDueSoonLeadDays: 1 },
    });

    await notificationDomain.fanoutAssignmentDueSoon(assessment.id, 3);

    expect(await notificationRepo.listRecent(wantsThree.id, 10)).toHaveLength(1);
    expect(await notificationRepo.listRecent(wantsOne.id, 10)).toHaveLength(0);
    expect(await notificationRepo.listRecent(wantsDefault.id, 10)).toHaveLength(1);

    await testPrisma.$executeRawUnsafe('TRUNCATE TABLE "Notification" CASCADE');
    await notificationDomain.fanoutAssignmentDueSoon(assessment.id, 1);

    expect(await notificationRepo.listRecent(wantsThree.id, 10)).toHaveLength(0);
    expect(await notificationRepo.listRecent(wantsOne.id, 10)).toHaveLength(1);
    expect(await notificationRepo.listRecent(wantsDefault.id, 10)).toHaveLength(0);
  });
});

describe("notificationDomain.fanoutAssignmentStarted", () => {
  beforeEach(async () => {
    await testPrisma.$executeRawUnsafe('TRUNCATE TABLE "Notification" CASCADE');
  });

  it("notifies every active student regardless of score, once per student", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });

    const problem = await createTestProblem({ authorId: teacher.id });
    await testPrisma.testcaseSet.updateMany({
      where: { problemId: problem.id },
      data: { weight: 10 },
    });

    const assessment = await testPrisma.assessment.create({
      data: {
        courseId: course.id,
        createdByUserId: teacher.id,
        title: "Kickoff",
        summary: "Started",
        status: "published",
        opensAt: new Date(Date.now() - 3600_000),
        closesAt: new Date(Date.now() + 48 * 3600_000),
      },
    });
    await testPrisma.assessmentProblem.create({
      data: { assessmentId: assessment.id, problemId: problem.id, ordinal: 1, points: 10 },
    });

    const maxed = await createTestUser({ platformRole: "student" });
    const fresh = await createTestUser({ platformRole: "student" });
    for (const s of [maxed, fresh]) {
      await testPrisma.courseMembership.create({
        data: { courseId: course.id, userId: s.id, role: "student", status: "active" },
      });
    }
    await createTestSubmission({
      userId: maxed.id,
      problemId: problem.id,
      courseId: course.id,
      assessmentId: assessment.id,
      status: "accepted",
      score: 10,
    });

    await notificationDomain.fanoutAssignmentStarted(assessment.id);
    await notificationDomain.fanoutAssignmentStarted(assessment.id);

    const rowsMaxed = await notificationRepo.listRecent(maxed.id, 10);
    const rowsFresh = await notificationRepo.listRecent(fresh.id, 10);
    expect(rowsMaxed).toHaveLength(1);
    expect(rowsFresh).toHaveLength(1);

    const row = rowsFresh[0]!;
    expect(row.type).toBe("assignment_started");
    expect(row.linkUrl).toBe(`/assignments/${assessment.id}`);
    const params = row.params as { assignmentId: string; courseId: string; title: string };
    expect(params.assignmentId).toBe(assessment.id);
    expect(params.courseId).toBe(course.id);
    expect(params.title).toBe("Kickoff");
  });
});
