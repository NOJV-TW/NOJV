import { describe, expect, it } from "vitest";
import {
  assignmentDomain,
  courseDomain,
  examDomain,
  auditDomain,
  problemDomain,
} from "@nojv/application";
import { gradingRepo, participationRepo, runTransaction } from "@nojv/db";
import { updateExamScores } from "../../../packages/application/src/exam/scoring";
import {
  createTestCourse,
  createTestExam,
  createTestProblem,
  createTestSubmission,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

async function fixture() {
  const teacher = await createTestUser({ platformRole: "teacher" });
  const student = await createTestUser();
  const course = await createTestCourse({ ownerId: teacher.id });
  await testPrisma.courseMembership.createMany({
    data: [
      { courseId: course.id, userId: teacher.id, role: "teacher", status: "active" },
      { courseId: course.id, userId: student.id, role: "student", status: "active" },
    ],
  });
  const a = await createTestProblem({ authorId: teacher.id, visibility: "private" });
  const b = await createTestProblem({ authorId: teacher.id, visibility: "private" });
  await testPrisma.testcaseSet.updateMany({
    where: { problemId: a.id },
    data: { weight: 200 },
  });
  await testPrisma.testcaseSet.updateMany({
    where: { problemId: b.id },
    data: { weight: 100 },
  });
  const actor = {
    userId: teacher.id,
    platformRole: teacher.platformRole,
    email: teacher.email,
    displayName: teacher.name,
    username: teacher.username,
  };
  const membership = await testPrisma.courseMembership.findUniqueOrThrow({
    where: { courseId_userId: { courseId: course.id, userId: student.id } },
  });
  return { teacher, student, course, a, b, actor, membership };
}

describe("activity grading", () => {
  it("reweights a closed assignment without changing raw submissions, and preserves links for other course staff", async () => {
    const f = await fixture();
    const assignment = await testPrisma.assessment.create({
      data: {
        courseId: f.course.id,
        createdByUserId: f.teacher.id,
        title: "Homework",
        summary: "Homework",
        status: "published",
        opensAt: new Date("2020-01-01"),
        closesAt: new Date("2020-01-03"),
        totalPoints: 100,
        problems: {
          create: [
            { problemId: f.a.id, ordinal: 1, points: 40 },
            { problemId: f.b.id, ordinal: 2, points: 60 },
          ],
        },
      },
    });
    const submission = await createTestSubmission({
      problemId: f.a.id,
      userId: f.student.id,
      assessmentId: assignment.id,
      courseId: f.course.id,
      score: 160,
      createdAt: new Date("2020-01-02"),
    });
    await createTestSubmission({
      problemId: f.b.id,
      userId: f.student.id,
      assessmentId: assignment.id,
      courseId: f.course.id,
      score: 50,
      createdAt: new Date("2020-01-02"),
    });
    await createTestSubmission({
      problemId: f.a.id,
      userId: f.student.id,
      score: 200,
      createdAt: new Date("2020-02-01"),
    });
    const before = await courseDomain.buildSubmissionsMatrix(f.course.id, assignment.id);
    expect(before.rows[0]?.total).toBe(62);
    expect(before.rows[0]?.cells[0]?.practiceScore).toBe(200);
    const staff = await createTestUser({ platformRole: "teacher" });
    await testPrisma.courseMembership.create({
      data: { courseId: f.course.id, userId: staff.id, role: "teacher", status: "active" },
    });
    const actor = { ...f.actor, userId: staff.id };
    const patch = {
      totalPoints: 100,
      problems: [
        { problemId: f.b.id, points: 20 },
        { problemId: f.a.id, points: 80 },
      ],
      gradingRevision: 0,
    };
    await assignmentDomain.updateAssignmentRecord(actor, assignment.id, patch);
    const after = await courseDomain.buildSubmissionsMatrix(f.course.id, assignment.id);
    expect(after.rows[0]?.total).toBe(74);
    expect(after.problems.map((p) => p.problemId)).toEqual([f.b.id, f.a.id]);
    expect(
      (await testPrisma.submission.findUniqueOrThrow({ where: { id: submission.id } })).score,
    ).toBe(160);
    expect(
      (await courseDomain.buildCourseGradebook(f.course.id)).rows.find(
        (r) => r.userId === f.student.id,
      )?.total,
    ).toBe(74);
    expect(
      await auditDomain.listAuditTimelineForContext({
        type: "assignment",
        assignmentId: assignment.id,
      }),
    ).toEqual([]);
    await expect(
      assignmentDomain.updateAssignmentRecord(actor, assignment.id, {
        ...patch,
      }),
    ).rejects.toThrow(/changed/);
    await expect(
      assignmentDomain.updateAssignmentRecord(actor, assignment.id, {
        title: "Different title",
      }),
    ).rejects.toThrow(/read-only/);
    await assignmentDomain.updateAssignmentRecord(actor, assignment.id, {
      ...patch,
      gradingRevision: 1,
      problems: [{ problemId: f.a.id, points: 100 }],
    });
    expect(
      (await testPrisma.assessment.findUniqueOrThrow({ where: { id: assignment.id } }))
        .detachedProblemIds,
    ).toEqual([f.b.id]);
    await testPrisma.problem.update({ where: { id: f.b.id }, data: { status: "draft" } });
    const candidates = await problemDomain.listActivityProblemPickerGroups(actor, {
      type: "assignment",
      assignmentId: assignment.id,
    });
    expect(candidates.personalProblems.some((p) => p.id === f.b.id)).toBe(true);
    await expect(
      problemDomain.listActivityProblemPickerGroups(
        { ...actor, userId: f.student.id, platformRole: "student" },
        { type: "assignment", assignmentId: assignment.id },
      ),
    ).rejects.toThrow(/Not permitted/);
    await assignmentDomain.updateAssignmentRecord(actor, assignment.id, {
      ...patch,
      gradingRevision: 2,
    });
    expect(
      (await courseDomain.buildSubmissionsMatrix(f.course.id, assignment.id)).rows[0]?.total,
    ).toBe(74);
    expect(
      (await testPrisma.assessment.findUniqueOrThrow({ where: { id: assignment.id } }))
        .detachedProblemIds,
    ).toEqual([]);
    const copied = await courseDomain.copyCourse(
      f.actor,
      f.course.id,
      "Copied weighted course",
    );
    const copiedAssignment = await testPrisma.assessment.findFirstOrThrow({
      where: { courseId: copied.newCourseId },
      include: { problems: { orderBy: { ordinal: "asc" } } },
    });
    expect(Number(copiedAssignment.totalPoints)).toBe(100);
    expect(copiedAssignment.problems.map((p) => Number(p.points))).toEqual([20, 80]);
    await assignmentDomain.updateAssignmentRecord(actor, assignment.id, {
      ...patch,
      gradingRevision: 3,
    });
    expect(
      (await testPrisma.assessment.findUniqueOrThrow({ where: { id: assignment.id } }))
        .gradingRevision,
    ).toBe(3);
    await assignmentDomain.updateAssignmentRecord(actor, assignment.id, {
      ...patch,
      gradingRevision: 3,
      problems: [
        { problemId: f.b.id, points: 100 },
        { problemId: f.a.id, points: 0 },
      ],
    });
    const zeroWeighted = await courseDomain.buildSubmissionsMatrix(f.course.id, assignment.id);
    expect(zeroWeighted.rows[0]?.total).toBe(50);
    expect(zeroWeighted.rows[0]?.cells[1]?.state).toBe("partial");
  });

  it("rounds the student detail total from Decimal contributions", async () => {
    const f = await fixture();
    await testPrisma.testcaseSet.updateMany({
      where: { problemId: { in: [f.a.id, f.b.id] } },
      data: { weight: 24 },
    });
    const assignment = await testPrisma.assessment.create({
      data: {
        courseId: f.course.id,
        createdByUserId: f.teacher.id,
        title: "Decimal boundary",
        summary: "Decimal boundary",
        status: "published",
        opensAt: new Date("2020-01-01"),
        closesAt: new Date("2020-01-03"),
        totalPoints: 100,
        problems: {
          create: [
            { problemId: f.a.id, ordinal: 1, points: 53 },
            { problemId: f.b.id, ordinal: 2, points: 47 },
          ],
        },
      },
    });
    for (const [problemId, score] of [
      [f.a.id, 1],
      [f.b.id, 8],
    ] as const)
      await createTestSubmission({
        problemId,
        userId: f.student.id,
        assessmentId: assignment.id,
        courseId: f.course.id,
        score,
        createdAt: new Date("2020-01-02"),
      });
    expect(
      (
        await courseDomain.getAssignmentDetail(f.course.id, assignment.id, {
          viewerUserId: f.student.id,
          isManager: false,
        })
      ).viewerScore,
    ).toBe(17.88);
    expect((await courseDomain.buildCourseGradebook(f.course.id)).rows[0]?.total).toBe(17.88);
    expect(
      (await courseDomain.buildSubmissionsMatrix(f.course.id, assignment.id)).rows[0]?.total,
    ).toBe(17.88);
  });

  it("atomically queues exam changes, rejects stale writeback, and converges from raw overrides", async () => {
    const f = await fixture();
    const exam = await createTestExam({
      courseId: f.course.id,
      createdByUserId: f.teacher.id,
      startsAt: new Date("2020-01-01"),
      endsAt: new Date("2020-01-03"),
      problems: {
        create: [
          { problemId: f.a.id, ordinal: 1, points: 40 },
          { problemId: f.b.id, ordinal: 2, points: 60 },
        ],
      },
    });
    const participation = await testPrisma.participation.create({
      data: { type: "exam", examId: exam.id, userId: f.student.id, status: "submitted" },
    });
    await createTestSubmission({
      problemId: f.a.id,
      userId: f.student.id,
      examId: exam.id,
      score: 160,
      createdAt: new Date("2020-01-02"),
    });
    await createTestSubmission({
      problemId: f.b.id,
      userId: f.student.id,
      examId: exam.id,
      score: 50,
      createdAt: new Date("2020-01-02"),
    });
    await createTestSubmission({
      problemId: f.b.id,
      userId: f.student.id,
      examId: exam.id,
      score: 100,
      createdAt: new Date("2020-01-03"),
    });
    await updateExamScores(exam.id, f.student.id);
    expect(
      Number(
        (await testPrisma.participation.findUniqueOrThrow({ where: { id: participation.id } }))
          .score,
      ),
    ).toBe(62);
    const input = {
      totalPoints: 100,
      problems: [
        { problemId: f.a.id, points: 25 },
        { problemId: f.b.id, points: 75 },
      ],
      gradingRevision: 0,
    };
    await expect(
      examDomain.updateExamRecord(f.actor, exam.id, { ...input, totalPoints: 200 }),
    ).rejects.toThrow(/100%/);
    expect(
      (await testPrisma.exam.findUniqueOrThrow({ where: { id: exam.id } })).gradingRevision,
    ).toBe(0);
    await examDomain.updateExamRecord(f.actor, exam.id, input);
    expect(
      await testPrisma.durableWork.count({
        where: {
          kind: "score.converge",
          payload: { path: ["context", "examId"], equals: exam.id },
        },
      }),
    ).toBe(1);
    expect(await gradingRepo.countPendingExam(exam.id, 1)).toBe(1);
    expect(
      await runTransaction((tx) =>
        gradingRepo.persistExamScore(tx, {
          id: participation.id,
          examId: exam.id,
          version: 1,
          gradingRevision: 0,
          score: 999,
          subtaskScores: {},
        }),
      ),
    ).toBe(false);
    await testPrisma.scoreOverride.create({
      data: {
        courseMembershipId: f.membership.id,
        problemId: f.a.id,
        contextType: "exam",
        contextId: exam.id,
        overrideScore: 100,
        reason: "Raw correction",
      },
    });
    await updateExamScores(exam.id, f.student.id);
    expect(
      Number(
        (await testPrisma.participation.findUniqueOrThrow({ where: { id: participation.id } }))
          .score,
      ),
    ).toBe(50);
    expect(await gradingRepo.countPendingExam(exam.id, 1)).toBe(0);
  });
  it("serializes entry with a grading transaction so a new entrant never retains a stale revision", async () => {
    const f = await fixture();
    const exam = await createTestExam({ courseId: f.course.id, createdByUserId: f.teacher.id });
    let release!: () => void;
    let locked!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writer = runTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Exam" WHERE id = ${exam.id} FOR UPDATE`;
      await tx.exam.update({ where: { id: exam.id }, data: { gradingRevision: 1 } });
      locked();
      await gate;
    });
    await ready;
    let entering!: () => void;
    const started = new Promise<void>((resolve) => {
      entering = resolve;
    });
    const entrant = runTransaction(async (tx) => {
      entering();
      return participationRepo
        .withTx(tx)
        .upsertExamActive(exam.id, f.student.id, true, new Date());
    });
    await started;
    // Hold the update until the entrant is waiting on the shared exam row lock.
    try {
      await expect
        .poll(async () => {
          const rows = await testPrisma.$queryRaw<
            { count: bigint }[]
          >`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%Exam%'`;
          return Number(rows[0]?.count);
        })
        .toBeGreaterThan(0);
    } finally {
      release();
    }
    await writer;
    expect((await entrant).gradingRevision).toBe(1);
    expect(await gradingRepo.countPendingExam(exam.id, 1)).toBe(0);
  });
});
