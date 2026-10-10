import { describe, expect, it } from "vitest";

import { codeDraftDomain, examDomain, ForbiddenError, NotFoundError } from "@nojv/application";

import {
  createTestContest,
  createTestCourse,
  createTestExam,
  createTestProblem,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

async function buildStudent() {
  const user = await createTestUser({ platformRole: "student" });
  return {
    userId: user.id,
    username: user.username ?? user.id,
    displayName: user.name,
    email: user.email,
    emailVerified: false,
    platformRole: "student" as const,
  };
}

function actorOf(user: Awaited<ReturnType<typeof createTestUser>>) {
  return {
    userId: user.id,
    username: user.username ?? user.id,
    displayName: user.name,
    email: user.email,
    platformRole: user.platformRole,
  };
}

async function runningExamWithProblem(userId: string) {
  const owner = await createTestUser({ platformRole: "teacher" });
  const course = await createTestCourse({ ownerId: owner.id });
  await testPrisma.courseMembership.create({
    data: {
      courseId: course.id,
      userId,
      role: "student",
      status: "active",
      joinedAt: new Date(),
    },
  });
  const now = Date.now();
  const exam = await createTestExam({
    courseId: course.id,
    status: "published",
    startsAt: new Date(now - 60_000),
    endsAt: new Date(now + 60 * 60_000),
  });
  const problem = await createTestProblem({ visibility: "private" });
  await testPrisma.examProblem.create({
    data: { examId: exam.id, problemId: problem.id, ordinal: 1, points: 100 },
  });
  return { exam, problem };
}

describe("codeDraftDomain", () => {
  it("saves and reads back the owner's practice draft per language", async () => {
    const student = await buildStudent();
    const problem = await createTestProblem();
    const scope = { context: { type: "practice" as const }, problemId: problem.id };

    await codeDraftDomain.saveCodeDraft(
      student,
      {
        ...scope,
        language: "python",
        sourceCode: "print(1)",
      },
      "127.0.0.1",
    );
    await codeDraftDomain.saveCodeDraft(
      student,
      {
        ...scope,
        language: "python",
        sourceCode: "print(2)",
      },
      "127.0.0.1",
    );
    await codeDraftDomain.saveCodeDraft(
      student,
      {
        ...scope,
        language: "cpp",
        sourceFiles: [{ path: "main.cpp", content: "int main(){}" }],
      },
      "127.0.0.1",
    );

    const drafts = await codeDraftDomain.listCodeDrafts(student, scope, "127.0.0.1");
    expect(
      drafts.map(({ language, sourceCode, sourceFiles }) => ({
        language,
        sourceCode,
        sourceFiles,
      })),
    ).toEqual(
      expect.arrayContaining([
        { language: "python", sourceCode: "print(2)", sourceFiles: null },
        {
          language: "cpp",
          sourceCode: null,
          sourceFiles: [{ path: "main.cpp", content: "int main(){}" }],
        },
      ]),
    );
    expect(
      await codeDraftDomain.listCodeDrafts(await buildStudent(), scope, "127.0.0.1"),
    ).toEqual([]);
  });

  it("rejects exam drafts before the student has an active session", async () => {
    const student = await buildStudent();
    const { exam, problem } = await runningExamWithProblem(student.userId);

    await expect(
      codeDraftDomain.saveCodeDraft(
        student,
        {
          context: { type: "exam", examId: exam.id },
          problemId: problem.id,
          language: "c",
          sourceCode: "prepared in advance",
        },
        "127.0.0.1",
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps a student inside the exam context while the session is active", async () => {
    const student = await buildStudent();
    const { exam, problem } = await runningExamWithProblem(student.userId);
    await examDomain.session.startSessionWithGate(student, { examId: exam.id });
    const examScope = {
      context: { type: "exam" as const, examId: exam.id },
      problemId: problem.id,
    };

    await codeDraftDomain.saveCodeDraft(
      student,
      {
        ...examScope,
        language: "c",
        sourceCode: "int main(void){}",
      },
      "127.0.0.1",
    );
    expect(
      (await codeDraftDomain.listCodeDrafts(student, examScope, "127.0.0.1")).map(
        (d) => d.sourceCode,
      ),
    ).toEqual(["int main(void){}"]);

    const practiceProblem = await createTestProblem();
    await expect(
      codeDraftDomain.listCodeDrafts(
        student,
        {
          context: { type: "practice" },
          problemId: practiceProblem.id,
        },
        "127.0.0.1",
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await examDomain.session.endSession(student, { examId: exam.id, reason: "submitted" });
    await expect(
      codeDraftDomain.saveCodeDraft(
        student,
        {
          ...examScope,
          language: "c",
          sourceCode: "after hand-in",
        },
        "127.0.0.1",
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects exam drafts for a problem outside the exam", async () => {
    const student = await buildStudent();
    const { exam } = await runningExamWithProblem(student.userId);
    await examDomain.session.startSessionWithGate(student, { examId: exam.id });
    const other = await createTestProblem();

    await expect(
      codeDraftDomain.saveCodeDraft(
        student,
        {
          context: { type: "exam", examId: exam.id },
          problemId: other.id,
          language: "c",
          sourceCode: "x",
        },
        "127.0.0.1",
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("hides private practice problems the student cannot view", async () => {
    const student = await buildStudent();
    const problem = await createTestProblem({ visibility: "private" });

    await expect(
      codeDraftDomain.saveCodeDraft(
        student,
        {
          context: { type: "practice" },
          problemId: problem.id,
          language: "python",
          sourceCode: "x",
        },
        "127.0.0.1",
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("codeDraftDomain problem contexts", () => {
  const minutes = (count: number) => new Date(Date.now() + count * 60_000);

  async function contestWithProblem(startsAt: Date, endsAt: Date) {
    const organizer = await createTestUser({ platformRole: "teacher" });
    const contest = await createTestContest({
      createdByUserId: organizer.id,
      startsAt,
      endsAt,
    });
    const problem = await createTestProblem();
    await testPrisma.contestProblem.create({
      data: { contestId: contest.id, problemId: problem.id, ordinal: 1, points: 100 },
    });
    const scope = {
      context: { type: "contest" as const, contestId: contest.id },
      problemId: problem.id,
    };
    return { organizer: actorOf(organizer), contest, problem, scope };
  }

  async function joinContest(contestId: string, userId: string) {
    await testPrisma.participation.create({
      data: { type: "contest", contestId, userId, status: "active" },
    });
  }

  it("lets a contest participant read drafts while the contest runs", async () => {
    const student = await buildStudent();
    const { contest, scope } = await contestWithProblem(minutes(-1), minutes(60));
    await joinContest(contest.id, student.userId);

    await expect(codeDraftDomain.listCodeDrafts(student, scope, "127.0.0.1")).resolves.toEqual(
      [],
    );
  });

  it("refuses a student who is not participating in the contest", async () => {
    const student = await buildStudent();
    const { scope } = await contestWithProblem(minutes(-1), minutes(60));

    await expect(
      codeDraftDomain.listCodeDrafts(student, scope, "127.0.0.1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a participant once the contest has ended", async () => {
    const student = await buildStudent();
    const { contest, scope } = await contestWithProblem(minutes(-120), minutes(-1));
    await joinContest(contest.id, student.userId);

    await expect(
      codeDraftDomain.listCodeDrafts(student, scope, "127.0.0.1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lets the contest organizer read drafts outside the contest window", async () => {
    const { organizer, scope } = await contestWithProblem(minutes(-120), minutes(-1));

    await expect(
      codeDraftDomain.listCodeDrafts(organizer, scope, "127.0.0.1"),
    ).resolves.toEqual([]);
  });

  async function assignmentWithProblem() {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });
    const assessment = await testPrisma.assessment.create({
      data: {
        courseId: course.id,
        createdByUserId: teacher.id,
        title: "HW",
        summary: "Open",
        status: "published",
        opensAt: minutes(-60),
        closesAt: minutes(60),
      },
    });
    const problem = await createTestProblem();
    await testPrisma.assessmentProblem.create({
      data: { assessmentId: assessment.id, problemId: problem.id, ordinal: 1, points: 100 },
    });
    const scope = {
      context: {
        type: "assignment" as const,
        courseId: course.id,
        assessmentId: assessment.id,
      },
      problemId: problem.id,
    };
    return { course, scope };
  }

  it("lets an enrolled student read assignment drafts", async () => {
    const student = await buildStudent();
    const { course, scope } = await assignmentWithProblem();
    await testPrisma.courseMembership.create({
      data: { courseId: course.id, userId: student.userId, role: "student", status: "active" },
    });

    await expect(codeDraftDomain.listCodeDrafts(student, scope, "127.0.0.1")).resolves.toEqual(
      [],
    );
  });

  it("refuses an assignment problem to a student outside the course", async () => {
    const student = await buildStudent();
    const { scope } = await assignmentWithProblem();

    await expect(
      codeDraftDomain.listCodeDrafts(student, scope, "127.0.0.1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  async function virtualRun(owner: string, endsAt: Date) {
    const { contest, problem } = await contestWithProblem(minutes(-180), minutes(-120));
    const virtual = await testPrisma.participation.create({
      data: {
        type: "virtual",
        contestId: contest.id,
        userId: owner,
        status: "active",
        startedAt: new Date(endsAt.getTime() - 60 * 60_000),
        endsAt,
      },
    });
    const scope = {
      context: { type: "virtual" as const, participationId: virtual.id },
      problemId: problem.id,
    };
    return { scope };
  }

  it("lets the owner read drafts during a virtual contest", async () => {
    const student = await buildStudent();
    const { scope } = await virtualRun(student.userId, minutes(60));

    await expect(codeDraftDomain.listCodeDrafts(student, scope, "127.0.0.1")).resolves.toEqual(
      [],
    );
  });

  it("refuses someone else's virtual contest", async () => {
    const owner = await buildStudent();
    const student = await buildStudent();
    const { scope } = await virtualRun(owner.userId, minutes(60));

    await expect(
      codeDraftDomain.listCodeDrafts(student, scope, "127.0.0.1"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses a virtual contest whose timer has ended", async () => {
    const student = await buildStudent();
    const { scope } = await virtualRun(student.userId, minutes(-1));

    await expect(
      codeDraftDomain.listCodeDrafts(student, scope, "127.0.0.1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
