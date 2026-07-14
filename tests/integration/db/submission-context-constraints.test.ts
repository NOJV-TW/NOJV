import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createTestContest,
  createTestCourse,
  createTestExam,
  createTestProblem,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

const sourceStorage = {
  key: "submissions/context-test/source-generations/v1/manifest.json",
  sha256: "a".repeat(64),
  size: 1,
};

describe("Submission canonical context constraints", () => {
  it("accepts exactly the five canonical context states", async () => {
    const owner = await createTestUser({ platformRole: "teacher" });
    const student = await createTestUser();
    const problem = await createTestProblem({ authorId: owner.id });
    const course = await createTestCourse({ ownerId: owner.id });
    const assessment = await testPrisma.assessment.create({
      data: {
        courseId: course.id,
        createdByUserId: owner.id,
        title: "Canonical assignment",
        summary: "Canonical assignment summary",
        opensAt: new Date("2026-01-01T00:00:00Z"),
        closesAt: new Date("2027-01-01T00:00:00Z"),
      },
    });
    const exam = await createTestExam({ courseId: course.id });
    const contest = await createTestContest();
    const virtual = await testPrisma.participation.create({
      data: {
        type: "virtual",
        userId: student.id,
        contestId: contest.id,
        status: "active",
        startedAt: new Date("2026-01-01T00:00:00Z"),
        endsAt: new Date("2026-01-01T02:00:00Z"),
      },
    });
    const common = {
      userId: student.id,
      problemId: problem.id,
      language: "cpp" as const,
      sourceStorage,
    };

    const rows = await testPrisma.$transaction([
      testPrisma.submission.create({ data: { id: randomUUID(), ...common } }),
      testPrisma.submission.create({
        data: {
          id: randomUUID(),
          ...common,
          assessmentId: assessment.id,
          courseId: course.id,
        },
      }),
      testPrisma.submission.create({
        data: { id: randomUUID(), ...common, examId: exam.id },
      }),
      testPrisma.submission.create({
        data: { id: randomUUID(), ...common, contestId: contest.id },
      }),
      testPrisma.submission.create({
        data: { id: randomUUID(), ...common, participationId: virtual.id },
      }),
    ]);

    expect(rows).toHaveLength(5);
  });

  it("rejects every mixed, incomplete, mismatched, or non-virtual direct write", async () => {
    const owner = await createTestUser({ platformRole: "teacher" });
    const student = await createTestUser();
    const otherStudent = await createTestUser();
    const problem = await createTestProblem({ authorId: owner.id });
    const course = await createTestCourse({ ownerId: owner.id });
    const otherCourse = await createTestCourse({ ownerId: owner.id });
    const assessment = await testPrisma.assessment.create({
      data: {
        courseId: course.id,
        createdByUserId: owner.id,
        title: "Constraint assignment",
        summary: "Constraint assignment summary",
        opensAt: new Date("2026-01-01T00:00:00Z"),
        closesAt: new Date("2027-01-01T00:00:00Z"),
      },
    });
    const exam = await createTestExam({ courseId: course.id });
    const contest = await createTestContest();
    const virtual = await testPrisma.participation.create({
      data: {
        type: "virtual",
        userId: student.id,
        contestId: contest.id,
        status: "active",
        startedAt: new Date("2026-01-01T00:00:00Z"),
        endsAt: new Date("2026-01-01T02:00:00Z"),
      },
    });
    const foreignVirtual = await testPrisma.participation.create({
      data: {
        type: "virtual",
        userId: otherStudent.id,
        contestId: contest.id,
        status: "active",
        startedAt: new Date("2026-01-01T00:00:00Z"),
        endsAt: new Date("2026-01-01T02:00:00Z"),
      },
    });
    const ordinaryContest = await testPrisma.participation.create({
      data: {
        type: "contest",
        userId: student.id,
        contestId: contest.id,
        status: "active",
      },
    });
    const common = {
      userId: student.id,
      problemId: problem.id,
      language: "cpp" as const,
      sourceStorage,
    };
    const invalidContexts = [
      { assessmentId: assessment.id, courseId: course.id, examId: exam.id },
      { assessmentId: assessment.id },
      { courseId: course.id },
      { assessmentId: assessment.id, courseId: otherCourse.id },
      { examId: exam.id, courseId: course.id },
      { contestId: contest.id, participationId: virtual.id },
      { participationId: foreignVirtual.id },
      { participationId: ordinaryContest.id },
    ];

    for (const context of invalidContexts) {
      await expect(
        testPrisma.submission.create({
          data: { id: randomUUID(), ...common, ...context },
        }),
      ).rejects.toThrow(
        /Submission_canonical_context_chk|Submission_assessment_course_fkey|Submission_participation_owner_fkey|Submission_virtual_participation_chk|requires a virtual participation|constraint/i,
      );
    }
  });

  it("keeps a referenced participation virtual and owned by the same user", async () => {
    const student = await createTestUser();
    const problem = await createTestProblem();
    const contest = await createTestContest();
    const virtual = await testPrisma.participation.create({
      data: {
        type: "virtual",
        userId: student.id,
        contestId: contest.id,
        status: "active",
        startedAt: new Date("2026-01-01T00:00:00Z"),
        endsAt: new Date("2026-01-01T02:00:00Z"),
      },
    });
    await testPrisma.submission.create({
      data: {
        id: randomUUID(),
        userId: student.id,
        problemId: problem.id,
        language: "cpp",
        sourceStorage,
        participationId: virtual.id,
      },
    });

    await expect(
      testPrisma.participation.update({
        where: { id: virtual.id },
        data: { type: "contest" },
      }),
    ).rejects.toThrow(/Submission_virtual_participation_chk|canonical virtual Submission/i);
  });

  it("installs and validates the canonical CHECK and composite foreign keys", async () => {
    const rows = await testPrisma.$queryRawUnsafe<
      { conname: string; convalidated: boolean }[]
    >(`
      SELECT conname, convalidated
      FROM pg_constraint
      WHERE conname IN (
        'Submission_canonical_context_chk',
        'Submission_assessment_course_fkey',
        'Submission_participation_owner_fkey'
      )
      ORDER BY conname
    `);

    expect(rows).toEqual([
      { conname: "Submission_assessment_course_fkey", convalidated: true },
      { conname: "Submission_canonical_context_chk", convalidated: true },
      { conname: "Submission_participation_owner_fkey", convalidated: true },
    ]);
  });
});
