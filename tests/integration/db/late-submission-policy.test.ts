import { readFileSync } from "node:fs";
import { splitStatements } from "../../setup/replay-constraints";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assignmentDomain,
  courseDomain,
  examDomain,
  submissionDomain,
  type ActorContext,
} from "@nojv/application";
import {
  courseAssignmentFormSchema,
  examCreateSchema,
  submissionDraftSchema,
} from "@nojv/core";
import {
  createTestCourse,
  createTestExam,
  createTestProblem,
  createTestProblemWorkspaceFile,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

const start = new Date("2030-01-01T00:00:00Z");
const due = new Date("2030-01-02T00:00:00Z");
const end = new Date("2030-01-04T00:00:00Z");
const rule = { type: "daily_late_penalty", perDayPct: 10 } as const;

function actor(user: Awaited<ReturnType<typeof createTestUser>>): ActorContext {
  return {
    userId: user.id,
    username: user.username!,
    email: user.email,
    displayName: user.name,
    platformRole: user.platformRole,
  };
}

afterEach(() => vi.useRealTimers());

async function fixture(kind: "assignment" | "exam") {
  const teacher = await createTestUser({ platformRole: "teacher" });
  const student = await createTestUser();
  const course = await createTestCourse({ ownerId: teacher.id });
  await testPrisma.courseMembership.create({
    data: {
      courseId: course.id,
      userId: teacher.id,
      role: "teacher",
      status: "active",
      addedByUserId: teacher.id,
    },
  });
  await testPrisma.courseMembership.create({
    data: {
      courseId: course.id,
      userId: student.id,
      role: "student",
      status: "active",
      addedByUserId: teacher.id,
    },
  });
  const problem = await createTestProblem({ authorId: teacher.id });
  await createTestProblemWorkspaceFile({
    problemId: problem.id,
    language: "python",
    path: "main.py",
    content: "print(3)",
  });
  await testPrisma.testcaseSet.updateMany({
    where: { problemId: problem.id },
    data: { weight: 100 },
  });
  if (kind === "assignment") {
    const assignment = await testPrisma.assessment.create({
      data: {
        title: "Late assignment",
        summary: "Late submission policy",
        courseId: course.id,
        createdByUserId: teacher.id,
        opensAt: start,
        dueAt: due,
        closesAt: end,
        status: "published",
        allowedLanguages: ["python"],
        adjustmentRules: [rule],
        problems: { create: { problemId: problem.id, ordinal: 1, points: 100 } },
      },
    });
    return {
      teacher,
      student,
      course,
      problem,
      context: {
        type: "assignment" as const,
        courseId: course.id,
        assessmentId: assignment.id,
      },
      exam: null,
    };
  }
  const exam = await createTestExam({
    courseId: course.id,
    createdByUserId: teacher.id,
    startsAt: start,
    dueAt: due,
    endsAt: end,
    allowedLanguages: ["python"],
    adjustmentRules: [rule],
    pageLockEnabled: true,
  });
  await testPrisma.examProblem.create({
    data: { examId: exam.id, problemId: problem.id, ordinal: 1, points: 100 },
  });
  await examDomain.session.startSession(actor(student), { examId: exam.id });
  return {
    teacher,
    student,
    course,
    problem,
    context: { type: "exam" as const, examId: exam.id },
    exam,
  };
}

describe("shared late submission policy", () => {
  it.each(["assignment", "exam"] as const)(
    "%s accepts and scores late submissions, stops at the final deadline, and isolates practice",
    async (kind) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(due);
      const f = await fixture(kind);
      const draft = submissionDraftSchema.parse({
        problemId: f.problem.id,
        language: "python",
        sourceCode: "print(3)",
        context: f.context,
      });
      for (const [elapsed, expected] of [
        [0, 100],
        [1, 90],
        [86_400_000, 90],
        [86_400_001, 80],
      ] as const) {
        vi.setSystemTime(new Date(due.getTime() + elapsed));
        const sub = await submissionDomain.createQueuedSubmissionRecord(
          draft,
          actor(f.student),
          "127.0.0.1",
        );
        const ctx = await submissionDomain.getJudgeContext(sub.id);
        const result = submissionDomain.mapResult(
          {
            testcaseResults: [
              { index: 0, verdict: "AC", exitCode: 0, stdout: "3", stderr: "", timeMs: 1 },
            ],
          },
          ctx.testcaseSets,
          ctx,
        );
        expect(result.score).toBe(expected);
        await testPrisma.submission.update({
          where: { id: sub.id },
          data: { status: "accepted", score: result.score },
        });
      }
      if (f.exam) {
        const input = {
          examId: f.exam.id,
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
          scheduleRevision: f.exam.scheduleRevision,
          timerFingerprint: f.exam.timerFingerprint,
        };
        expect(await examDomain.session.autoCloseForExam(input)).toEqual({ closed: 0 });
        expect(
          await testPrisma.activeExamSession.count({
            where: { examId: f.exam.id, endedAt: null },
          }),
        ).toBe(1);
        await examDomain.updateExamScores(f.exam.id, f.student.id);
        expect(
          Number(
            (
              await testPrisma.participation.findFirstOrThrow({
                where: { examId: f.exam.id, userId: f.student.id },
              })
            ).score,
          ),
        ).toBe(100);
      }
      vi.setSystemTime(end);
      await expect(
        submissionDomain.createQueuedSubmissionRecord(draft, actor(f.student), "127.0.0.1"),
      ).rejects.toThrow(/ended/);
      if (f.exam) {
        expect(
          await examDomain.session.autoCloseForExam({
            examId: f.exam.id,
            startsAt: start.toISOString(),
            endsAt: end.toISOString(),
            scheduleRevision: f.exam.scheduleRevision,
            timerFingerprint: f.exam.timerFingerprint,
          }),
        ).toEqual({ closed: 1 });
      }
      vi.setSystemTime(new Date(end.getTime() + 1));
      const practice = await submissionDomain.createQueuedSubmissionRecord(
        { ...draft, context: { type: "practice" } },
        actor(f.student),
        "127.0.0.1",
      );
      expect(practice.assessmentId).toBeNull();
      expect(practice.examId).toBeNull();
      expect(
        (await submissionDomain.getJudgeContext(practice.id)).adjustment.adjustmentRules,
      ).toBeNull();
    },
  );

  it("persists and validates an exam policy on create and partial update", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });
    await testPrisma.courseMembership.create({
      data: {
        courseId: course.id,
        userId: teacher.id,
        role: "teacher",
        status: "active",
        addedByUserId: teacher.id,
      },
    });
    const exam = await examDomain.createExamRecord(
      actor(teacher),
      examCreateSchema.parse({
        courseId: course.id,
        title: "Late exam",
        startsAt: start.toISOString(),
        dueAt: due.toISOString(),
        endsAt: end.toISOString(),
        adjustmentRules: [rule],
      }),
    );
    expect(exam.dueAt).toEqual(due);
    expect(exam.adjustmentRules).toEqual([rule]);
    const copied = await courseDomain.copyCourse(
      actor(teacher),
      course.id,
      "Copied late policy",
    );
    const copiedExam = await testPrisma.exam.findFirstOrThrow({
      where: { courseId: copied.newCourseId },
    });
    expect(copiedExam.status).toBe("draft");
    expect(copiedExam.dueAt).toEqual(due);
    expect(copiedExam.endsAt).toEqual(end);
    expect(copiedExam.adjustmentRules).toEqual([rule]);
    await expect(
      examDomain.updateExamRecord(actor(teacher), exam.id, {
        dueAt: new Date(end.getTime() + 1).toISOString(),
      }),
    ).rejects.toThrow(/dueAt/);
    await expect(
      examDomain.updateExamRecord(actor(teacher), exam.id, { dueAt: null }),
    ).rejects.toThrow(/Late penalties/);
    await examDomain.updateExamRecord(actor(teacher), exam.id, {
      adjustmentRules: [],
      dueAt: end.toISOString(),
    });
    const saved = await testPrisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
    expect(saved.dueAt).toEqual(end);
    expect(saved.adjustmentRules).toEqual([]);
  });

  it("normalizes disabled assignment late submission on create", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });
    await testPrisma.courseMembership.create({
      data: {
        courseId: course.id,
        userId: teacher.id,
        role: "teacher",
        status: "active",
        addedByUserId: teacher.id,
      },
    });
    const created = await courseDomain.createCourseAssignmentRecord(
      actor(teacher),
      course.id,
      courseAssignmentFormSchema.parse({
        courseId: course.id,
        title: "No late submissions",
        opensAt: start.toISOString(),
        dueAt: due.toISOString(),
        closesAt: end.toISOString(),
        allowLateSubmissions: false,
        latePenalty: rule,
      }),
    );
    const saved = await testPrisma.assessment.findUniqueOrThrow({ where: { id: created.id } });
    expect(saved.closesAt).toEqual(due);
    expect(saved.adjustmentRules).toBeNull();
  });

  it.each(["assignment", "exam"] as const)("locks %s penalties while running", async (kind) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(due);
    const f = await fixture(kind);
    const mutate =
      f.context.type === "assignment"
        ? assignmentDomain.updateAssignmentRecord(actor(f.teacher), f.context.assessmentId, {
            adjustmentRules: [],
          })
        : examDomain.updateExamRecord(actor(f.teacher), f.context.examId, {
            adjustmentRules: [],
          });
    await expect(mutate).rejects.toThrow(/cannot be changed/);
  });
  it("preserves runtime bonuses and rule order when saving an open assignment's late settings", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(due);
    const f = await fixture("assignment");
    if (f.context.type !== "assignment") throw new Error("Expected assignment fixture");
    const bonus = { type: "time_bonus", baselineMs: 1000, maxBonusPercent: 10 };
    await testPrisma.assessment.update({
      where: { id: f.context.assessmentId },
      data: { adjustmentRules: [rule, bonus] },
    });
    await assignmentDomain.updateAssignmentRecord(actor(f.teacher), f.context.assessmentId, {
      title: "Renamed assignment",
      latePenalty: rule,
    });
    const saved = await testPrisma.assessment.findUniqueOrThrow({
      where: { id: f.context.assessmentId },
    });
    expect(saved.adjustmentRules).toEqual([rule, bonus]);
    expect(saved.title).toBe("Renamed assignment");
  });

  it("normalizes stored retired rules", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });
    const row = await testPrisma.assessment.create({
      data: {
        title: "Existing policy",
        summary: "Existing policy",
        courseId: course.id,
        createdByUserId: teacher.id,
        opensAt: start,
        dueAt: due,
        closesAt: end,
        adjustmentRules: [
          { type: "flat_late_penalty", penaltyPct: 20, startFrom: "due" },
          { type: "daily_late_penalty", perDayPct: 10, startFrom: "final_day" },
          { type: "final_day_zero" },
        ],
      },
    });
    const migration = readFileSync(
      new URL(
        "../../../packages/db/prisma/migrations/20260908000000_exam_late_submission_policy/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const normalize = splitStatements(migration).find((statement) =>
      statement.startsWith('UPDATE "Assessment"'),
    )!;
    await testPrisma.$executeRawUnsafe(normalize);
    expect(
      (await testPrisma.assessment.findUniqueOrThrow({ where: { id: row.id } }))
        .adjustmentRules,
    ).toEqual([{ type: "flat_late_penalty", penaltyPct: 20 }]);
  });
});
