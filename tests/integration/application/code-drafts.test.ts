import { describe, expect, it } from "vitest";

import { codeDraftDomain, examDomain, ForbiddenError, NotFoundError } from "@nojv/application";

import {
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

    await codeDraftDomain.saveCodeDraft(student, {
      ...scope,
      language: "python",
      sourceCode: "print(1)",
    });
    await codeDraftDomain.saveCodeDraft(student, {
      ...scope,
      language: "python",
      sourceCode: "print(2)",
    });
    await codeDraftDomain.saveCodeDraft(student, {
      ...scope,
      language: "cpp",
      sourceFiles: [{ path: "main.cpp", content: "int main(){}" }],
    });

    const drafts = await codeDraftDomain.listCodeDrafts(student, scope);
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
    expect(await codeDraftDomain.listCodeDrafts(await buildStudent(), scope)).toEqual([]);
  });

  it("rejects exam drafts before the student has an active session", async () => {
    const student = await buildStudent();
    const { exam, problem } = await runningExamWithProblem(student.userId);

    await expect(
      codeDraftDomain.saveCodeDraft(student, {
        context: { type: "exam", examId: exam.id },
        problemId: problem.id,
        language: "c",
        sourceCode: "prepared in advance",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps a student inside the exam context while the session is active", async () => {
    const student = await buildStudent();
    const { exam, problem } = await runningExamWithProblem(student.userId);
    await examDomain.session.startSession(student, { examId: exam.id });
    const examScope = {
      context: { type: "exam" as const, examId: exam.id },
      problemId: problem.id,
    };

    await codeDraftDomain.saveCodeDraft(student, {
      ...examScope,
      language: "c",
      sourceCode: "int main(void){}",
    });
    expect(
      (await codeDraftDomain.listCodeDrafts(student, examScope)).map((d) => d.sourceCode),
    ).toEqual(["int main(void){}"]);

    const practiceProblem = await createTestProblem();
    await expect(
      codeDraftDomain.listCodeDrafts(student, {
        context: { type: "practice" },
        problemId: practiceProblem.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await examDomain.session.endSession(student, { examId: exam.id, reason: "submitted" });
    await expect(
      codeDraftDomain.saveCodeDraft(student, {
        ...examScope,
        language: "c",
        sourceCode: "after hand-in",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects exam drafts for a problem outside the exam", async () => {
    const student = await buildStudent();
    const { exam } = await runningExamWithProblem(student.userId);
    await examDomain.session.startSession(student, { examId: exam.id });
    const other = await createTestProblem();

    await expect(
      codeDraftDomain.saveCodeDraft(student, {
        context: { type: "exam", examId: exam.id },
        problemId: other.id,
        language: "c",
        sourceCode: "x",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("hides private practice problems the student cannot view", async () => {
    const student = await buildStudent();
    const problem = await createTestProblem({ visibility: "private" });

    await expect(
      codeDraftDomain.saveCodeDraft(student, {
        context: { type: "practice" },
        problemId: problem.id,
        language: "python",
        sourceCode: "x",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
